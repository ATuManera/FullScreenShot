// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapBrowserError } from "../../dist/chromium/popup/errors.js";

test("maps the real observed Chrome Web Store error to a friendly protected-page message", () => {
  const friendly = mapBrowserError("Error: The extensions gallery cannot be scripted.");
  assert.equal(friendly.title, "Capture unavailable on this page");
  assert.doesNotMatch(friendly.body, /scripted|gallery/i);
});

test("maps generic scripting-permission errors to the protected-page message", () => {
  const friendly = mapBrowserError("Cannot access a chrome:// URL");
  assert.equal(friendly.title, "Capture unavailable on this page");
});

test("maps missing scroll container errors to a specific friendly message", () => {
  const friendly = mapBrowserError("Selected scroll container is no longer on the page.");
  assert.equal(friendly.title, "No scrollable region found");
});

test("maps infinite-scroll errors to the dynamic-page-instability message", () => {
  const friendly = mapBrowserError("This page appears to load content indefinitely (infinite scroll)");
  assert.equal(friendly.title, "The page changed during capture");
});

test("unrecognized errors fall back to a generic, still-human message", () => {
  const friendly = mapBrowserError("TypeError: Cannot read properties of undefined (reading 'foo')");
  assert.equal(friendly.title, "Capture failed");
  assert.doesNotMatch(friendly.body, /TypeError|undefined/);
});

test("never leaks raw technical vocabulary into the body for any mapped case", () => {
  const rawMessages = [
    "Error: The extensions gallery cannot be scripted.",
    "executeScript failed: permission denied",
    "Uncaught ReferenceError: x is not defined\n  at <anonymous>:1:1",
  ];
  for (const raw of rawMessages) {
    const friendly = mapBrowserError(raw);
    assert.doesNotMatch(friendly.title, /stack|executeScript|ReferenceError/i);
    assert.doesNotMatch(friendly.body, /stack|executeScript|ReferenceError/i);
  }
});
