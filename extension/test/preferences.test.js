// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePreferences, DEFAULT_PREFERENCES } from "../../dist/chromium/popup/preferences.js";

test("undefined stored value yields all defaults", () => {
  assert.deepEqual(mergePreferences(undefined), DEFAULT_PREFERENCES);
});

test("null stored value yields all defaults", () => {
  assert.deepEqual(mergePreferences(null), DEFAULT_PREFERENCES);
});

test("a non-object stored value (corrupt storage) yields all defaults, not a throw", () => {
  assert.deepEqual(mergePreferences("not an object"), DEFAULT_PREFERENCES);
  assert.deepEqual(mergePreferences(42), DEFAULT_PREFERENCES);
});

test("partial stored value keeps valid fields and fills in the rest with defaults", () => {
  const result = mergePreferences({ exportFormat: "pdf" });
  assert.equal(result.exportFormat, "pdf");
  assert.equal(result.pdfPageSize, DEFAULT_PREFERENCES.pdfPageSize);
  assert.equal(result.markdownMode, DEFAULT_PREFERENCES.markdownMode);
});

test("invalid enum values fall back to their default individually", () => {
  const result = mergePreferences({ exportFormat: "webp", pdfOrientation: "sideways", markdownMode: "html" });
  assert.equal(result.exportFormat, DEFAULT_PREFERENCES.exportFormat);
  assert.equal(result.pdfOrientation, DEFAULT_PREFERENCES.pdfOrientation);
  assert.equal(result.markdownMode, DEFAULT_PREFERENCES.markdownMode);
});

test("a fully valid stored value round-trips unchanged", () => {
  const valid = { exportFormat: "pdf", pdfPageSize: "a4", pdfOrientation: "landscape", markdownMode: "full-dom", lazyMode: "reliable" };
  assert.deepEqual(mergePreferences(valid), valid);
});

test("active capture mode is never part of the persisted preferences shape", () => {
  assert.equal("captureMode" in DEFAULT_PREFERENCES, false);
  assert.equal("activeMode" in DEFAULT_PREFERENCES, false);
});
