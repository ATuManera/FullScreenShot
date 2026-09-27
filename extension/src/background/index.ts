// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";
import { CaptureCancelledError, captureFullPage, captureScrollArea, captureVisible, exportMarkdown, PageNotCapturableError, type CaptureProgress } from "../capture/orchestrator.js";
import { abortSelectionPicker, runSelectionPicker, CONTAINER_SELECTOR_ATTR, type ContainerSelector } from "../capture/selection.js";
import { parseSelectionMessage, type SelectionAck, type SelectionOutcome } from "../capture/selectionProtocol.js";
import { detectScrollCandidates, keepScrollCandidates, locatePageScroller } from "../capture/scrollDetectionInjectable.js";
import { rankAndDeduplicate } from "../capture/scrollAnalysis.js";
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
  /** PDF only: whether a text layer was really written into the file. */
  textLayer?: boolean;
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
 * Identifies the capture currently running, so every message it emits can be
 * attributed to it and a late update from a finished capture can be
 * recognised as such by the popup.
 */
let captureSessionId: string | null = null;

/**
 * Pushes an update to whichever popup instance is currently open, if
 * any. `chrome.runtime.sendMessage` has no persistent-connection state
 * to go stale: if no popup is listening, the call simply has no
 * receiver — this is the expected, harmless case (capture continues in
 * the background regardless of whether the popup is open), not an
 * error, so the rejection is swallowed rather than surfaced.
 */
function broadcast(message: OutboundMessage): void {
  chrome.runtime.sendMessage(captureSessionId ? { ...message, sessionId: captureSessionId } : message).catch(() => {
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

    function onSelectionMessage(raw: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response: SelectionAck) => void): void {
      const parsed = parseSelectionMessage(raw, requestId);
      if (!parsed) {
        // Not this selection's answer — a stale picker from an earlier
        // session, or an unrelated message. Left unacknowledged on purpose,
        // so a picker that is talking to nobody stops rather than retrying.
        return;
      }
      // Acknowledged before settling: the page needs to know its outcome
      // landed, or it will keep retrying and eventually give up believing
      // the extension is gone.
      sendResponse({ received: true });
      settle(parsed);
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
        // between the popup's analysis and now. Reported as its own outcome,
        // because "there is nothing here to pick" is a different thing to
        // tell someone than "you chose not to pick".
        if (injected?.result === 0) {
          settle({ status: "no-candidates" });
          return;
        }
        // The page now has a picker on it. Saying so is what lets the popup
        // step aside: while it is open it holds the keyboard, so the first
        // Escape only dismisses the popup and never reaches the picker.
        broadcast({ type: "PICKER_ARMED" });
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

/**
 * How a capture ended. Cancelling is not failing: backing out of the
 * scroll-area picker with Escape has to reach the popup as a cancellation,
 * not as "No area selected", which is what the page says when there was
 * nothing to pick in the first place.
 */
type CaptureOutcome =
  | { kind: "export"; result: ResolvedExport }
  | { kind: "cancelled" }
  | { kind: "no-container" };

async function resolveResult(msg: StartCaptureMessage, tabId: number, send: (message: OutboundMessage) => void, isCancelled: () => boolean): Promise<CaptureOutcome> {
  const onProgress = (progress: CaptureProgress): void => reportProgress(msg.mode, progress, send);

  if (msg.mode === "visible") {
    return { kind: "export", result: await captureVisible(tabId) };
  }
  if (msg.mode === "fullpage") {
    // A page whose body scrolls instead of its root is one screen tall as far
    // as the window is concerned; its content is captured from the body, the
    // way a scroll area is. Reliable's pre-scroll drives the window, so it
    // does not apply on such a page.
    const [{ result: pageScroller }] = (await chrome.scripting.executeScript({
      target: { tabId },
      func: locatePageScroller,
      args: [CONTAINER_SELECTOR_ATTR],
    })) as unknown as [{ result: ContainerSelector | null }];
    if (pageScroller) {
      return {
        kind: "export",
        result: await captureScrollArea(tabId, pageScroller, onProgress, isCancelled, msg.exportFormat, {
          pageSize: msg.pdfPageSize,
          orientation: msg.pdfOrientation,
        }),
      };
    }
    return {
      kind: "export",
      result: await captureFullPage(tabId, onProgress, isCancelled, msg.lazyMode, msg.exportFormat, {
        pageSize: msg.pdfPageSize,
        orientation: msg.pdfOrientation,
      }),
    };
  }
  if (msg.mode === "markdown") {
    onProgress({ text: "Reading page…" });
    const result = await exportMarkdown(tabId, msg.markdownMode);
    return { kind: "export", result: { ...result, width: 0, height: 0 } };
  }

  // "scrollarea": the same detection and deduplication the popup ran decide
  // the path — one region is captured directly, several go to the picker.
  // It is re-run here rather than trusted from the popup, because the page
  // may have changed since; the picker then offers exactly these regions.
  onProgress({ text: "Locating scroll area…" });
  const [{ result: detected }] = (await chrome.scripting.executeScript({
    target: { tabId },
    func: detectScrollCandidates,
    args: [CONTAINER_SELECTOR_ATTR],
  })) as unknown as [{ result: ReturnType<typeof detectScrollCandidates> }];
  const regions = rankAndDeduplicate(detected ?? []);
  const keep = regions.map((r) => String(r.index));
  await chrome.scripting.executeScript({
    target: { tabId },
    func: keepScrollCandidates,
    args: [CONTAINER_SELECTOR_ATTR, keep],
  });

  if (regions.length === 0) {
    return { kind: "no-container" };
  }
  let selector: ContainerSelector;
  if (keep.length === 1 && keep[0] !== undefined) {
    selector = { attr: CONTAINER_SELECTOR_ATTR, value: keep[0] };
  } else {
    // Through `onProgress`, not a bare broadcast: the authoritative state has
    // to say the extension is waiting for a choice, or a popup reopened
    // mid-selection reconstructs the wrong thing from GET_STATE.
    onProgress({ text: "Choose a scroll area on the page (Esc to cancel)…" });
    const outcome = await pickScrollArea(tabId);
    if (outcome.status === "error") {
      throw new Error(outcome.message);
    }
    if (outcome.status === "cancelled") {
      return { kind: "cancelled" };
    }
    if (outcome.status === "no-candidates") {
      return { kind: "no-container" };
    }
    selector = outcome.selector;
  }

  return {
    kind: "export",
    result: await captureScrollArea(tabId, selector, onProgress, isCancelled, msg.exportFormat, {
      pageSize: msg.pdfPageSize,
      orientation: msg.pdfOrientation,
    }),
  };
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

    const outcome = await resolveResult(msg, tab.id, broadcast, isCancelled);
    if (outcome.kind !== "export") {
      // Released before the terminal message goes out, so a popup that
      // reopens on hearing it can never be told a capture is still running.
      active = null;
      clearBadge();
      broadcast(outcome.kind === "cancelled" ? { type: "CANCELLED" } : { type: "NO_CONTAINER_SELECTED" });
      return;
    }
    const result = outcome.result;

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
      // Recorded only when the composer actually placed text: the Result
      // Page must not describe a PDF as searchable on the strength of the
      // export format alone.
      if (result.textLayer !== undefined) {
        metadata.textLayer = result.textLayer;
      }
    }
    await saveResult(resultId, new Blob([new Uint8Array(result.bytes)], { type: result.mimeType }), filename, metadata);

    await chrome.tabs.create({ url: chrome.runtime.getURL(`result/result.html?id=${encodeURIComponent(resultId)}`) });

    setBadgeSuccess();
    // Released before anyone is told the capture ended, so a popup that
    // answers a terminal message with GET_STATE can never be told a capture
    // is still running.
    active = null;
    broadcast({ type: "DONE", resultId, width: result.width, height: result.height });
  } catch (e) {
    active = null;
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
    captureSessionId = null;
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
    sendResponse({ ...buildStateMessage(active), ...(captureSessionId ? { sessionId: captureSessionId } : {}) });
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
  // Minted before the reply so the popup learns which capture is its own, and
  // can tell this capture's later messages from a previous one's.
  captureSessionId = crypto.randomUUID();
  sendResponse({ type: "STARTED", sessionId: captureSessionId });
  void runCapture(message, () => cancelRequested);
  return false;
});
