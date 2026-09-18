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
