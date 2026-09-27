// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";

// `chrome.scripting.executeScript({ func })` does not inject a module. It
// serializes the function with `Function.prototype.toString()` and
// re-evaluates the resulting source inside the page, where nothing else from
// this codebase exists. A function that calls a sibling in its own module
// therefore works in every test that imports the module and throws
// `ReferenceError` in the only place that matters.
//
// That is not hypothetical. `extractTextLayer` called `isSupportedLinkUri`,
// which made the first `<a>` on any page throw, which made the extension
// produce a PDF with no text layer and no links at all — while every test,
// importing the module, passed. This file is the check that was missing:
// it asserts, for every function the extension actually injects, that its
// source references nothing from its own module.

const INJECTED = {
  "capture/geometry.js": ["measurePage"],
  "capture/injectable.js": ["applyFixedElementVisibility", "restoreFixedAndStickyElements"],
  "capture/markdown.js": ["extractMarkdownAst"],
  "capture/scrollDetectionInjectable.js": ["detectScrollCandidates", "keepScrollCandidates", "locatePageScroller"],
  "capture/scrollSync.js": ["scrollWindowToVerified", "settleFrame"],
  "capture/selection.js": [
    "prepareContainerForCapture",
    "positionContainerBand",
    "releaseContainer",
    "runSelectionPicker",
    "abortSelectionPicker",
  ],
  "capture/state.js": ["begin", "restore", "suppressSmoothScroll"],
  "capture/textLayer.js": ["extractTextLayer"],
};

/** Strips comments and string/template literals, so a name mentioned in prose does not count. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

for (const [file, functions] of Object.entries(INJECTED)) {
  test(`every injected function in ${file} is self-contained`, async () => {
    const module = await import(`../../dist/chromium/${file}`);
    const siblings = Object.keys(module);

    for (const name of functions) {
      assert.equal(
        typeof module[name],
        "function",
        `${file} should export an injectable named ${name}`,
      );
      const source = code(module[name].toString());
      const referenced = siblings.filter(
        (sibling) => sibling !== name && new RegExp(`\\b${sibling}\\b`).test(source),
      );
      assert.deepEqual(
        referenced,
        [],
        `${name} references ${referenced.join(", ")} from its own module. ` +
          `Injected functions are re-evaluated in the page with no module scope, ` +
          `so this throws ReferenceError there. Inline what it needs instead.`,
      );
    }
  });
}

test("the check would have caught the defect it exists for", () => {
  // A stand-in for the shape of the bug, so this file's own logic is tested
  // rather than merely trusted.
  const helper = () => true;
  const injectable = function broken(uri) {
    return helper(uri);
  };
  const siblings = ["helper", "broken"];
  const source = code(injectable.toString());
  const referenced = siblings.filter(
    (sibling) => sibling !== "broken" && new RegExp(`\\b${sibling}\\b`).test(source),
  );
  assert.deepEqual(referenced, ["helper"]);
});

test("a name that appears only in a comment or a string is not a reference", () => {
  const injectable = function ok() {
    // helper is deliberately not called here
    return "helper";
  };
  const source = code(injectable.toString());
  assert.equal(/\bhelper\b/.test(source), false);
});
