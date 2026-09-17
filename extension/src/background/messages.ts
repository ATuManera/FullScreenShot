// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Message contract between popup.ts and background/index.ts, carried over
 * a single `chrome.runtime.connect({ name: PORT_NAME })` port so the
 * background can push multiple progress updates during one capture.
 * Every inbound message is validated by `parseInboundMessage` — never
 * trust a runtime message's shape, per the extension's threat model
 * (SECURITY.md: "extension message spoofing", "unexpected messages").
 */
export const PORT_NAME = "fullscreenshot-capture";

export type CaptureMode = "visible" | "fullpage";

export interface StartCaptureMessage {
  type: "START_CAPTURE";
  mode: CaptureMode;
}

export interface CancelMessage {
  type: "CANCEL";
}

export type InboundMessage = StartCaptureMessage | CancelMessage;

export interface ProgressMessage {
  type: "PROGRESS";
  status: string;
}

export interface DoneMessage {
  type: "DONE";
  resultId: string;
  width: number;
  height: number;
}

export interface CancelledMessage {
  type: "CANCELLED";
}

export interface ErrorMessage {
  type: "ERROR";
  message: string;
}

export type OutboundMessage = ProgressMessage | DoneMessage | CancelledMessage | ErrorMessage;

function isCaptureMode(value: unknown): value is CaptureMode {
  return value === "visible" || value === "fullpage";
}

/** Validates an untrusted message received on the capture port. */
export function parseInboundMessage(raw: unknown): InboundMessage | null {
  if (typeof raw !== "object" || raw === null || !("type" in raw)) {
    return null;
  }
  const candidate = raw as { type: unknown };
  if (candidate.type === "CANCEL") {
    return { type: "CANCEL" };
  }
  if (candidate.type === "START_CAPTURE" && "mode" in raw) {
    const mode = (raw as { mode: unknown }).mode;
    if (isCaptureMode(mode)) {
      return { type: "START_CAPTURE", mode };
    }
  }
  return null;
}
