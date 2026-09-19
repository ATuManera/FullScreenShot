// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";

import { groupWordsIntoLines, isSupportedLinkUri } from "../../dist/chromium/capture/textLayer.js";

// The DOM walk itself is verified in a real Chromium against
// tests/pages/pdf-text-acceptance.html, and its output captured verbatim as
// a Rust fixture (crates/screenshot-pdf/tests/browser_extracted_layer.rs) —
// the same approach the Markdown extractor was proved with, and for the same
// reason: a jsdom stand-in would be testing the stand-in's idea of layout.
// What is testable here without a browser is the part that does not touch
// the DOM at all.

const word = (text, left, top, width = 40, height = 18) => ({
  text,
  left,
  top,
  right: left + width,
  bottom: top + height,
});

test("words on one line become one run", () => {
  const lines = groupWordsIntoLines([word("Información", 10, 100), word("de", 60, 100), word("auditoría", 90, 100)]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "Información de auditoría");
});

test("a run spans from the first word's left edge to the last word's right edge", () => {
  const lines = groupWordsIntoLines([word("uno", 10, 100, 30), word("dos", 50, 100, 30)]);
  assert.equal(lines[0].left, 10);
  assert.equal(lines[0].right, 80);
});

test("wrapped text becomes one run per visual line", () => {
  const lines = groupWordsIntoLines([
    word("primera", 10, 100),
    word("línea", 60, 100),
    word("segunda", 10, 124),
    word("línea", 60, 124),
    word("tercera", 10, 148),
  ]);
  assert.deepEqual(
    lines.map((l) => l.text),
    ["primera línea", "segunda línea", "tercera"],
  );
});

test("a fraction of a pixel does not start a new line", () => {
  // A superscript or a taller inline sibling nudges a word's box; that is not
  // a line break, and treating it as one would shred a paragraph into runs.
  const lines = groupWordsIntoLines([word("texto", 10, 100), word("nota", 60, 101.4)]);
  assert.equal(lines.length, 1);
});

test("a real line break is not absorbed by the tolerance", () => {
  const lines = groupWordsIntoLines([word("texto", 10, 100), word("siguiente", 10, 118)]);
  assert.equal(lines.length, 2);
});

test("a run's box covers every word in it, including a taller one", () => {
  const lines = groupWordsIntoLines([word("normal", 10, 100, 40, 18), word("ALTO", 60, 99, 40, 22)]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].top, 99);
  assert.equal(lines[0].bottom, 121);
});

test("no words means no runs", () => {
  assert.deepEqual(groupWordsIntoLines([]), []);
});

test("only http and https links become clickable", () => {
  for (const uri of ["https://example.com/a", "http://example.com", "HTTPS://EXAMPLE.COM"]) {
    assert.equal(isSupportedLinkUri(uri), true, uri);
  }
});

test("schemes a PDF reader must not be handed are refused", () => {
  for (const uri of [
    "javascript:void(0)",
    "JavaScript:alert(1)",
    "data:text/html,x",
    "blob:https://example.com/x",
    "file:///etc/passwd",
    "chrome-extension://abc/page.html",
    "mailto:nadie@example.com",
    "ftp://example.com",
    "",
    "   ",
  ]) {
    assert.equal(isSupportedLinkUri(uri), false, uri);
  }
});

test("an absurdly long URL is refused rather than embedded", () => {
  assert.equal(isSupportedLinkUri("https://example.com/" + "a".repeat(4000)), false);
});
