// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday
//
// Runs against the compiled output (../../dist/chromium/capture/lazy.js)
// via Node's built-in test runner — no new dependency, no DOM required
// since capture/lazy.ts is pure. Run with `npm test` after `npm run build`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isStillGrowing, classifyPrescrollOutcome } from "../../dist/chromium/capture/lazy.js";

test("isStillGrowing is false with fewer than two samples", () => {
  assert.equal(isStillGrowing([]), false);
  assert.equal(isStillGrowing([1000]), false);
});

test("isStillGrowing is false when height is stable", () => {
  assert.equal(isStillGrowing([1000, 1000]), false);
});

test("isStillGrowing is false for growth within tolerance", () => {
  assert.equal(isStillGrowing([1000, 1010], 0.02), false); // 1% growth, 2% tolerance
});

test("isStillGrowing is true for growth beyond tolerance", () => {
  assert.equal(isStillGrowing([1000, 1050], 0.02), true); // 5% growth
});

test("classifyPrescrollOutcome settles when growth stops before the pass cap", () => {
  const samples = [1000, 1500, 1500];
  assert.equal(classifyPrescrollOutcome(samples, 8), "settled");
});

test("classifyPrescrollOutcome settles when the cap is reached but growth has stopped", () => {
  const samples = [1000, 1500, 1500, 1500];
  assert.equal(classifyPrescrollOutcome(samples, 4), "settled");
});

test("classifyPrescrollOutcome flags possibly-infinite when still growing at the cap", () => {
  const samples = [1000, 2000, 3000, 4000];
  assert.equal(classifyPrescrollOutcome(samples, 4), "possibly-infinite");
});
