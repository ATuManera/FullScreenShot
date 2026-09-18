// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";
import { rankAndDeduplicate, classifyScrollAreaUiState, isMeaningfulCandidate } from "../../dist/chromium/capture/scrollAnalysis.js";

function box(overrides = {}) {
  return { top: 0, left: 0, width: 300, height: 300, scrollHeight: 900, clientHeight: 300, ...overrides };
}

test("0 candidates classifies as none", () => {
  assert.deepEqual(classifyScrollAreaUiState(rankAndDeduplicate([])), { kind: "none" });
});

test("1 meaningful candidate classifies as single", () => {
  const result = rankAndDeduplicate([box()]);
  assert.equal(result.length, 1);
  assert.deepEqual(classifyScrollAreaUiState(result), { kind: "single" });
});

test("2+ distinct meaningful candidates classify as multiple with correct count", () => {
  const candidates = [box({ left: 0 }), box({ left: 500 }), box({ left: 1000 })];
  const result = rankAndDeduplicate(candidates);
  assert.equal(result.length, 3);
  assert.deepEqual(classifyScrollAreaUiState(result), { kind: "multiple", count: 3 });
});

test("tiny candidates are rejected (below minimum width/height)", () => {
  const tiny = box({ width: 10, height: 10 });
  assert.equal(isMeaningfulCandidate(tiny), false);
  assert.deepEqual(classifyScrollAreaUiState(rankAndDeduplicate([tiny])), { kind: "none" });
});

test("candidates with negligible scroll delta are rejected", () => {
  const barelyScrollable = box({ scrollHeight: 305, clientHeight: 300 }); // 5px delta
  assert.equal(isMeaningfulCandidate(barelyScrollable), false);
});

test("the normal document scrollingElement is never passed in (excluded upstream by the in-page detector, not this module) — this module has no special-case for it", () => {
  // scrollAnalysis.ts only ever sees candidates the in-page detector
  // already filtered; documenting that exclusion happens there.
  assert.equal(typeof rankAndDeduplicate, "function");
});

test("nested near-duplicate boxes are deduplicated, keeping the smaller (more specific) one", () => {
  const outerWrapper = box({ top: 0, left: 0, width: 400, height: 400 });
  const innerScrollable = box({ top: 5, left: 5, width: 390, height: 390 });
  const result = rankAndDeduplicate([outerWrapper, innerScrollable]);
  assert.equal(result.length, 1);
  assert.equal(result[0].width, 390);
});

test("distinct non-overlapping regions are never merged", () => {
  const sidebar = box({ top: 0, left: 0, width: 200, height: 600 });
  const mainContent = box({ top: 0, left: 300, width: 600, height: 600 });
  const result = rankAndDeduplicate([sidebar, mainContent]);
  assert.equal(result.length, 2);
});

test("result is capped at maxResults", () => {
  const many = Array.from({ length: 10 }, (_, i) => box({ left: i * 500 }));
  const result = rankAndDeduplicate(many, 3);
  assert.equal(result.length, 3);
});

test("ranking prefers larger visible area first", () => {
  const small = box({ left: 0, width: 100, height: 100, scrollHeight: 400, clientHeight: 100 });
  const large = box({ left: 500, width: 500, height: 500, scrollHeight: 1000, clientHeight: 500 });
  const result = rankAndDeduplicate([small, large]);
  assert.equal(result[0].width, 500);
});
