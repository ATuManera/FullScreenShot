// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Pure decisions around the background's single authoritative capture
 * slot (UX-P3 8.3/8.9) — no chrome.* here, so these are directly
 * testable without a browser mock.
 */
import type { CaptureMode, StateMessage } from "./messages.js";

export interface ActiveCapture {
  mode: CaptureMode;
  progress: { text: string; current?: number; total?: number };
}

/** A second capture must be refused (not queued) whenever one is already running. */
export function shouldRefuseNewCapture(active: ActiveCapture | null): boolean {
  return active !== null;
}

/** Builds the reply to a GET_STATE query from the current authoritative slot. */
export function buildStateMessage(active: ActiveCapture | null): StateMessage {
  return {
    type: "STATE",
    active: active !== null,
    mode: active?.mode,
    progress: active?.progress,
  };
}
