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

// Regression coverage (fix/ux-capture-runtime-regression): a stale
// `chrome.runtime.connect` port threw this exact string uncaught in
// popup.ts before the sendMessage-based transport replaced it. The
// mapper must still neutralize it even though the transport itself no
// longer produces it directly — sendMessage failures are routed
// through the same "disconnected port object" sentinel so this class
// of error always gets the same friendly, recoverable copy.
test("maps the disconnected-port regression string to a friendly, recoverable message, never verbatim", () => {
  const friendly = mapBrowserError("Attempting to use a disconnected port object");
  assert.equal(friendly.title, "Capture connection interrupted");
  assert.doesNotMatch(friendly.title, /disconnected port/i);
  assert.doesNotMatch(friendly.body, /disconnected port/i);
});

test("maps a sendMessage-with-no-receiver failure to the same connection-lost message", () => {
  const friendly = mapBrowserError("Could not establish connection. Receiving end does not exist.");
  assert.equal(friendly.title, "Capture connection interrupted");
});

test("maps an extension-context-invalidated failure (extension reloaded mid-use) to the connection-lost message", () => {
  const friendly = mapBrowserError("Extension context invalidated.");
  assert.equal(friendly.title, "Capture connection interrupted");
});

test("never leaks raw technical vocabulary into the body for any mapped case", () => {
  const rawMessages = [
    "Error: The extensions gallery cannot be scripted.",
    "executeScript failed: permission denied",
    "Uncaught ReferenceError: x is not defined\n  at <anonymous>:1:1",
    "Uncaught Error: Attempting to use a disconnected port object",
  ];
  for (const raw of rawMessages) {
    const friendly = mapBrowserError(raw);
    assert.doesNotMatch(friendly.title, /stack|executeScript|ReferenceError|disconnected port/i);
    assert.doesNotMatch(friendly.body, /stack|executeScript|ReferenceError|disconnected port/i);
  }
});

test("maps a page that refused to scroll to copy that names Visible area as the way out", () => {
  const friendly = mapBrowserError("The page did not scroll as expected. Try again or use Visible area.");
  assert.equal(friendly.title, "The page didn't scroll");
  assert.match(friendly.body, /Visible area/);
});

test("maps a scroll area that can't be brought on screen to recovery copy, not the generic failure", () => {
  const friendly = mapBrowserError("The selected scroll area could not be brought into view. Scroll it into the window and try again.");
  assert.equal(friendly.title, "Scroll area can't be captured");
  assert.notEqual(friendly.title, "Capture failed");
});

test("maps a scroll area that shifted mid-capture to the same recovery copy", () => {
  const friendly = mapBrowserError("The selected scroll area moved while it was being captured. Try again.");
  assert.equal(friendly.title, "Scroll area can't be captured");
});

test("maps the raw compositor dimension error it used to surface to safe copy", () => {
  // Before the scroll-area repair a container taller than the viewport
  // produced mismatched tile heights, and "invalid dimensions: 640x64"
  // reached the user verbatim.
  const friendly = mapBrowserError("invalid dimensions: 640x64");
  assert.doesNotMatch(friendly.title, /dimensions|\d+x\d+/i);
  assert.doesNotMatch(friendly.body, /dimensions|\d+x\d+/i);
});
