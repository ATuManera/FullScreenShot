// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday
//
// Regression coverage (fix/ux-capture-runtime-regression): the pure
// expiry policy backing the IndexedDB result store that replaced
// chrome.storage.session (which was cleared on every "reload
// extension" during physical testing, not just on browser close, even
// though it does survive a bare service-worker restart). `isExpired`
// is the one piece of that store's logic that doesn't need IndexedDB
// itself (no fake-indexeddb dependency in this zero-dependency test
// setup) and is exercised directly here with real timestamps, not a
// mocked "it returns true" stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isExpired, RESULT_TTL_MS } from "../../dist/chromium/shared/resultStore.js";

test("a result created just now is not expired", () => {
  const now = 1_000_000;
  assert.equal(isExpired(now, now), false);
});

test("a result well within the TTL is not expired", () => {
  const now = 1_000_000;
  const createdAt = now - RESULT_TTL_MS / 2;
  assert.equal(isExpired(createdAt, now), false);
});

test("a result exactly at the TTL boundary is not yet expired", () => {
  const now = 1_000_000;
  const createdAt = now - RESULT_TTL_MS;
  assert.equal(isExpired(createdAt, now), false);
});

test("a result one millisecond past the TTL is expired", () => {
  const now = 1_000_000;
  const createdAt = now - RESULT_TTL_MS - 1;
  assert.equal(isExpired(createdAt, now), true);
});

test("a result from long before the TTL is expired", () => {
  const now = 1_000_000;
  const createdAt = now - RESULT_TTL_MS * 10;
  assert.equal(isExpired(createdAt, now), true);
});
