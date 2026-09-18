// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyFixedAnchor } from "../../dist/chromium/capture/sticky.js";

// Full-page stitching keeps each tile's band only up to the next tile's
// origin, so a viewport-anchored element survives into the output only if it
// sits inside a band that is retained. Which band that is depends on whether
// the element hangs off the top edge or the bottom one — hence this
// classification.

const VH = 800;
const VW = 1200;

test("a bar flush against the top edge is top-anchored", () => {
  assert.equal(classifyFixedAnchor({ top: 0, bottom: 56, width: 1200 }, VH, VW), "top");
});

test("a bar inset from the top edge is still top-anchored", () => {
  // `top: 8px` is as much a header as `top: 0` — classification cannot key
  // off the computed value being exactly "0px".
  assert.equal(classifyFixedAnchor({ top: 8, bottom: 64, width: 1200 }, VH, VW), "top");
});

test("a bar flush against the bottom edge is bottom-anchored", () => {
  assert.equal(classifyFixedAnchor({ top: 760, bottom: 800, width: 1200 }, VH, VW), "bottom");
});

test("a bar inset from the bottom edge is still bottom-anchored", () => {
  assert.equal(classifyFixedAnchor({ top: 744, bottom: 784, width: 1200 }, VH, VW), "bottom");
});

test("a centered overlay belongs to neither edge", () => {
  assert.equal(classifyFixedAnchor({ top: 300, bottom: 500, width: 1200 }, VH, VW), "other");
});

test("a narrow corner widget is not treated as a bar", () => {
  // A chat bubble in the bottom-right corner touches the bottom edge but is
  // not a footer; promoting it would paste it into the bottom of the image.
  assert.equal(classifyFixedAnchor({ top: 720, bottom: 790, width: 72 }, VH, VW), "other");
});

test("an element covering the whole viewport is not claimed by either edge", () => {
  // A full-screen overlay touches both edges; neither is "its" anchor.
  assert.equal(classifyFixedAnchor({ top: 0, bottom: 800, width: 1200 }, VH, VW), "other");
});

test("an element nearer the top than the bottom resolves to top", () => {
  assert.equal(classifyFixedAnchor({ top: 4, bottom: 700, width: 1200 }, VH, VW), "top");
});

test("classification scales with the viewport rather than using fixed pixels", () => {
  const short = 400;
  // 30px from the top of a 400px viewport is proportionally the same
  // anchoring as 60px from the top of an 800px one.
  assert.equal(classifyFixedAnchor({ top: 30, bottom: 80, width: 1200 }, short, VW), "top");
  assert.equal(classifyFixedAnchor({ top: 200, bottom: 260, width: 1200 }, short, VW), "other");
});

test("a zero-height or off-screen element is never promoted to an edge", () => {
  assert.equal(classifyFixedAnchor({ top: 0, bottom: 0, width: 1200 }, VH, VW), "other");
  assert.equal(classifyFixedAnchor({ top: -200, bottom: -100, width: 1200 }, VH, VW), "other");
  assert.equal(classifyFixedAnchor({ top: 900, bottom: 1000, width: 1200 }, VH, VW), "other");
});
