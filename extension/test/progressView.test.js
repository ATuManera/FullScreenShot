// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday
//
// Final Chrome UX polish (section 19/20): the popup must never show a
// stale progress bar/Cancel button once a capture is actually idle,
// and page-analysis must never masquerade as capture progress. These
// tests exercise the pure decision table behind popup.ts's busy UI,
// independent of the DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { describesAFinishedCapture, progressStateForMessage } from "../../dist/chromium/popup/progressView.js";

test("idle: an inactive STATE reply hides progress and Cancel", () => {
  const state = progressStateForMessage({ type: "STATE", active: false });
  assert.equal(state.busy, false);
});

test("capturing: an active STATE reply shows progress and Cancel with the last known text", () => {
  const state = progressStateForMessage({
    type: "STATE",
    active: true,
    mode: "fullpage",
    progress: { text: "Capturing 3 of 12…", current: 3, total: 12 },
  });
  assert.equal(state.busy, true);
  assert.equal(state.progressText, "Capturing 3 of 12…");
  assert.equal(state.progressCurrent, 3);
  assert.equal(state.progressTotal, 12);
});

test("capturing: a bare PROGRESS push shows progress and Cancel", () => {
  const state = progressStateForMessage({ type: "PROGRESS", text: "Preparing…" });
  assert.equal(state.busy, true);
  assert.equal(state.progressText, "Preparing…");
});

test("done: a DONE message returns to a clean, non-busy state", () => {
  const state = progressStateForMessage({ type: "DONE", resultId: "abc", width: 10, height: 20 });
  assert.equal(state.busy, false);
});

test("cancelled: a CANCELLED message returns to a clean, non-busy state", () => {
  const state = progressStateForMessage({ type: "CANCELLED" });
  assert.equal(state.busy, false);
});

test("error: an ERROR message returns to a clean, non-busy state (no stale progress bar after a failure)", () => {
  const state = progressStateForMessage({ type: "ERROR", message: "boom" });
  assert.equal(state.busy, false);
});

test("no container selected: returns to a clean, non-busy state", () => {
  const state = progressStateForMessage({ type: "NO_CONTAINER_SELECTED" });
  assert.equal(state.busy, false);
});

test("already capturing: stays busy (a capture genuinely is running) without fabricating progress text", () => {
  const state = progressStateForMessage({ type: "ALREADY_CAPTURING" });
  assert.equal(state.busy, true);
  assert.equal(state.progressText, null);
});

test("progressText of null means 'leave existing text alone', distinct from an empty string", () => {
  const state = progressStateForMessage({ type: "ALREADY_CAPTURING" });
  assert.notEqual(state.progressText, "");
  assert.equal(state.progressText, null);
});

// --- Terminal state must stay terminal -----------------------------------
// The physical failure: a capture that ended with "invalid dimensions" showed
// "Capture failed" with a progress bar, "Processing…" and Cancel still sitting
// underneath it. Arrival order is not a guarantee, so staleness is decided by
// which capture an update belongs to.

test("an error leaves no capture activity on screen", () => {
  const state = progressStateForMessage({ type: "ERROR", message: "capture is too large: 1660x8484" });
  assert.equal(state.busy, false, "progress bar and Cancel must be gone");
  assert.equal(state.progressText, null, "no leftover 'Processing…'");
});

test("a progress update overtaking the error that ended its capture is ignored", () => {
  const late = { type: "PROGRESS", text: "Processing…", sessionId: "capture-1" };
  assert.equal(describesAFinishedCapture(late, "capture-1"), true);
});

test("a state snapshot taken before the failure is ignored once it arrives", () => {
  // What a popup reopened near the end of a capture asks for: the reply
  // describes the moment it was answered, not the moment it is applied.
  const snapshot = { type: "STATE", active: true, mode: "fullpage", progress: { text: "Processing…" }, sessionId: "capture-1" };
  assert.equal(describesAFinishedCapture(snapshot, "capture-1"), true);
});

test("an idle state snapshot is never stale — it agrees the capture is over", () => {
  assert.equal(describesAFinishedCapture({ type: "STATE", active: false, sessionId: "capture-1" }, "capture-1"), false);
});

test("updates from the next capture are honoured, not suppressed", () => {
  assert.equal(describesAFinishedCapture({ type: "PROGRESS", text: "Preparing…", sessionId: "capture-2" }, "capture-1"), false);
  assert.equal(describesAFinishedCapture({ type: "STATE", active: true, progress: { text: "Preparing…" }, sessionId: "capture-2" }, "capture-1"), false);
});

test("terminal messages are never suppressed as stale", () => {
  for (const message of [
    { type: "ERROR", message: "boom", sessionId: "capture-1" },
    { type: "DONE", resultId: "r", width: 1, height: 1, sessionId: "capture-1" },
    { type: "CANCELLED", sessionId: "capture-1" },
    { type: "NO_CONTAINER_SELECTED", sessionId: "capture-1" },
  ]) {
    assert.equal(describesAFinishedCapture(message, "capture-1"), false, `${message.type} must always be applied`);
  }
});

test("before any capture has finished nothing is stale", () => {
  assert.equal(describesAFinishedCapture({ type: "PROGRESS", text: "Processing…", sessionId: "capture-1" }, null), false);
});

test("an update with no session identity is applied rather than guessed about", () => {
  // Backward compatibility: a message from a build that predates session ids
  // must still drive the UI.
  assert.equal(describesAFinishedCapture({ type: "PROGRESS", text: "Processing…" }, "capture-1"), false);
});

test("capturing then failing ends with an idle UI, not a half-busy one", () => {
  const capturing = progressStateForMessage({ type: "PROGRESS", text: "Capturing 9 of 10…", current: 9, total: 10 });
  assert.equal(capturing.busy, true);
  const failed = progressStateForMessage({ type: "ERROR", message: "capture is too large: 1660x8484" });
  assert.equal(failed.busy, false);
  assert.equal(failed.progressText, null);
});
