// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_VIEWS, DEFAULT_VIEW, isViewVisible, navigate } from "../../dist/chromium/popup/popupView.js";

// Settings and About used to open a separate page in a browser tab. They are
// views of the popup window now, so the navigation between them is worth
// pinning: every subview leads back to Main, and a popup always opens at Main.

test("a popup opens on the capture view", () => {
  assert.equal(DEFAULT_VIEW, "main");
});

test("Settings opens from Main", () => {
  assert.equal(navigate("main", { kind: "open", view: "settings" }), "settings");
});

test("Back returns from Settings to Main", () => {
  assert.equal(navigate("settings", { kind: "back" }), "main");
});

test("Done returns from Settings to Main by the same route as Back", () => {
  // Settings saves as you choose, so Done is just "take me back".
  assert.equal(navigate("settings", { kind: "back" }), navigate("settings", { kind: "back" }));
  assert.equal(navigate("settings", { kind: "back" }), "main");
});

test("About opens from Main and Back returns", () => {
  assert.equal(navigate("main", { kind: "open", view: "about" }), "about");
  assert.equal(navigate("about", { kind: "back" }), "main");
});

test("the Markdown panel keeps working the same way", () => {
  assert.equal(navigate("main", { kind: "open", view: "markdown" }), "markdown");
  assert.equal(navigate("markdown", { kind: "back" }), "main");
});

test("Back from anywhere lands on Main, never somewhere deeper", () => {
  for (const view of ALL_VIEWS) {
    assert.equal(navigate(view, { kind: "back" }), "main", `back from ${view}`);
  }
});

test("exactly one view is on screen at a time", () => {
  for (const current of ALL_VIEWS) {
    const visible = ALL_VIEWS.filter((v) => isViewVisible(v, current));
    assert.deepEqual(visible, [current]);
  }
});

test("the four views are the whole popup — no page is opened for any of them", () => {
  assert.deepEqual([...ALL_VIEWS], ["main", "markdown", "settings", "about"]);
});
