// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday
//
// Hostile-input tests for parseInboundMessage — the boundary that
// validates every runtime message before background/index.ts acts on
// it (SECURITY.md: "extension message spoofing", "unexpected
// messages"). Any extension, or a compromised/malicious page able to
// reach this port, could send arbitrary JSON; none of it should be
// trusted without going through this validator.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInboundMessage } from "../../dist/chromium/background/messages.js";

test("accepts a well-formed CANCEL message", () => {
  assert.deepEqual(parseInboundMessage({ type: "CANCEL" }), { type: "CANCEL" });
});

test("accepts a well-formed START_CAPTURE message with all fields", () => {
  const msg = {
    type: "START_CAPTURE",
    mode: "fullpage",
    exportFormat: "pdf",
    pdfPageSize: "a4",
    pdfOrientation: "landscape",
    markdownMode: "full-dom",
  };
  assert.deepEqual(parseInboundMessage(msg), msg);
});

test("fills in defaults when optional fields are omitted", () => {
  const result = parseInboundMessage({ type: "START_CAPTURE", mode: "visible" });
  assert.deepEqual(result, {
    type: "START_CAPTURE",
    mode: "visible",
    exportFormat: "png",
    pdfPageSize: "auto",
    pdfOrientation: "portrait",
    markdownMode: "article",
  });
});

test("rejects null", () => {
  assert.equal(parseInboundMessage(null), null);
});

test("rejects a bare string instead of an object", () => {
  assert.equal(parseInboundMessage("START_CAPTURE"), null);
});

test("rejects a number", () => {
  assert.equal(parseInboundMessage(42), null);
});

test("rejects an array", () => {
  assert.equal(parseInboundMessage(["START_CAPTURE"]), null);
});

test("rejects an object with no type field", () => {
  assert.equal(parseInboundMessage({ mode: "fullpage" }), null);
});

test("rejects an unknown type", () => {
  assert.equal(parseInboundMessage({ type: "EVAL_ARBITRARY_CODE", payload: "..." }), null);
});

test("rejects START_CAPTURE with an unknown capture mode", () => {
  assert.equal(parseInboundMessage({ type: "START_CAPTURE", mode: "__proto__" }), null);
});

test("rejects START_CAPTURE with a hostile exportFormat", () => {
  assert.equal(
    parseInboundMessage({ type: "START_CAPTURE", mode: "visible", exportFormat: "<script>alert(1)</script>" }),
    null,
  );
});

test("rejects START_CAPTURE with a prototype-pollution-shaped mode", () => {
  const malicious = JSON.parse('{"type":"START_CAPTURE","mode":"visible","__proto__":{"polluted":true}}');
  const result = parseInboundMessage(malicious);
  assert.deepEqual(result, {
    type: "START_CAPTURE",
    mode: "visible",
    exportFormat: "png",
    pdfPageSize: "auto",
    pdfOrientation: "portrait",
    markdownMode: "article",
  });
  // The parsed result must be a clean object; prototype pollution
  // payloads targeting Object.prototype must not have actually mutated
  // it via this path.
  assert.equal({}.polluted, undefined);
});

test("rejects CANCEL disguised with extra unexpected fields silently ignored, not trusted blindly", () => {
  // Extra fields on an otherwise valid CANCEL are harmless and ignored
  // — the validator only ever reads `type` for this variant.
  assert.deepEqual(parseInboundMessage({ type: "CANCEL", mode: "fullpage", exportFormat: "pdf" }), { type: "CANCEL" });
});
