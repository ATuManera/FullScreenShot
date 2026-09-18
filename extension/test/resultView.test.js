// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday
//
// Final Chrome UX polish: pure copy/formatting logic behind the
// redesigned Result Page. These tests exist specifically to catch a
// regression where someone makes the copy claim something
// FullScreenShot cannot actually verify (a filesystem path, a
// finished download) — see DOWNLOAD_LOCATION_NOTE's doc comment.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSE_FALLBACK_TEXT,
  CLOSE_LABEL,
  DOWNLOADED_STATUS,
  DOWNLOAD_AGAIN_LABEL,
  DOWNLOAD_LOCATION_NOTE,
  EXPIRED_BODY,
  EXPIRED_STATUS,
  MISSING_BODY,
  MISSING_STATUS,
  READY_STATUS,
  TTL_NOTE,
  downloadButtonLabel,
  formatFormatSummary,
} from "../../dist/chromium/result/resultView.js";

test("ready-state download label names the format", () => {
  assert.equal(downloadButtonLabel("image/png"), "Download PNG");
  assert.equal(downloadButtonLabel("application/pdf"), "Download PDF");
  assert.equal(downloadButtonLabel("text/markdown"), "Download Markdown");
});

test("PNG format summary includes dimensions when known", () => {
  assert.equal(formatFormatSummary("image/png", { width: 1664, height: 944 }), "PNG · 1664 × 944");
});

test("PNG format summary falls back to just the format name when dimensions are unknown", () => {
  assert.equal(formatFormatSummary("image/png", {}), "PNG");
});

test("PDF format summary names the page size and orientation when known", () => {
  assert.equal(formatFormatSummary("application/pdf", { pdfPageSize: "a4", pdfOrientation: "portrait" }), "PDF · A4 · Portrait");
  assert.equal(formatFormatSummary("application/pdf", { pdfPageSize: "letter", pdfOrientation: "landscape" }), "PDF · Letter · Landscape");
});

test("PDF format summary omits a fake page-size name for auto sizing, but keeps the real orientation", () => {
  assert.equal(formatFormatSummary("application/pdf", { pdfPageSize: "auto", pdfOrientation: "portrait" }), "PDF · Portrait");
});

test("PDF format summary falls back to just 'PDF' with no metadata at all", () => {
  assert.equal(formatFormatSummary("application/pdf", {}), "PDF");
});

test("Markdown format summary is just 'Markdown' — it never has pixel dimensions", () => {
  assert.equal(formatFormatSummary("text/markdown", { width: 0, height: 0 }), "Markdown");
});

test("an unrecognized mime type still produces a label rather than throwing", () => {
  assert.equal(formatFormatSummary("application/zip", {}), "File");
});

// --- Truthful-copy regression coverage ------------------------------------

test("the download-location note never claims a specific filesystem path", () => {
  assert.doesNotMatch(DOWNLOAD_LOCATION_NOTE, /\/Users|\/home|C:\\|Downloads\//);
  assert.match(DOWNLOAD_LOCATION_NOTE, /configured download location/i);
});

test("the post-click status never claims the download finished, only that it started", () => {
  assert.equal(DOWNLOADED_STATUS, "Download started");
  assert.doesNotMatch(DOWNLOADED_STATUS, /complete|success|saved|finished/i);
});

test("the ready-state status is a completed capture, not a completed download", () => {
  assert.equal(READY_STATUS, "Capture complete");
});

test("the TTL note mentions 15 minutes and reads as a ceiling, not a countdown", () => {
  assert.match(TTL_NOTE, /15 minutes/);
});

test("the expired state never suggests a Download action is still available", () => {
  assert.equal(EXPIRED_STATUS, "Result expired");
  assert.doesNotMatch(EXPIRED_BODY, /download/i);
  assert.match(EXPIRED_BODY, /no longer available/i);
});

test("the missing-id state is distinct wording from the expired-TTL state", () => {
  assert.notEqual(MISSING_STATUS, EXPIRED_STATUS);
  assert.doesNotMatch(MISSING_BODY, /download/i);
});

test("close/download-again labels are plain and do not overclaim behavior", () => {
  assert.equal(DOWNLOAD_AGAIN_LABEL, "Download again");
  assert.equal(CLOSE_LABEL, "Close");
  assert.match(CLOSE_FALLBACK_TEXT, /close this tab/i);
});
