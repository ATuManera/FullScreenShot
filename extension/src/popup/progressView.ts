// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Pure decision logic for the popup's busy/progress UI (final Chrome
 * polish pass) — factored out of popup.ts so "should the progress bar
 * and Cancel button be visible right now" is directly testable without
 * a DOM. Scroll-area analysis (`analyzeScrollAreas` in popup.ts) never
 * calls into this module at all, which is what keeps it from ever
 * masquerading as capture progress (section 20): there is no message
 * type here for "analyzing".
 */
import type {
  AlreadyCapturingMessage,
  CancelledMessage,
  DoneMessage,
  ErrorMessage,
  NoContainerSelectedMessage,
  ProgressMessage,
  StateMessage,
} from "../background/messages.js";

export type ProgressRelevantMessage =
  | StateMessage
  | ProgressMessage
  | DoneMessage
  | CancelledMessage
  | ErrorMessage
  | NoContainerSelectedMessage
  | AlreadyCapturingMessage;

export interface ProgressUiState {
  /** Whether the progress bar + Cancel button should be visible. */
  busy: boolean;
  /** `null` means "leave whatever text is already shown" (nothing to say for this transition). */
  progressText: string | null;
  progressCurrent?: number;
  progressTotal?: number;
}

const IDLE: ProgressUiState = { busy: false, progressText: null };

/**
 * Whether an update describes a capture that has already reached a terminal
 * state, and so must not be allowed to put the busy UI back on screen.
 *
 * Two kinds of message can say "still working" about a capture that is over.
 * A `GET_STATE` reply is a snapshot of the moment it was answered, so one
 * requested just before a capture failed still reads "Processing…" by the
 * time it arrives — which is what a popup reopened near the end of a capture
 * asks for. And `chrome.runtime.sendMessage` gives no ordering guarantee
 * between separate calls, so a PROGRESS can simply overtake the ERROR that
 * ended its capture. Either one leaves a progress bar and Cancel sitting
 * under "Capture failed". Arrival order cannot be trusted; the capture's own
 * identity can.
 *
 * Terminal messages are never stale — they are what makes a session finished
 * — and an idle STATE contradicts nothing, so both are always applied.
 */
export function describesAFinishedCapture(message: ProgressRelevantMessage, finishedSessionId: string | null): boolean {
  if (finishedSessionId === null) {
    return false;
  }
  if (message.type === "STATE") {
    return message.active && message.sessionId === finishedSessionId;
  }
  if (message.type === "PROGRESS") {
    return message.sessionId === finishedSessionId;
  }
  return false;
}

/**
 * The single source of truth for "what should the popup's busy/progress
 * UI look like after this message" — every background message that can
 * affect it maps to exactly one state here (section 19's IDLE/CAPTURING
 * matrix): STATE(inactive)/DONE/CANCELLED/ERROR/NO_CONTAINER_SELECTED
 * all clear busy; STATE(active)/PROGRESS/ALREADY_CAPTURING set it.
 */
export function progressStateForMessage(message: ProgressRelevantMessage): ProgressUiState {
  switch (message.type) {
    case "STATE":
      if (!message.active) return IDLE;
      return {
        busy: true,
        progressText: message.progress?.text ?? null,
        progressCurrent: message.progress?.current,
        progressTotal: message.progress?.total,
      };
    case "PROGRESS":
      return { busy: true, progressText: message.text, progressCurrent: message.current, progressTotal: message.total };
    case "DONE":
      return { busy: false, progressText: "Capture ready" };
    case "CANCELLED":
      return { busy: false, progressText: "Cancelled — page restored" };
    case "NO_CONTAINER_SELECTED":
      return IDLE;
    case "ERROR":
      return IDLE;
    case "ALREADY_CAPTURING":
      // A capture genuinely is running (elsewhere or in this popup) —
      // busy stays true; the real progress text arrives moments later
      // via a fresh GET_STATE (popup.ts) rather than being fabricated here.
      return { busy: true, progressText: null };
  }
}
