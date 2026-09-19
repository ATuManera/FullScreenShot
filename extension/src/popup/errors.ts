// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Centralized browser-error -> user-message mapper (UX-P1 6.9 / UX-P3
 * 8.6). Raw Chrome/WebExtension exceptions ("The extensions gallery
 * cannot be scripted.", executeScript permission errors, stack traces)
 * must never reach ordinary users — this is the single place that
 * decides what a human sees, and it always has a safe fallback.
 * Pure/testable: takes a message string, returns display copy.
 */
export interface FriendlyError {
  title: string;
  body: string;
}

const PROTECTED_PAGE: FriendlyError = {
  title: "Capture unavailable on this page",
  body: "Chrome doesn't allow extensions to capture protected browser pages. Open a regular website to use FullScreenShot.",
};

const NO_SCROLL_CONTAINER: FriendlyError = {
  title: "No scrollable region found",
  body: "Use Full page or Visible area instead.",
};

const CAPTURE_INTERRUPTED: FriendlyError = {
  title: "Capture interrupted",
  body: "The page couldn't be captured completely. Please try again.",
};

const PAGE_CHANGED: FriendlyError = {
  title: "The page changed during capture",
  body: "Try again using Reliable mode for dynamic or lazy-loaded pages.",
};

/**
 * The scroller ignored a scroll request it could have honoured, so the capture
 * refused to stitch the same viewport repeatedly. Names Visible area as the
 * way out, since that mode needs no scrolling at all.
 */
const DID_NOT_SCROLL: FriendlyError = {
  title: "The page didn't scroll",
  body: "FullScreenShot couldn't move this page to capture the rest of it. Try again, or use Visible area.",
};

const SCROLL_AREA_UNAVAILABLE: FriendlyError = {
  title: "Scroll area can't be captured",
  body: "Scroll the region into view so it's fully on screen, then try again.",
};

/**
 * The composite is beyond the size the Rust core will compose. Deliberately
 * does not suggest Reliable mode: Reliable loads *more* content, so it makes
 * a capture larger, never smaller. The two alternatives named are the ones
 * that genuinely produce a smaller image.
 */
const TOO_LARGE: FriendlyError = {
  title: "Capture is too large",
  body: "This page exceeds FullScreenShot's safe image size. Try capturing a scroll area or the visible area.",
};

const GENERIC: FriendlyError = {
  title: "Capture failed",
  body: "Something went wrong while capturing this page. Please try again.",
};

/**
 * A `chrome.runtime.sendMessage` call itself failed to reach the
 * background (service worker not yet woken, extension mid-reload, or —
 * historically, before this pass moved off a long-lived Port — a stale
 * `chrome.runtime.connect` port). Shown only after the caller has
 * genuinely given up, never speculatively.
 */
const CONNECTION_LOST: FriendlyError = {
  title: "Capture connection interrupted",
  body: "The extension temporarily lost its connection. Please try again.",
};

/**
 * Patterns matched against the raw (technical) error message. Order
 * matters — the first match wins. Matching is deliberately loose
 * (case-insensitive substring) since browser error text isn't a stable
 * API contract across Chrome versions.
 */
const PATTERNS: Array<{ test: RegExp; friendly: FriendlyError }> = [
  { test: /extensions gallery cannot be scripted/i, friendly: PROTECTED_PAGE },
  { test: /cannot access.*chrome:\/\//i, friendly: PROTECTED_PAGE },
  { test: /cannot be scripted/i, friendly: PROTECTED_PAGE },
  { test: /does not allow extensions to capture/i, friendly: PROTECTED_PAGE },
  { test: /no longer on the page/i, friendly: NO_SCROLL_CONTAINER },
  { test: /did not scroll as expected/i, friendly: DID_NOT_SCROLL },
  { test: /capture is too large/i, friendly: TOO_LARGE },
  { test: /could not be brought into view|moved while it was being captured/i, friendly: SCROLL_AREA_UNAVAILABLE },
  { test: /infinite scroll/i, friendly: PAGE_CHANGED },
  { test: /tab was closed|no tab with id|frame was removed/i, friendly: CAPTURE_INTERRUPTED },
  { test: /disconnected port object|receiving end does not exist|message port closed before a response|extension context invalidated/i, friendly: CONNECTION_LOST },
];

/**
 * Maps a raw technical error message to safe, human-readable copy. The
 * raw message should still be logged to the console by the caller for
 * debugging — this function's output is what the UI shows.
 */
export function mapBrowserError(rawMessage: string): FriendlyError {
  for (const { test, friendly } of PATTERNS) {
    if (test.test(rawMessage)) {
      return friendly;
    }
  }
  return GENERIC;
}
