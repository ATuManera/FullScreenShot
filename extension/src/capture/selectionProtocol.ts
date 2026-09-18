// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * The wire contract for "the user picked a scroll area".
 *
 * A DOM element cannot cross `executeScript`, extension messaging or a service
 * worker restart, and neither can a Promise: the previous design kept the
 * picker's outcome inside a Promise that the background awaited through a
 * single long-running `executeScript` call, which had no terminal outcome at
 * all if the click never arrived — the flow simply stayed pending and the page
 * kept the picker's outlines and listeners forever.
 *
 * Selection now crosses the boundary as an ordinary, structured-cloneable
 * runtime message tagged with the request it answers, so the background can
 * match it, ignore anything else, and always settle on exactly one of
 * selected / cancelled / error. Pure and untrusted-input-safe: like
 * `parseInboundMessage`, this never assumes a message's shape.
 */
import type { ContainerSelector } from "./selection.js";

export const SELECTION_MESSAGE_TYPE = "SCROLL_AREA_SELECTION";

export type SelectionOutcome =
  | { status: "selected"; selector: ContainerSelector }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/**
 * Validates a runtime message and returns the outcome it carries, or `null`
 * when it is not this request's answer (wrong request id, wrong type, or
 * malformed — all treated identically: not an answer).
 */
export function parseSelectionMessage(raw: unknown, expectedRequestId: string): SelectionOutcome | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.type !== SELECTION_MESSAGE_TYPE || candidate.requestId !== expectedRequestId) {
    return null;
  }
  if (candidate.status === "cancelled") {
    return { status: "cancelled" };
  }
  if (candidate.status === "error") {
    return { status: "error", message: typeof candidate.message === "string" ? candidate.message : "Scroll-area selection failed." };
  }
  if (candidate.status === "selected") {
    const { attr, value } = candidate;
    if (typeof attr === "string" && typeof value === "string") {
      return { status: "selected", selector: { attr, value } };
    }
  }
  return null;
}
