// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Scroll verification for tiled capture.
 *
 * Requesting a scroll is not the same as having scrolled. `window.scrollTo`
 * and `element.scrollTop = n` both return without telling the caller whether
 * the pixels moved: the browser clamps at the bottom, and pages with custom
 * scroll engines, scroll-jacking or virtualized viewports routinely snap back
 * to where they were. The original capture loop trusted the *requested*
 * offset as each tile's band origin, so such a page yielded N identical
 * viewport screenshots that the compositor faithfully stitched into one tall
 * "full page" image — a large PNG made of duplicates, reported as a success.
 *
 * Everything in this module except the two injectables at the bottom is pure,
 * so the decisions below are unit-testable without a browser. The injectables
 * are self-contained for `chrome.scripting.executeScript({ func })` — see
 * injectable.ts's header for why they may not reference module scope.
 */

/** Sub-pixel/rounding slack when comparing a requested scroll to the achieved one. */
export const SCROLL_POSITION_TOLERANCE_PX = 2;

export interface TileDecisionInput {
  requestedY: number;
  /** Where the scroller actually ended up, read back after the browser settled. */
  actualY: number;
  /** The scroller's live maximum offset, re-read at the same moment as `actualY`. */
  maxScrollY: number;
  /** The previous captured tile's actual position, or `null` for the first tile. */
  previousActualY: number | null;
}

export type TileDecision =
  /** Capture this tile and record `offsetY` — the achieved position — as its band origin. */
  | { kind: "capture"; offsetY: number }
  /** The viewport is already represented by the previous tile; drop it silently. */
  | { kind: "skip"; reason: "duplicate-position" }
  /** The page refused a scroll it could have honoured; the capture cannot be completed honestly. */
  | { kind: "abort"; reason: "did-not-move" };

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= SCROLL_POSITION_TOLERANCE_PX;
}

/**
 * Decides what a tile is worth once its achieved scroll position is known.
 *
 * The distinction that matters is *why* a tile landed on the same viewport as
 * the previous one. Landing there because the browser clamped at the bottom of
 * the document is legitimate and the tile is simply redundant — skip it.
 * Landing there while the requested position was still reachable means the
 * page did not scroll at all, and every remaining tile would be the same
 * picture; that is the failure the duplicated-viewport capture came from, so
 * it aborts rather than producing a plausible-looking lie.
 */
export function decideTile({ requestedY, actualY, maxScrollY, previousActualY }: TileDecisionInput): TileDecision {
  if (previousActualY === null) {
    return { kind: "capture", offsetY: actualY };
  }
  if (!near(actualY, previousActualY)) {
    return { kind: "capture", offsetY: actualY };
  }
  // Same viewport as the previous tile. Was the requested position reachable?
  const wasReachable = requestedY <= maxScrollY + SCROLL_POSITION_TOLERANCE_PX;
  if (wasReachable && !near(requestedY, actualY)) {
    return { kind: "abort", reason: "did-not-move" };
  }
  return { kind: "skip", reason: "duplicate-position" };
}

/**
 * Last line of defense, applied once the whole capture is assembled: a page
 * that reports a moving scroll position while rendering the same pixels would
 * slip past `decideTile`. Deliberately narrow — it only fires when *every*
 * screenshot in a multi-tile, multi-position capture is byte-identical, so an
 * ordinary page with a blank stretch spanning two tiles is never rejected.
 */
export function allCapturedTilesIdentical(fingerprints: string[], actualYs: number[]): boolean {
  if (fingerprints.length < 2) {
    return false;
  }
  if (new Set(fingerprints).size !== 1) {
    return false;
  }
  return new Set(actualYs.map((y) => Math.round(y))).size > 1;
}

/**
 * Cheap, deterministic fingerprint of a decoded tile raster. Only needs to
 * separate "the same screenshot again" from "a different screenshot", so it
 * samples the buffer on a stride rather than hashing every byte — a full
 * cryptographic digest of every tile would cost more than the capture itself
 * on a long page. Length is folded in so differently sized rasters can never
 * collide.
 */
export function fingerprintRgba(rgba: Uint8Array): string {
  const step = Math.max(4, (rgba.length >> 10) & ~3);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < rgba.length; i += step) {
    const byte = rgba[i] as number;
    h1 = ((h1 ^ byte) * 16777619) >>> 0;
    h2 = ((h2 + byte) * 33 + i) >>> 0;
  }
  return `${h1.toString(16)}-${h2.toString(16)}-${rgba.length.toString(16)}`;
}

// --- Injectables ----------------------------------------------------------
// Self-contained on purpose (see injectable.ts): serialized by
// `executeScript({ func })` with no access to this module's scope.

export interface WindowScrollOutcome {
  requestedY: number;
  actualY: number;
  maxScrollY: number;
}

/**
 * Scrolls the window and reports where it actually ended up.
 *
 * The two chained `requestAnimationFrame`s are the synchronization point: the
 * first fires before the frame that applies the scroll, the second after it
 * has been composited, so the position read afterwards is the one the next
 * `captureVisibleTab()` will see. This replaces trusting `scrollTo` and
 * relying on the capture rate limiter's incidental delay to cover rendering.
 */
export function scrollWindowToVerified(y: number): Promise<WindowScrollOutcome> {
  window.scrollTo(0, y);
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroller = document.scrollingElement ?? document.documentElement;
        resolve({
          requestedY: y,
          actualY: window.scrollY,
          maxScrollY: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
        });
      });
    });
  });
}

/** Waits for one composited frame without moving anything — used before the first tile. */
export function settleFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
