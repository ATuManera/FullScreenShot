// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SELECTION_MESSAGE_TYPE,
  parseSelectionMessage,
} from "../../dist/chromium/capture/selectionProtocol.js";

// The shipped bug this covers: the picker resolved a Promise held open inside
// a single `executeScript` call in the background service worker, so there was
// no serializable, addressable outcome — nothing could settle the flow if the
// click never arrived. Selection now crosses the boundary as a plain message
// tagged with the request it answers.

const REQ = "req-1";

test("a selected message carries the container selector through serialization", () => {
  const outcome = parseSelectionMessage(
    { type: SELECTION_MESSAGE_TYPE, requestId: REQ, status: "selected", attr: "data-fullscreenshot-container-id", value: "3" },
    REQ,
  );
  assert.deepEqual(outcome, { status: "selected", selector: { attr: "data-fullscreenshot-container-id", value: "3" } });
});

test("a cancelled message is a terminal outcome, not silence", () => {
  assert.deepEqual(parseSelectionMessage({ type: SELECTION_MESSAGE_TYPE, requestId: REQ, status: "cancelled" }, REQ), { status: "cancelled" });
});

test("an error message is a terminal outcome carrying its reason", () => {
  assert.deepEqual(
    parseSelectionMessage({ type: SELECTION_MESSAGE_TYPE, requestId: REQ, status: "error", message: "page went away" }, REQ),
    { status: "error", message: "page went away" },
  );
});

test("a message for a different request is ignored", () => {
  assert.equal(parseSelectionMessage({ type: SELECTION_MESSAGE_TYPE, requestId: "other", status: "cancelled" }, REQ), null);
});

test("unrelated runtime messages are ignored", () => {
  assert.equal(parseSelectionMessage({ type: "PROGRESS", text: "Capturing…" }, REQ), null);
  assert.equal(parseSelectionMessage(null, REQ), null);
  assert.equal(parseSelectionMessage("selected", REQ), null);
});

test("a selected message missing its selector is rejected rather than half-applied", () => {
  assert.equal(parseSelectionMessage({ type: SELECTION_MESSAGE_TYPE, requestId: REQ, status: "selected", attr: "data-x" }, REQ), null);
  assert.equal(parseSelectionMessage({ type: SELECTION_MESSAGE_TYPE, requestId: REQ, status: "selected" }, REQ), null);
});

test("an unknown status is rejected", () => {
  assert.equal(parseSelectionMessage({ type: SELECTION_MESSAGE_TYPE, requestId: REQ, status: "maybe" }, REQ), null);
});

test("a page with nothing to pick is its own outcome, not a cancellation", () => {
  // Backing out and finding nothing to back out of read the same to the user
  // otherwise: one is a decision, the other is the page having changed.
  assert.deepEqual(
    parseSelectionMessage({ type: SELECTION_MESSAGE_TYPE, requestId: REQ, status: "no-candidates" }, REQ),
    { status: "no-candidates" },
  );
});

test("the three terminal outcomes stay distinguishable across the boundary", () => {
  const statuses = ["cancelled", "no-candidates", "error"];
  const parsed = statuses.map((status) => parseSelectionMessage({ type: SELECTION_MESSAGE_TYPE, requestId: REQ, status, message: "x" }, REQ));
  assert.deepEqual(parsed.map((p) => p.status), statuses);
});
