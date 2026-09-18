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
import { progressStateForMessage } from "../../dist/chromium/popup/progressView.js";

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
