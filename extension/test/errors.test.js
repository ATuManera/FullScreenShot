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
