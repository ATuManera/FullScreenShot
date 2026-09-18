// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFilename, formatLocalTimestamp } from "../../dist/chromium/popup/filename.js";

test("formats local timestamp as YYYY-MM-DD_HHmm", () => {
  const d = new Date(2026, 8, 17, 23, 55); // months are 0-indexed: September
  assert.equal(formatLocalTimestamp(d), "2026-09-17_2355");
});

test("pads single-digit month/day/hour/minute", () => {
  const d = new Date(2026, 0, 5, 3, 7);
  assert.equal(formatLocalTimestamp(d), "2026-01-05_0307");
});

test("builds the documented example filename shape", () => {
  const name = buildFilename({
    hostname: "wikipedia.org",
    title: "Artificial intelligence",
    date: new Date(2026, 8, 17, 23, 55),
    ext: "png",
  });
  assert.equal(name, "wikipedia-org_Artificial-intelligence_2026-09-17_2355.png");
});

test("sanitizes unsafe filesystem characters from the title", () => {
  const name = buildFilename({ hostname: "example.com", title: 'Weird: Title / With * Chars?', date: new Date(2026, 0, 1, 0, 0), ext: "pdf" });
  assert.doesNotMatch(name, /[/\\:*?"<>|]/);
});

test("collapses whitespace and repeated separators", () => {
  const name = buildFilename({ hostname: "example.com", title: "Too   many    spaces", date: new Date(2026, 0, 1, 0, 0), ext: "png" });
  assert.doesNotMatch(name, /--/);
});

test("falls back to safe defaults when hostname/title are empty", () => {
  const name = buildFilename({ hostname: "", title: "", date: new Date(2026, 0, 1, 0, 0), ext: "png" });
  assert.equal(name, "page_capture_2026-01-01_0000.png");
});

test("caps excessive title length", () => {
  const longTitle = "a".repeat(300);
  const name = buildFilename({ hostname: "example.com", title: longTitle, date: new Date(2026, 0, 1, 0, 0), ext: "png" });
  assert.ok(name.length < 200, `expected a bounded filename length, got ${name.length}`);
});

test("strips a leading dot from the extension", () => {
  const name = buildFilename({ hostname: "example.com", title: "x", date: new Date(2026, 0, 1, 0, 0), ext: ".png" });
  assert.ok(name.endsWith(".png"));
  assert.ok(!name.endsWith("..png"));
});

test("removes accented characters instead of dropping the whole word", () => {
  const name = buildFilename({ hostname: "example.com", title: "Café México", date: new Date(2026, 0, 1, 0, 0), ext: "png" });
  assert.match(name, /Cafe-Mexico/);
});
