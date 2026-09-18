// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";
import { CaptureCancelledError, captureFullPage, captureScrollArea, captureVisible, exportMarkdown, PageNotCapturableError, type CaptureProgress } from "../capture/orchestrator.js";
import { enterSelectionMode, type ContainerSelector } from "../capture/selection.js";
import { selectSoleScrollCandidate } from "../capture/scrollDetectionInjectable.js";
import { clearBadge, setBadgeError, setBadgeIndeterminate, setBadgeProgress, setBadgeSuccess } from "./badge.js";
import { parseInboundMessage, type CaptureMode, type OutboundMessage, type StartCaptureMessage } from "./messages.js";
import { buildStateMessage, shouldRefuseNewCapture, type ActiveCapture } from "./captureGuard.js";
import { buildFilename } from "../popup/filename.js";
import { saveResult, type ResultMetadata } from "../shared/resultStore.js";

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

/**
 * Cancellation flag for whatever capture is currently active. A plain
 * module-level flag (rather than a per-connection closure, as the
 * earlier port-based design used) is sufficient and correct because
 * `shouldRefuseNewCapture` already guarantees at most one capture runs
 * at a time — there is never more than one cancellation to track.
 */
let cancelRequested = false;

/**
 * Pushes an update to whichever popup instance is currently open, if
 * any. `chrome.runtime.sendMessage` has no persistent-connection state
 * to go stale: if no popup is listening, the call simply has no
 * receiver — this is the expected, harmless case (capture continues in
 * the background regardless of whether the popup is open), not an
 * error, so the rejection is swallowed rather than surfaced.
 */
function broadcast(message: OutboundMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // No popup open to receive it — expected, not a failure.
  });
}

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

async function runCapture(msg: StartCaptureMessage, isCancelled: () => boolean): Promise<void> {
  active = { mode: msg.mode, progress: { text: "Preparing…" } };
  broadcast({ type: "PROGRESS", text: "Preparing…" });
  setBadgeIndeterminate();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) {
      broadcast({ type: "ERROR", message: "No active tab to capture." });
      return;
    }

    const result = await resolveResult(msg, tab.id, broadcast, isCancelled);
    if (!result) {
      return;
    }

    reportProgress(msg.mode, { text: "Preparing download…" }, broadcast);
    const resultId = randomResultId();
    const filename = buildFilename({
      hostname: hostnameOf(tab.url),
      title: tab.title ?? "",
      date: new Date(),
      ext: extensionFor(result.mimeType),
    });
    // width/height come from the capture pipeline's already-decoded raster
    // (or the PDF's underlying page raster) — never re-decoded here just to
    // display a number. Markdown reports 0/0 (no such thing as pixel
    // dimensions for it), which is deliberately omitted from metadata
    // rather than stored as a misleading "0 × 0".
    const metadata: ResultMetadata = {};
    if (result.width > 0 && result.height > 0) {
      metadata.width = result.width;
      metadata.height = result.height;
    }
    if (result.mimeType === "application/pdf") {
      metadata.pdfPageSize = msg.pdfPageSize;
      metadata.pdfOrientation = msg.pdfOrientation;
    }
    await saveResult(resultId, new Blob([new Uint8Array(result.bytes)], { type: result.mimeType }), filename, metadata);

    await chrome.tabs.create({ url: chrome.runtime.getURL(`result/result.html?id=${encodeURIComponent(resultId)}`) });

    setBadgeSuccess();
    broadcast({ type: "DONE", resultId, width: result.width, height: result.height });
  } catch (e) {
    if (e instanceof CaptureCancelledError) {
      clearBadge();
      broadcast({ type: "CANCELLED" });
      return;
    }
    if (e instanceof PageNotCapturableError) {
      setBadgeError();
      broadcast({ type: "ERROR", message: e.message });
      return;
    }
    setBadgeError();
    broadcast({ type: "ERROR", message: e instanceof Error ? e.message : String(e) });
  } finally {
    active = null;
  }
}

/**
 * Discrete, stateless commands from the popup — see messages.ts's doc
 * comment for why `sendMessage`/`onMessage` replaced a long-lived Port.
 * Every branch calls `sendResponse` synchronously, so the listener
 * always returns `false` (there is nothing pending to answer later).
 */
chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse: (response: OutboundMessage) => void) => {
  const message = parseInboundMessage(raw);
  if (!message) {
    return false;
  }

  if (message.type === "GET_STATE") {
    sendResponse(buildStateMessage(active));
    return false;
  }

  if (message.type === "CANCEL") {
    cancelRequested = true;
    sendResponse(buildStateMessage(active));
    return false;
  }

  // START_CAPTURE
  if (shouldRefuseNewCapture(active)) {
    sendResponse({ type: "ALREADY_CAPTURING" });
    return false;
  }
  cancelRequested = false;
  sendResponse({ type: "STARTED" });
  void runCapture(message, () => cancelRequested);
  return false;
});
