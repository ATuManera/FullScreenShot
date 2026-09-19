// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";

import { isRenderedForExport, preservesWhitespace } from "../../dist/chromium/capture/visibility.js";

// Both DOM-reading exports — the PDF's text layer and Markdown — answer the
// same question: can the user actually see this? A Markdown file carrying
// screen-reader-only prose and a PDF whose search finds words the page never
// showed are the same defect. This is the unit-tested statement of the rule;
// each injectable carries an identical copy, because an injected function is
// re-evaluated in the page with no module scope.

const visible = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  contentVisibility: "visible",
  overflow: "visible",
  clip: "auto",
  clipPath: "none",
};
const ordinaryBox = { clientWidth: 600, clientHeight: 24 };

const check = (overrides = {}, box = ordinaryBox, hidden = false) =>
  isRenderedForExport({ ...visible, ...overrides }, box, hidden);

test("ordinary rendered content is kept", () => {
  assert.equal(check(), true);
});

test("display:none is excluded", () => {
  assert.equal(check({ display: "none" }), false);
});

test("visibility:hidden is excluded", () => {
  assert.equal(check({ visibility: "hidden" }), false);
});

test("visibility:collapse is excluded", () => {
  assert.equal(check({ visibility: "collapse" }), false);
});

test("opacity:0 is excluded", () => {
  assert.equal(check({ opacity: "0" }), false);
});

test("a nearly-transparent element is still rendered", () => {
  // Only fully transparent content is invisible; 0.01 is a design choice the
  // user can still faintly see, and the screenshot shows it.
  assert.equal(check({ opacity: "0.01" }), true);
});

test("content-visibility:hidden is excluded", () => {
  assert.equal(check({ contentVisibility: "hidden" }), false);
});

test("the hidden attribute is excluded", () => {
  assert.equal(check({}, ordinaryBox, true), false);
});

test("the screen-reader-only pattern is excluded", () => {
  // The classic .sr-only: a one-pixel box with its overflow clipped away.
  const srOnly = { overflow: "hidden", clip: "rect(0px, 0px, 0px, 0px)" };
  assert.equal(check(srOnly, { clientWidth: 1, clientHeight: 1 }), false);
});

test("a clip-path variant of screen-reader-only text is excluded", () => {
  assert.equal(
    check({ clipPath: "inset(50%)" }, { clientWidth: 1, clientHeight: 1 }),
    false,
  );
});

test("a small but real label is kept", () => {
  // Clipped, but not one pixel square — an ordinary badge or chip, which the
  // user can plainly read. The rule is conservative on purpose.
  assert.equal(check({ overflow: "hidden" }, { clientWidth: 48, clientHeight: 18 }), true);
});

test("a one-pixel box that is not clipped is kept", () => {
  // A spacer or a measurement probe with no overflow rule is not the
  // screen-reader pattern, so the rule leaves it alone.
  assert.equal(check({}, { clientWidth: 1, clientHeight: 1 }), true);
});

test("aria-hidden is not part of the rule", () => {
  // Deliberate: aria-hidden content is still painted, so it is still
  // something the user reads and still in the screenshot.
  assert.equal(Object.keys(visible).some((k) => k.toLowerCase().includes("aria")), false);
});

test("normal white-space means the text is prose", () => {
  for (const value of ["normal", "nowrap"]) {
    assert.equal(preservesWhitespace(value), false, value);
  }
});

test("preformatted white-space means the indentation is content", () => {
  for (const value of ["pre", "pre-wrap", "pre-line", "break-spaces"]) {
    assert.equal(preservesWhitespace(value), true, value);
  }
});
