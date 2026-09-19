// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Message contract between popup.ts and background/index.ts.
 *
 * Transport: `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`,
 * not a long-lived `chrome.runtime.connect` port. A port opened once at
 * popup-load time and reused for the popup's whole lifetime silently
 * goes stale whenever the (ephemeral, MV3) background service worker
 * restarts in between — any later `port.postMessage()` then throws
 * "Attempting to use a disconnected port object". `sendMessage` has no
 * such staleness: every call is a fresh, self-contained request that
 * wakes the service worker if needed. Commands (GET_STATE, CANCEL,
 * START_CAPTURE) go through `sendMessage` and get a synchronous
 * `sendResponse` reply; progress/result updates that happen later,
 * asynchronously, during a capture (PROGRESS, DONE, CANCELLED, ERROR,
 * NO_CONTAINER_SELECTED) are pushed by the background calling
 * `chrome.runtime.sendMessage` itself, received by the popup's
 * `chrome.runtime.onMessage` listener — which simply hears nothing if
 * the popup is closed, matching "the popup is not the authoritative
 * owner of an active capture; background/service-worker state is".
 *
 * Every inbound message is validated by `parseInboundMessage` — never
 * trust a runtime message's shape, per the extension's threat model
 * (SECURITY.md: "extension message spoofing", "unexpected messages").
 */

export type CaptureMode = "visible" | "fullpage" | "scrollarea" | "markdown";
export type ExportFormat = "png" | "pdf";
export type PdfPageSize = "a4" | "letter" | "auto";
export type PdfOrientation = "portrait" | "landscape";
export type MarkdownExportMode = "article" | "full-dom";
/**
 * How much work Full Page does to bring lazy/dynamic content in before it
 * starts capturing. Mirrors `LazyModePreference` in popup/preferences.ts (the
 * persisted setting) and `LazyMode` in capture/orchestrator.ts (what the
 * capture loop takes) — this is the value's shape while it is in transit.
 */
export type LazyCaptureMode = "fast" | "reliable";

export interface StartCaptureMessage {
  type: "START_CAPTURE";
  mode: CaptureMode;
  exportFormat: ExportFormat;
  pdfPageSize: PdfPageSize;
  pdfOrientation: PdfOrientation;
  markdownMode: MarkdownExportMode;
  /**
   * Carried explicitly rather than re-read from storage by the background:
   * the capture must use the setting as it stood when the user pressed the
   * button, and the background has no business reaching into the popup's
   * preferences. Omitting this field used to be the only option, which is
   * precisely why Reliable had no effect — the background hard-coded "fast".
   */
  lazyMode: LazyCaptureMode;
}

export interface CancelMessage {
  type: "CANCEL";
}

/** Sent when the popup (re)opens, to reconstruct UI state if a capture is already running. */
export interface GetStateMessage {
  type: "GET_STATE";
}

export type InboundMessage = StartCaptureMessage | CancelMessage | GetStateMessage;

/**
 * Identifies the capture a lifecycle message belongs to.
 *
 * `chrome.runtime.sendMessage` gives no ordering guarantee between separate
 * calls, so a PROGRESS sent moments before a capture failed can be delivered
 * after the ERROR that ended it — putting "Processing…", a progress bar and
 * Cancel back on screen underneath "Capture failed". Tagging each message
 * with its capture lets the popup recognise an update from a capture that has
 * already finished and drop it, instead of trusting arrival order.
 */
export interface CaptureSession {
  sessionId?: string;
}

export interface ProgressMessage extends CaptureSession {
  type: "PROGRESS";
  text: string;
  current?: number;
  total?: number;
}

export interface DoneMessage extends CaptureSession {
  type: "DONE";
  resultId: string;
  width: number;
  height: number;
}

export interface CancelledMessage extends CaptureSession {
  type: "CANCELLED";
}

export interface ErrorMessage extends CaptureSession {
  type: "ERROR";
  /** Raw technical message — the popup maps this to friendly copy for display and logs the raw text to console. */
  message: string;
}

export interface NoContainerSelectedMessage extends CaptureSession {
  type: "NO_CONTAINER_SELECTED";
}

/** A capture is already running (in this or another popup instance); the new request was refused, not queued. */
export interface AlreadyCapturingMessage {
  type: "ALREADY_CAPTURING";
}

/** Synchronous reply to a START_CAPTURE that was accepted; the capture itself proceeds asynchronously. */
export interface StartedMessage {
  type: "STARTED";
}

/** Reply to GetStateMessage: whether a capture is active right now, and its last known progress. */
export interface StateMessage extends CaptureSession {
  type: "STATE";
  active: boolean;
  mode?: CaptureMode;
  progress?: { text: string; current?: number; total?: number };
}

export type OutboundMessage =
  | ProgressMessage
  | DoneMessage
  | CancelledMessage
  | ErrorMessage
  | NoContainerSelectedMessage
  | AlreadyCapturingMessage
  | StateMessage
  | StartedMessage;

function isCaptureMode(value: unknown): value is CaptureMode {
  return value === "visible" || value === "fullpage" || value === "scrollarea" || value === "markdown";
}

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "png" || value === "pdf";
}

function isPdfPageSize(value: unknown): value is PdfPageSize {
  return value === "a4" || value === "letter" || value === "auto";
}

function isPdfOrientation(value: unknown): value is PdfOrientation {
  return value === "portrait" || value === "landscape";
}

function isMarkdownExportMode(value: unknown): value is MarkdownExportMode {
  return value === "article" || value === "full-dom";
}

function isLazyCaptureMode(value: unknown): value is LazyCaptureMode {
  return value === "fast" || value === "reliable";
}

/** Validates an untrusted message received on the capture port. */
export function parseInboundMessage(raw: unknown): InboundMessage | null {
  if (typeof raw !== "object" || raw === null || !("type" in raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.type === "CANCEL") {
    return { type: "CANCEL" };
  }
  if (candidate.type === "GET_STATE") {
    return { type: "GET_STATE" };
  }
  if (candidate.type === "START_CAPTURE") {
    const mode = candidate.mode;
    const exportFormat = candidate.exportFormat ?? "png";
    const pdfPageSize = candidate.pdfPageSize ?? "auto";
    const pdfOrientation = candidate.pdfOrientation ?? "portrait";
    const markdownMode = candidate.markdownMode ?? "article";
    // An absent field takes the documented default (same rule every other
    // optional field here follows); a *present but unrecognised* one rejects
    // the whole message rather than being quietly coerced.
    const lazyMode = candidate.lazyMode ?? "fast";
    if (isCaptureMode(mode) && isExportFormat(exportFormat) && isPdfPageSize(pdfPageSize) && isPdfOrientation(pdfOrientation) && isMarkdownExportMode(markdownMode) && isLazyCaptureMode(lazyMode)) {
      return { type: "START_CAPTURE", mode, exportFormat, pdfPageSize, pdfOrientation, markdownMode, lazyMode };
    }
  }
  return null;
}
