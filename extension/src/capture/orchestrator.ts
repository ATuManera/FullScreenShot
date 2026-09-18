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
import { classifyPrescrollOutcome, DEFAULT_MAX_PRESCROLL_PASSES } from "./lazy.js";
import { extractMarkdownAst, type MarkdownMode } from "./markdown.js";
import {
  boundingRectBySelector,
  measureContainerBySelector,
  scrollContainerBySelector,
  type ContainerSelector,
} from "./selection.js";
import {
  allCapturedTilesIdentical,
  decideTile,
  fingerprintRgba,
  scrollWindowToVerified,
  settleFrame,
  type WindowScrollOutcome,
} from "./scrollSync.js";
import { begin, restore, suppressSmoothScroll, type PageStateSnapshot } from "./state.js";
import initWasm, { composeFullPagePdf, composeFullPagePng, markdownFromJson, planTiles, RateLimiter } from "../wasm/screenshot_wasm.js";

const DEFAULT_TILE_OVERLAP_CSS_PX = 40;
/**
 * Independent of (and lower than) `plan_tile_offsets`'s internal 100,000
 * hard cap (P0) — this is a second, configurable line of defense so an
 * absurd capture is rejected with a clear message before any tab
 * scrolling/capturing starts, rather than relying solely on the Rust
 * core's limit as the only guard (spec section 13).
 */
const MAX_TILES_SAFETY_LIMIT = 500;

export type LazyMode = "fast" | "reliable";
export type ImageExportFormat = "png" | "pdf";
export interface PdfExportOptions {
  pageSize: "a4" | "letter" | "auto";
  orientation: "portrait" | "landscape";
}
const DEFAULT_PDF_OPTIONS: PdfExportOptions = { pageSize: "auto", orientation: "portrait" };

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

export class TooManyTilesError extends Error {
  constructor(tileCount: number, limit: number) {
    super(`This page would require ${tileCount} tiles, which exceeds the ${limit}-tile safety limit.`);
    this.name = "TooManyTilesError";
  }
}

export class NoScrollContainerSelectedError extends Error {
  constructor() {
    super("Selected scroll container is no longer on the page.");
    this.name = "NoScrollContainerSelectedError";
  }
}

/**
 * Raised when a scroll request the scroller could have honoured left it where
 * it already was. Every remaining tile would be the same picture, so the
 * capture stops instead of stitching duplicated viewports into a tall PNG
 * that looks like a full-page capture but is not one.
 */
export class DidNotScrollError extends Error {
  constructor() {
    super("The page did not scroll as expected. Try again or use Visible area.");
    this.name = "DidNotScrollError";
  }
}

export class PossiblyInfiniteScrollError extends Error {
  constructor() {
    super("This page appears to load content indefinitely while scrolling (infinite scroll) — capture stopped at the pre-scroll limit.");
    this.name = "PossiblyInfiniteScrollError";
  }
}

export interface CaptureResult {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

function encodeComposite(
  format: ImageExportFormat,
  pdfOptions: PdfExportOptions,
  offsets: number[],
  contentWidth: number,
  contentHeight: number,
  dpr: number,
  tileWidths: number[],
  tileHeights: number[],
  rgba: Uint8Array,
): { bytes: Uint8Array; mimeType: string } {
  if (format === "pdf") {
    const bytes = composeFullPagePdf(
      Float64Array.from(offsets),
      contentWidth,
      contentHeight,
      dpr,
      Uint32Array.from(tileWidths),
      Uint32Array.from(tileHeights),
      rgba,
      pdfOptions.pageSize,
      pdfOptions.orientation,
    );
    return { bytes, mimeType: "application/pdf" };
  }
  const bytes = composeFullPagePng(
    Float64Array.from(offsets),
    contentWidth,
    contentHeight,
    dpr,
    Uint32Array.from(tileWidths),
    Uint32Array.from(tileHeights),
    rgba,
  );
  return { bytes, mimeType: "image/png" };
}

/** `current`/`total` are omitted when progress isn't meaningfully countable (e.g. "Preparing…"). */
export interface CaptureProgress {
  text: string;
  current?: number;
  total?: number;
}
export type ProgressCallback = (progress: CaptureProgress) => void;

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

async function decodeAndCropPngDataUrlToRgba(
  dataUrl: string,
  cropCssRect: { x: number; y: number; width: number; height: number },
  dpr: number,
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const sx = Math.max(0, Math.round(cropCssRect.x * dpr));
    const sy = Math.max(0, Math.round(cropCssRect.y * dpr));
    const width = Math.max(1, Math.min(bitmap.width - sx, Math.round(cropCssRect.width * dpr)));
    const height = Math.max(1, Math.min(bitmap.height - sy, Math.round(cropCssRect.height * dpr)));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable in this browser");
    }
    ctx.drawImage(bitmap, sx, sy, width, height, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { width, height, rgba: new Uint8Array(imageData.data.buffer) };
  } finally {
    bitmap.close();
  }
}

function concatenateRgba(chunks: Uint8Array[]): Uint8Array {
  const totalLen = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const concatenated = new Uint8Array(totalLen);
  let cursor = 0;
  for (const chunk of chunks) {
    concatenated.set(chunk, cursor);
    cursor += chunk.length;
  }
  return concatenated;
}

function assertWithinTileSafetyLimit(offsets: number[]): void {
  if (offsets.length > MAX_TILES_SAFETY_LIMIT) {
    throw new TooManyTilesError(offsets.length, MAX_TILES_SAFETY_LIMIT);
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
  const bytes = await dataUrlToBytes(dataUrl);
  return { bytes, mimeType: "image/png", width, height };
}

/**
 * Capture Full Page: scrolls the tab tile by tile, hiding fixed/sticky
 * elements after the first tile so they aren't duplicated, rate-limiting
 * `captureVisibleTab()` calls, and streaming the result through the Rust
 * compositor. On cancellation or any error, the page's scroll position
 * and any hidden elements are always restored (see the `finally` block).
 *
 * Each tile's band origin is the position the page *reached*, read back from
 * the page after the scroll has been composited — never the position that was
 * requested. That distinction is the whole repair: the planner's offsets are a
 * request, and a page is free to ignore, clamp or undo it. Recording requested
 * offsets as if they were achieved is what turned a page that refuses to
 * scroll into a tall PNG containing the same viewport over and over.
 */
export async function captureFullPage(
  tabId: number,
  onProgress: ProgressCallback,
  isCancelled: () => boolean,
  lazyMode: LazyMode = "fast",
  exportFormat: ImageExportFormat = "png",
  pdfOptions: PdfExportOptions = DEFAULT_PDF_OPTIONS,
): Promise<CaptureResult> {
  await ensureWasm();
  const tab = await getCapturableTab(tabId);

  onProgress({ text: "Preparing…" });
  const [{ result: snapshot }] = (await chrome.scripting.executeScript({
    target: { tabId },
    func: begin,
  })) as unknown as [{ result: PageStateSnapshot }];

  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: suppressSmoothScroll });

    if (lazyMode === "reliable") {
      await runReliablePrescroll(tabId, onProgress, isCancelled);
    }

    const [{ result: metrics }] = (await chrome.scripting.executeScript({
      target: { tabId },
      func: measurePage,
    })) as unknown as [{ result: PageMetrics }];

    const plannedOffsets = planTiles(metrics.viewportHeight, metrics.scrollHeight, DEFAULT_TILE_OVERLAP_CSS_PX);
    assertWithinTileSafetyLimit(plannedOffsets);
    const rateLimiter = RateLimiter.defaultForCapture();

    /** Band origins actually achieved — this, not `plannedOffsets`, is what the compositor is told. */
    const capturedOffsets: number[] = [];
    const tileWidths: number[] = [];
    const tileHeights: number[] = [];
    const rgbaChunks: Uint8Array[] = [];
    const fingerprints: string[] = [];
    let previousActualY: number | null = null;

    for (let i = 0; i < plannedOffsets.length; i++) {
      if (isCancelled()) {
        throw new CaptureCancelledError();
      }
      onProgress({ text: `Capturing ${i + 1} of ${plannedOffsets.length}…`, current: i + 1, total: plannedOffsets.length });
      const offset = plannedOffsets[i];
      if (offset === undefined) {
        throw new Error(`internal error: missing tile offset at index ${i}`);
      }

      const [{ result: scrolled }] = (await chrome.scripting.executeScript({
        target: { tabId },
        func: scrollWindowToVerified,
        args: [offset],
      })) as unknown as [{ result: WindowScrollOutcome }];

      const decision = decideTile({
        requestedY: offset,
        actualY: scrolled.actualY,
        maxScrollY: scrolled.maxScrollY,
        previousActualY,
      });
      if (decision.kind === "abort") {
        throw new DidNotScrollError();
      }
      if (decision.kind === "skip") {
        // Chrome clamped onto a viewport an earlier tile already covers.
        // Dropping it is what keeps the bottom of the page from appearing
        // twice; stitching it would also be rejected by the compositor,
        // which refuses duplicate band origins.
        continue;
      }

      // Hiding is keyed off how many tiles were actually kept, not the plan
      // index, so a skipped tile can't leave the first captured tile with its
      // fixed/sticky elements hidden.
      const isFirstCapturedTile = capturedOffsets.length === 0;
      if (!isFirstCapturedTile) {
        await chrome.scripting.executeScript({ target: { tabId }, func: hideFixedAndStickyElements });
        await chrome.scripting.executeScript({ target: { tabId }, func: settleFrame });
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

      if (!isFirstCapturedTile) {
        await chrome.scripting.executeScript({ target: { tabId }, func: restoreFixedAndStickyElements });
      }

      if (isCancelled()) {
        throw new CaptureCancelledError();
      }

      const { width, height, rgba } = await decodePngDataUrlToRgba(dataUrl);
      capturedOffsets.push(decision.offsetY);
      tileWidths.push(width);
      tileHeights.push(height);
      rgbaChunks.push(rgba);
      fingerprints.push(fingerprintRgba(rgba));
      previousActualY = decision.offsetY;
    }

    // Defense in depth against a page that reports a moving scroll position
    // while rendering the same pixels: `decideTile` cannot see that, but a
    // capture whose every tile is byte-identical is not a capture.
    if (allCapturedTilesIdentical(fingerprints, capturedOffsets)) {
      throw new DidNotScrollError();
    }

    onProgress({ text: "Processing…" });
    const concatenated = concatenateRgba(rgbaChunks);

    const dpr = metrics.devicePixelRatio;
    const { bytes, mimeType } = encodeComposite(
      exportFormat,
      pdfOptions,
      capturedOffsets,
      metrics.viewportWidth,
      metrics.viewportHeight,
      dpr,
      tileWidths,
      tileHeights,
      concatenated,
    );

    // Height of what was genuinely composited (last achieved band origin plus
    // one viewport), rather than the page height that was hoped for.
    const lastOffset = capturedOffsets[capturedOffsets.length - 1] ?? 0;
    return {
      bytes,
      mimeType,
      width: tileWidths[0] ?? 0,
      height: Math.round((lastOffset + metrics.viewportHeight) * dpr),
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

/**
 * "Reliable" lazy-loading mode: scrolls to the bottom and back up to the
 * top repeatedly (bounded by `DEFAULT_MAX_PRESCROLL_PASSES`), re-measuring
 * `scrollHeight` each pass, to give `img[loading=lazy]` and similar
 * dynamic content a chance to load before the real tile-by-tile capture
 * begins. Throws `PossiblyInfiniteScrollError` rather than looping forever
 * if the page keeps growing right up to the pass limit.
 */
async function runReliablePrescroll(tabId: number, onProgress: ProgressCallback, isCancelled: () => boolean): Promise<void> {
  const samples: number[] = [];
  for (let pass = 0; pass < DEFAULT_MAX_PRESCROLL_PASSES; pass++) {
    if (isCancelled()) {
      throw new CaptureCancelledError();
    }
    onProgress({
      text: `Preparing… (pre-scroll ${pass + 1} of ${DEFAULT_MAX_PRESCROLL_PASSES})`,
      current: pass + 1,
      total: DEFAULT_MAX_PRESCROLL_PASSES,
    });

    const [{ result: metrics }] = (await chrome.scripting.executeScript({
      target: { tabId },
      func: measurePage,
    })) as unknown as [{ result: PageMetrics }];
    samples.push(metrics.scrollHeight);

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (y: number) => window.scrollTo(0, y),
      args: [metrics.scrollHeight],
    });
    await sleep(250);

    const outcome = classifyPrescrollOutcome(samples, DEFAULT_MAX_PRESCROLL_PASSES);
    if (outcome === "settled" && samples.length >= 2) {
      break;
    }
    if (outcome === "possibly-infinite" && samples.length >= DEFAULT_MAX_PRESCROLL_PASSES) {
      await chrome.scripting.executeScript({ target: { tabId }, func: (y: number) => window.scrollTo(0, y), args: [0] });
      throw new PossiblyInfiniteScrollError();
    }
  }
  // The real capture starts from its first planned tile, so the pre-scroll
  // must leave the page verifiably back at the top rather than wherever the
  // last lazy-loading pass happened to end.
  await chrome.scripting.executeScript({ target: { tabId }, func: scrollWindowToVerified, args: [0] });
}

/**
 * Capture Selected Scroll Area: like `captureFullPage`, but scrolls a
 * chosen element's own `scrollTop` instead of the window, and crops every
 * captured viewport screenshot down to that element's on-screen bounding
 * box before handing it to the same Rust compositor. The rest of the page
 * around the container never becomes part of the composited output.
 */
export async function captureScrollArea(
  tabId: number,
  selector: ContainerSelector,
  onProgress: ProgressCallback,
  isCancelled: () => boolean,
  exportFormat: ImageExportFormat = "png",
  pdfOptions: PdfExportOptions = DEFAULT_PDF_OPTIONS,
): Promise<CaptureResult> {
  await ensureWasm();
  const tab = await getCapturableTab(tabId);

  onProgress({ text: "Preparing…" });
  const [{ result: metrics }] = (await chrome.scripting.executeScript({
    target: { tabId },
    func: measureContainerBySelector,
    args: [selector.attr, selector.value],
  })) as unknown as [{ result: ReturnType<typeof measureContainerBySelector> }];

  if (!metrics) {
    throw new NoScrollContainerSelectedError();
  }

  const [{ result: rect }] = (await chrome.scripting.executeScript({
    target: { tabId },
    func: boundingRectBySelector,
    args: [selector.attr, selector.value],
  })) as unknown as [{ result: ReturnType<typeof boundingRectBySelector> }];

  if (!rect) {
    throw new NoScrollContainerSelectedError();
  }

  const offsets = planTiles(metrics.clientHeight, metrics.scrollHeight, DEFAULT_TILE_OVERLAP_CSS_PX);
  assertWithinTileSafetyLimit(offsets);
  const rateLimiter = RateLimiter.defaultForCapture();

  const tileWidths: number[] = [];
  const tileHeights: number[] = [];
  const rgbaChunks: Uint8Array[] = [];

  try {
    for (let i = 0; i < offsets.length; i++) {
      if (isCancelled()) {
        throw new CaptureCancelledError();
      }
      onProgress({ text: `Capturing ${i + 1} of ${offsets.length}…`, current: i + 1, total: offsets.length });
      const offset = offsets[i];
      if (offset === undefined) {
        throw new Error(`internal error: missing tile offset at index ${i}`);
      }

      const scrolled = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrollContainerBySelector,
        args: [selector.attr, selector.value, offset],
      });
      if (!scrolled[0]?.result) {
        throw new NoScrollContainerSelectedError();
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

      if (isCancelled()) {
        throw new CaptureCancelledError();
      }

      const { width, height, rgba } = await decodeAndCropPngDataUrlToRgba(dataUrl, rect, rect.devicePixelRatio);
      tileWidths.push(width);
      tileHeights.push(height);
      rgbaChunks.push(rgba);
    }

    onProgress({ text: "Processing…" });
    const concatenated = concatenateRgba(rgbaChunks);
    const dpr = rect.devicePixelRatio;
    const { bytes, mimeType } = encodeComposite(
      exportFormat,
      pdfOptions,
      offsets,
      metrics.clientWidth,
      metrics.clientHeight,
      dpr,
      tileWidths,
      tileHeights,
      concatenated,
    );

    return {
      bytes,
      mimeType,
      width: tileWidths[0] ?? 0,
      height: Math.round(metrics.scrollHeight * dpr),
    };
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: scrollContainerBySelector,
      args: [selector.attr, selector.value, 0],
    });
  }
}

export interface MarkdownExportResult {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Export Markdown: extracts a semantic AST directly from the live DOM
 * (no scrolling or tiling — unlike the image capture modes, this reads
 * the whole document as it already is) and renders it via the same
 * sanitizing Rust writer used for PNG/PDF's shared core.
 */
export async function exportMarkdown(tabId: number, mode: MarkdownMode): Promise<MarkdownExportResult> {
  await ensureWasm();
  const tab = await getCapturableTab(tabId);

  const [{ result: ast }] = (await chrome.scripting.executeScript({
    target: { tabId },
    func: extractMarkdownAst,
    args: [mode],
  })) as unknown as [{ result: { children: unknown[] } }];

  const json = JSON.stringify(ast);
  const md = markdownFromJson(json, tab.title ?? "", tab.url ?? "", new Date().toISOString());
  const bytes = new TextEncoder().encode(md);
  return { bytes, mimeType: "text/markdown" };
}
