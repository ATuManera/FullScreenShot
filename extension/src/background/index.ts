// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";
import { CaptureCancelledError, captureFullPage, captureScrollArea, captureVisible, exportMarkdown, PageNotCapturableError, type CaptureProgress } from "../capture/orchestrator.js";
import { enterSelectionMode, type ContainerSelector } from "../capture/selection.js";
import { selectSoleScrollCandidate } from "../capture/scrollDetectionInjectable.js";
import { bytesToDataUrl } from "./bytes.js";
import { clearBadge, setBadgeError, setBadgeIndeterminate, setBadgeProgress, setBadgeSuccess } from "./badge.js";
import { parseInboundMessage, PORT_NAME, type CaptureMode, type OutboundMessage, type StartCaptureMessage } from "./messages.js";
import { buildStateMessage, shouldRefuseNewCapture, type ActiveCapture } from "./captureGuard.js";
import { buildFilename } from "../popup/filename.js";

const EXTENSION_FOR_MIME: Record<string, string> = {
  "image/png": "png",
  "application/pdf": "pdf",
  "text/markdown": "md",
};

function extensionFor(mimeType: string): string {
  return EXTENSION_FOR_MIME[mimeType] ?? "bin";
}

function hostnameOf(url: string | undefined): string {
  if (!url) {
    return "page";
  }
  try {
    return new URL(url).hostname || "page";
  } catch {
    return "page";
  }
}

console.log(`FullScreenShot background service worker started (v${browser.getManifestVersion()})`);

function randomResultId(): string {
  return crypto.randomUUID();
}

interface ResolvedExport {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Authoritative capture status, independent of any popup instance —
 * MV3 popups can close mid-capture, so the capture itself must not
 * depend on one staying open. Only one capture may run at a time.
 */
let active: ActiveCapture | null = null;

function reportProgress(mode: CaptureMode, progress: CaptureProgress, send: (message: OutboundMessage) => void): void {
  active = { mode, progress };
  send({ type: "PROGRESS", ...progress });
  if (progress.current !== undefined && progress.total !== undefined) {
    setBadgeProgress(progress.current, progress.total);
  } else {
    setBadgeIndeterminate();
  }
}

async function resolveResult(msg: StartCaptureMessage, tabId: number, send: (message: OutboundMessage) => void, isCancelled: () => boolean): Promise<ResolvedExport | null> {
  const onProgress = (progress: CaptureProgress): void => reportProgress(msg.mode, progress, send);

  if (msg.mode === "visible") {
    return captureVisible(tabId);
  }
  if (msg.mode === "fullpage") {
    return captureFullPage(tabId, onProgress, isCancelled, "fast", msg.exportFormat, {
      pageSize: msg.pdfPageSize,
      orientation: msg.pdfOrientation,
    });
  }
  if (msg.mode === "markdown") {
    onProgress({ text: "Reading page…" });
    const result = await exportMarkdown(tabId, msg.markdownMode);
    return { ...result, width: 0, height: 0 };
  }

  // "scrollarea": the popup already determined (via UX-P2's contextual
  // analysis) whether there's exactly one candidate (captured directly,
  // no overlay) or several (interactive picker). Try the direct path
  // first; if the page changed since analysis and it no longer holds,
  // fall back to the interactive picker rather than failing outright.
  onProgress({ text: "Locating scroll area…" });
  const [{ result: soleSelector }] = (await chrome.scripting.executeScript({
    target: { tabId },
    func: selectSoleScrollCandidate,
  })) as unknown as [{ result: ContainerSelector | null }];

  let selector = soleSelector;
  if (!selector) {
    send({ type: "PROGRESS", text: "Click a scrollable area on the page (Esc to cancel)…" });
    const [{ result: pickedSelector }] = (await chrome.scripting.executeScript({
      target: { tabId },
      func: enterSelectionMode,
    })) as unknown as [{ result: ContainerSelector | null }];
    selector = pickedSelector;
  }

  if (!selector) {
    send({ type: "NO_CONTAINER_SELECTED" });
    return null;
  }

  return captureScrollArea(tabId, selector, onProgress, isCancelled, msg.exportFormat, {
    pageSize: msg.pdfPageSize,
    orientation: msg.pdfOrientation,
  });
}

async function runCapture(msg: StartCaptureMessage, port: chrome.runtime.Port, isCancelled: () => boolean): Promise<void> {
  const send = (message: OutboundMessage): void => {
    try {
      port.postMessage(message);
    } catch {
      // Port closed (popup dismissed) — the capture keeps running so the
      // result is still stored, just not reported live.
    }
  };

  if (shouldRefuseNewCapture(active)) {
    send({ type: "ALREADY_CAPTURING" });
    return;
  }

  active = { mode: msg.mode, progress: { text: "Preparing…" } };
  send({ type: "PROGRESS", text: "Preparing…" });
  setBadgeIndeterminate();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) {
      send({ type: "ERROR", message: "No active tab to capture." });
      return;
    }

    const result = await resolveResult(msg, tab.id, send, isCancelled);
    if (!result) {
      return;
    }

    reportProgress(msg.mode, { text: "Preparing download…" }, send);
    const resultId = randomResultId();
    const dataUrl = bytesToDataUrl(result.bytes, result.mimeType);
    const filename = buildFilename({
      hostname: hostnameOf(tab.url),
      title: tab.title ?? "",
      date: new Date(),
      ext: extensionFor(result.mimeType),
    });
    await chrome.storage.session.set({ [resultId]: { dataUrl, filename } });

    await chrome.tabs.create({ url: chrome.runtime.getURL(`result/result.html?id=${encodeURIComponent(resultId)}`) });

    setBadgeSuccess();
    send({ type: "DONE", resultId, width: result.width, height: result.height });
  } catch (e) {
    if (e instanceof CaptureCancelledError) {
      clearBadge();
      send({ type: "CANCELLED" });
      return;
    }
    if (e instanceof PageNotCapturableError) {
      setBadgeError();
      send({ type: "ERROR", message: e.message });
      return;
    }
    setBadgeError();
    send({ type: "ERROR", message: e instanceof Error ? e.message : String(e) });
  } finally {
    active = null;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) {
    return;
  }

  let cancelled = false;

  port.onMessage.addListener((raw: unknown) => {
    const message = parseInboundMessage(raw);
    if (!message) {
      return;
    }
    if (message.type === "CANCEL") {
      cancelled = true;
      return;
    }
    if (message.type === "GET_STATE") {
      port.postMessage(buildStateMessage(active));
      return;
    }
    void runCapture(message, port, () => cancelled);
  });
});
