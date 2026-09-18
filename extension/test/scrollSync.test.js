// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SCROLL_POSITION_TOLERANCE_PX,
  allCapturedTilesIdentical,
  decideTile,
  fingerprintRgba,
} from "../../dist/chromium/capture/scrollSync.js";

// --- decideTile -----------------------------------------------------------
// The shipped bug this covers: `captureFullPage` requested a scroll and then
// trusted the *requested* offset as the tile's band origin without ever
// reading `window.scrollY` back, so a page that refused to scroll produced N
// identical viewports stitched into one tall "full page" PNG.

test("first tile is always captured", () => {
  const d = decideTile({ requestedY: 0, actualY: 0, maxScrollY: 5000, previousActualY: null });
  assert.deepEqual(d, { kind: "capture", offsetY: 0 });
});

test("a tile that reached its requested position is captured at that position", () => {
  const d = decideTile({ requestedY: 617, actualY: 617, maxScrollY: 5000, previousActualY: 0 });
  assert.deepEqual(d, { kind: "capture", offsetY: 617 });
});

test("the tile's band origin is the actual position, not the requested one", () => {
  // Chrome clamped the scroll: the plan asked for 5359 but the live page only
  // reaches 5000. The band must be recorded where the pixels really came from.
  const d = decideTile({ requestedY: 5359, actualY: 5000, maxScrollY: 5000, previousActualY: 4400 });
  assert.deepEqual(d, { kind: "capture", offsetY: 5000 });
});

test("a scroll request the page silently refused aborts instead of duplicating", () => {
  const d = decideTile({ requestedY: 617, actualY: 0, maxScrollY: 5359, previousActualY: 0 });
  assert.deepEqual(d, { kind: "abort", reason: "did-not-move" });
});

test("bottom clamping onto an already-captured position is skipped, never stitched twice", () => {
  // Requested beyond the live maximum and the viewport is already represented
  // by the previous tile: drop it rather than emit a duplicate band.
  const d = decideTile({ requestedY: 5600, actualY: 5000, maxScrollY: 5000, previousActualY: 5000 });
  assert.deepEqual(d, { kind: "skip", reason: "duplicate-position" });
});

test("sub-pixel scroll differences are tolerated rather than treated as failure", () => {
  const drift = SCROLL_POSITION_TOLERANCE_PX / 2;
  const d = decideTile({ requestedY: 617, actualY: 617 - drift, maxScrollY: 5000, previousActualY: 0 });
  assert.equal(d.kind, "capture");
});

// --- allCapturedTilesIdentical -------------------------------------------
// Defense in depth for a page that reports a moving `scrollY` while the
// rendered pixels never change.

test("a multi-tile capture whose every screenshot is identical is rejected", () => {
  assert.equal(allCapturedTilesIdentical(["a", "a", "a"], [0, 617, 1234]), true);
});

test("a multi-tile capture with distinct screenshots is accepted", () => {
  assert.equal(allCapturedTilesIdentical(["a", "b", "c"], [0, 617, 1234]), false);
});

test("two identical bands on an otherwise varied page are not rejected", () => {
  // A genuinely blank stretch of page must not abort the whole capture.
  assert.equal(allCapturedTilesIdentical(["a", "b", "b", "c"], [0, 617, 1234, 1851]), false);
});

test("a single-tile capture is never rejected as duplicated", () => {
  assert.equal(allCapturedTilesIdentical(["a"], [0]), false);
});

test("identical screenshots at one single position are not a duplication failure", () => {
  assert.equal(allCapturedTilesIdentical(["a", "a"], [42, 42]), false);
});

// --- fingerprintRgba ------------------------------------------------------
test("identical rasters fingerprint identically and differing rasters do not", () => {
  const a = new Uint8Array(4096).fill(7);
  const b = new Uint8Array(4096).fill(7);
  const c = new Uint8Array(4096).fill(7);
  c[2048] = 9;
  assert.equal(fingerprintRgba(a), fingerprintRgba(b));
  assert.notEqual(fingerprintRgba(a), fingerprintRgba(c));
});

test("fingerprints distinguish rasters of different length", () => {
  assert.notEqual(fingerprintRgba(new Uint8Array(64).fill(1)), fingerprintRgba(new Uint8Array(128).fill(1)));
});
