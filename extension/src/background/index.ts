// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";
import { CaptureCancelledError, captureFullPage, captureScrollArea, captureVisible, exportMarkdown, PageNotCapturableError, type CaptureProgress } from "../capture/orchestrator.js";
import { abortSelectionPicker, runSelectionPicker, CONTAINER_SELECTOR_ATTR, type ContainerSelector } from "../capture/selection.js";
import { parseSelectionMessage, type SelectionOutcome } from "../capture/selectionProtocol.js";
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

/**
 * How long the picker may stay open before it gives up on its own. This is a
 * safeguard behind the real lifecycle (click, click-elsewhere, Escape,
 * navigation and tab closure all settle it), not the mechanism — the page-side
 * picker runs the same deadline, so the overlay is removed even if this worker
 * is gone by then.
 */
const SELECTION_WATCHDOG_MS = 90_000;
/**
 * An MV3 service worker is evicted after ~30s without activity, and waiting
 * for a human to click is exactly that kind of silence. A bounded no-op API
 * call keeps the worker resident for the selection window only; it is cleared
 * on every exit path and never outlives `SELECTION_WATCHDOG_MS`.
 */
const SELECTION_HEARTBEAT_MS = 20_000;

/** Lets a CANCEL command reach an in-flight selection, which is not inside `runCapture`'s loop. */
let abortActiveSelection: (() => void) | null = null;

/**
 * Runs the interactive picker and resolves with exactly one terminal outcome.
 *
 * The previous design awaited a single `executeScript` call whose injected
 * Promise resolved only on a click, so a click on anything that was not a
 * candidate settled nothing at all and the capture stayed pending forever with
 * the page left decorated. The picker now reports through an ordinary runtime
 * message, and every way the flow can end — selection, cancellation, the tab
 * going away, the user pressing Cancel, or the deadline — resolves this
 * promise and tears the picker down.
 */
async function pickScrollArea(tabId: number): Promise<SelectionOutcome> {
  const requestId = crypto.randomUUID();

  const outcome = await new Promise<SelectionOutcome>((resolve) => {
    let settled = false;
    const settle = (value: SelectionOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.runtime.onMessage.removeListener(onSelectionMessage);
      chrome.tabs.onRemoved.removeListener(onTabRemoved);
      clearInterval(heartbeat);
      clearTimeout(watchdog);
      abortActiveSelection = null;
      resolve(value);
    };

    function onSelectionMessage(raw: unknown): void {
      const parsed = parseSelectionMessage(raw, requestId);
      if (parsed) {
        settle(parsed);
      }
    }
    function onTabRemoved(closedTabId: number): void {
      if (closedTabId === tabId) {
        settle({ status: "error", message: "The tab was closed during scroll-area selection." });
      }
    }

    const heartbeat = setInterval(() => {
      void chrome.runtime.getPlatformInfo().catch(() => undefined);
    }, SELECTION_HEARTBEAT_MS);
    const watchdog = setTimeout(() => settle({ status: "cancelled" }), SELECTION_WATCHDOG_MS);

    chrome.runtime.onMessage.addListener(onSelectionMessage);
    chrome.tabs.onRemoved.addListener(onTabRemoved);
    abortActiveSelection = () => settle({ status: "cancelled" });

    chrome.scripting
      .executeScript({
        target: { tabId },
        func: runSelectionPicker,
        args: [CONTAINER_SELECTOR_ATTR, requestId, SELECTION_WATCHDOG_MS],
      })
      .then(([injected]) => {
        // No candidates left by the time the picker ran: the page changed
        // between the popup's analysis and now. Report it rather than
        // leaving the user staring at a page with nothing to click.
        if (injected?.result === 0) {
          settle({ status: "cancelled" });
        }
      })
      .catch((e: unknown) => settle({ status: "error", message: e instanceof Error ? e.message : String(e) }));
  });

  // Whatever ended the selection, the page must not keep the picker. Clicking,
  // Escape and the page-side deadline already clean up; this covers the paths
  // that ended out here (Cancel, tab-level failures, the worker's watchdog).
  if (outcome.status !== "selected") {
    await chrome.scripting
      .executeScript({ target: { tabId }, func: abortSelectionPicker })
      .catch(() => undefined);
  }
  return outcome;
}

async function resolveResult(msg: StartCaptureMessage, tabId: number, send: (message: OutboundMessage) => void, isCancelled: () => boolean): Promise<ResolvedExport | null> {
  const onProgress = (progress: CaptureProgress): void => reportProgress(msg.mode, progress, send);

  if (msg.mode === "visible") {
    return captureVisible(tabId);
  }
  if (msg.mode === "fullpage") {
    return captureFullPage(tabId, onProgress, isCancelled, msg.lazyMode, msg.exportFormat, {
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
    send({ type: "PROGRESS", text: "Choose a scroll area on the page (Esc to cancel)…" });
    const outcome = await pickScrollArea(tabId);
    if (outcome.status === "error") {
      throw new Error(outcome.message);
    }
    selector = outcome.status === "selected" ? outcome.selector : null;
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
    // A capture waiting on the picker is not inside `runCapture`'s loop, so
    // the polled `isCancelled` flag alone would never reach it.
    abortActiveSelection?.();
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
