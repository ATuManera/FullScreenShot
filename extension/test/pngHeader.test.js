// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";

import { readPngDimensions } from "../../dist/chromium/capture/pngHeader.js";

function pngWith(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

test("reads the dimensions a long capture actually declares", () => {
  assert.deepEqual(readPngDimensions(pngWith(1660, 8484)), { width: 1660, height: 8484 });
});

test("reads heights well beyond a 16-bit range without wrapping", () => {
  assert.deepEqual(readPngDimensions(pngWith(1660, 70000)), { width: 1660, height: 70000 });
});

test("rejects bytes that are not a PNG rather than inventing a size", () => {
  assert.equal(readPngDimensions(new Uint8Array([0x25, 0x50, 0x44, 0x46])), null);
  assert.equal(readPngDimensions(new Uint8Array(0)), null);
  assert.equal(readPngDimensions(pngWith(0, 0)), null);
});
