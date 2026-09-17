// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Real capture flow. Uses chrome.* APIs directly, so unlike geometry.ts /
 * sticky.ts / state.ts this module cannot be exercised by loading it as a
 * plain page script — it only runs inside the extension's background
 * service worker. See docs/superpowers/specs/2026-09-17-p1-chrome-edge-png-design.md
 * for how the pure parts of this flow were verified instead.
 */
import { isCapturableUrl, measurePage, type PageMetrics } from "./geometry.js";
import { hideFixedAndStickyElements, restoreFixedAndStickyElements } from "./injectable.js";
import { begin, restore, suppressSmoothScroll, type PageStateSnapshot } from "./state.js";
import initWasm, { composeFullPagePng, planTiles, RateLimiter } from "../wasm/screenshot_wasm.js";

const DEFAULT_TILE_OVERLAP_CSS_PX = 40;

export class CaptureCancelledError extends Error {
  constructor() {
    super("Capture cancelled");
    this.name = "CaptureCancelledError";
  }
}

export class PageNotCapturableError extends Error {
  constructor() {
    super("This browser does not allow extensions to capture this page.");
    this.name = "PageNotCapturableError";
  }
}

export interface CaptureResult {
  pngBytes: Uint8Array;
  width: number;
  height: number;
}

export type ProgressCallback = (status: string) => void;

let wasmReady: Promise<unknown> | null = null;
function ensureWasm(): Promise<unknown> {
  if (!wasmReady) {
    wasmReady = initWasm();
  }
  return wasmReady;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function decodePngDataUrlToRgba(dataUrl: string): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable in this browser");
    }
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, rgba: new Uint8Array(imageData.data.buffer) };
  } finally {
    bitmap.close();
  }
}

async function getCapturableTab(tabId: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isCapturableUrl(tab.url)) {
    throw new PageNotCapturableError();
  }
  return tab;
}

/** Capture Visible: exactly the tab's current viewport, as PNG. */
export async function captureVisible(tabId: number): Promise<CaptureResult> {
  const tab = await getCapturableTab(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const { width, height } = await decodePngDataUrlToRgba(dataUrl);
  const pngBytes = await dataUrlToBytes(dataUrl);
  return { pngBytes, width, height };
}

/**
 * Capture Full Page: scrolls the tab tile by tile, hiding fixed/sticky
 * elements after the first tile so they aren't duplicated, rate-limiting
 * `captureVisibleTab()` calls, and streaming the result through the Rust
 * compositor. On cancellation or any error, the page's scroll position
 * and any hidden elements are always restored (see the `finally` block).
 */
export async function captureFullPage(
  tabId: number,
  onProgress: ProgressCallback,
  isCancelled: () => boolean,
): Promise<CaptureResult> {
  await ensureWasm();
  const tab = await getCapturableTab(tabId);

  onProgress("Preparing…");
  const [{ result: metrics }] = (await chrome.scripting.executeScript({
    target: { tabId },
    func: measurePage,
  })) as unknown as [{ result: PageMetrics }];

  const [{ result: snapshot }] = (await chrome.scripting.executeScript({
    target: { tabId },
    func: begin,
  })) as unknown as [{ result: PageStateSnapshot }];

  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: suppressSmoothScroll });

    const offsets = planTiles(metrics.viewportHeight, metrics.scrollHeight, DEFAULT_TILE_OVERLAP_CSS_PX);
    const rateLimiter = RateLimiter.defaultForCapture();

    const tileWidths: number[] = [];
    const tileHeights: number[] = [];
    const rgbaChunks: Uint8Array[] = [];

    for (let i = 0; i < offsets.length; i++) {
      if (isCancelled()) {
        throw new CaptureCancelledError();
      }
      onProgress(`Capturing ${i + 1}/${offsets.length}…`);
      const offset = offsets[i];
      if (offset === undefined) {
        throw new Error(`internal error: missing tile offset at index ${i}`);
      }

      await chrome.scripting.executeScript({
        target: { tabId },
        func: (y: number) => window.scrollTo(0, y),
        args: [offset],
      });

      if (i > 0) {
        await chrome.scripting.executeScript({ target: { tabId }, func: hideFixedAndStickyElements });
      }

      const wait = rateLimiter.nextDelayMs(performance.now());
      if (wait > 0) {
        await sleep(wait);
      }

      let dataUrl: string;
      try {
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        rateLimiter.recordSuccess(performance.now());
      } catch (e) {
        rateLimiter.recordError(performance.now());
        throw e;
      }

      if (i > 0) {
        await chrome.scripting.executeScript({ target: { tabId }, func: restoreFixedAndStickyElements });
      }

      if (isCancelled()) {
        throw new CaptureCancelledError();
      }

      const { width, height, rgba } = await decodePngDataUrlToRgba(dataUrl);
      tileWidths.push(width);
      tileHeights.push(height);
      rgbaChunks.push(rgba);
    }

    onProgress("Processing…");
    const totalLen = rgbaChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const concatenated = new Uint8Array(totalLen);
    let cursor = 0;
    for (const chunk of rgbaChunks) {
      concatenated.set(chunk, cursor);
      cursor += chunk.length;
    }

    const dpr = metrics.devicePixelRatio;
    const pngBytes = composeFullPagePng(
      Float64Array.from(offsets),
      metrics.viewportWidth,
      metrics.viewportHeight,
      dpr,
      Uint32Array.from(tileWidths),
      Uint32Array.from(tileHeights),
      concatenated,
    );

    return {
      pngBytes,
      width: tileWidths[0] ?? 0,
      height: Math.round(metrics.scrollHeight * dpr),
    };
  } finally {
    await chrome.scripting.executeScript({ target: { tabId }, func: restoreFixedAndStickyElements });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: restore,
      args: [snapshot],
    });
  }
}
