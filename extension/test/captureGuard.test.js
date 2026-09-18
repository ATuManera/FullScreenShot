// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRefuseNewCapture, buildStateMessage } from "../../dist/chromium/background/captureGuard.js";

test("no active capture: a new capture is allowed", () => {
  assert.equal(shouldRefuseNewCapture(null), false);
});

test("an active capture: a second capture is refused, not queued", () => {
  const active = { mode: "fullpage", progress: { text: "Capturing 3 of 12…", current: 3, total: 12 } };
  assert.equal(shouldRefuseNewCapture(active), true);
});

test("state message reports inactive with no mode/progress when nothing is running", () => {
  assert.deepEqual(buildStateMessage(null), { type: "STATE", active: false, mode: undefined, progress: undefined });
});

test("state message reports the active mode and last known progress for popup reconnection", () => {
  const active = { mode: "scrollarea", progress: { text: "Capturing 2 of 5…", current: 2, total: 5 } };
  assert.deepEqual(buildStateMessage(active), {
    type: "STATE",
    active: true,
    mode: "scrollarea",
    progress: { text: "Capturing 2 of 5…", current: 2, total: 5 },
  });
});

// Regression coverage (fix/ux-capture-runtime-regression): the full
// idle -> active -> second-request-rejected -> released state machine,
// driven only through the same pure decisions background/index.ts
// calls. `active` here stands in for the module-level slot in
// index.ts; index.ts's `finally { active = null }` always runs when a
// capture settles (done/cancelled/errored) regardless of whether the
// popup that started it is still around to hear about it — a popup
// disconnecting mid-capture never touches this slot, so it can never
// leave the guard stuck.
test("full lifecycle: idle accepts, active refuses a second request, release un-refuses", () => {
  let active = null;
  assert.equal(shouldRefuseNewCapture(active), false, "idle: a capture is accepted");

  active = { mode: "fullpage", progress: { text: "Preparing…" } };
  assert.equal(shouldRefuseNewCapture(active), true, "active: a second START_CAPTURE is refused, not queued");
  assert.deepEqual(buildStateMessage(active), { type: "STATE", active: true, mode: "fullpage", progress: { text: "Preparing…" } });

  // Simulates the popup disconnecting (closed tab, sendMessage stops
  // being delivered) mid-capture: nothing about the guard slot changes,
  // because it was never coupled to a specific popup/connection.
  const popupGoneButActiveUnaffected = active;
  assert.equal(shouldRefuseNewCapture(popupGoneButActiveUnaffected), true);

  // The capture settles (done, cancelled, or errored) — index.ts's
  // `finally` clears the slot unconditionally.
  active = null;
  assert.equal(shouldRefuseNewCapture(active), false, "released: a new capture is accepted again");
});

test("a popup disconnect alone (guard slot untouched) never permanently locks a completed/idle guard", () => {
  const active = null; // no capture was ever started by the disconnected popup
  assert.equal(shouldRefuseNewCapture(active), false);
});
