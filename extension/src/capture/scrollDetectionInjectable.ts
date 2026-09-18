// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Contextual scroll-area detection (UX-P2). Like injectable.ts /
 * selection.ts / markdown.ts, every exported function here is
 * self-contained for `chrome.scripting.executeScript({ func })` — it
 * cannot import `scrollAnalysis.ts`'s ranking logic, so ranking happens
 * afterwards, outside the page, on the raw geometry these functions
 * return.
 *
 * The candidate filter below is intentionally cheap-first: a plain
 * geometry/property check runs against every element before the far
 * more expensive `getComputedStyle` call, which only runs for elements
 * that already look plausible. This matters on large pages (section 15
 * performance constraints).
 */
import type { ScrollCandidateGeometry } from "./scrollAnalysis.js";

const CONTAINER_ID_ATTR = "data-fullscreenshot-container-id";

export interface ContainerSelector {
  attr: string;
  value: string;
}

/**
 * Pure analysis only — never mutates the page. Returns the raw geometry
 * of every element that could plausibly be a meaningful internal scroll
 * region; `scrollAnalysis.rankAndDeduplicate` does the actual
 * size-thresholding and dedup afterwards.
 */
export function detectScrollCandidates(): ScrollCandidateGeometry[] {
  const root = document.documentElement;
  const body = document.body;
  const all = body ? body.querySelectorAll<HTMLElement>("*") : [];
  const results: ScrollCandidateGeometry[] = [];

  all.forEach((el) => {
    if (el === root || el === body) {
      return;
    }
    // Cheap rejection first: an element that isn't taller-scrolling than
    // its own box, or has no box at all, can never be a scroll region —
    // skip the expensive getComputedStyle call entirely for it.
    if (el.scrollHeight <= el.clientHeight + 1 || el.clientWidth === 0 || el.clientHeight === 0) {
      return;
    }
    if (el.getAttribute("aria-hidden") === "true") {
      return;
    }

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return;
    }
    const overflowY = style.overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") {
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    // Must actually intersect the current viewport to be a usable capture target.
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) {
      return;
    }

    results.push({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
  });

  return results;
}

/**
 * Re-runs the same detection as `detectScrollCandidates` (kept in sync
 * with it manually — see that function's filter) and, only when it
 * finds exactly one meaningful candidate by simple geometry thresholds,
 * tags that single element with the marker attribute the existing
 * scroll-capture pipeline (`selection.ts`) already knows how to
 * re-find, and returns its selector. Returns `null` for 0 or 2+
 * candidates so the caller can fall back to the interactive picker.
 */
export function selectSoleScrollCandidate(): ContainerSelector | null {
  const attr = "data-fullscreenshot-container-id";
  const root = document.documentElement;
  const body = document.body;
  const all = body ? body.querySelectorAll<HTMLElement>("*") : [];
  const MIN_W = 40;
  const MIN_H = 40;
  const MIN_SCROLL_DELTA = 24;

  const candidates: HTMLElement[] = [];
  all.forEach((el) => {
    if (el === root || el === body) {
      return;
    }
    if (el.scrollHeight <= el.clientHeight + 1 || el.clientWidth === 0 || el.clientHeight === 0) {
      return;
    }
    if (el.getAttribute("aria-hidden") === "true") {
      return;
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return;
    }
    const overflowY = style.overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") {
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_W || rect.height < MIN_H) {
      return;
    }
    if (el.scrollHeight - el.clientHeight < MIN_SCROLL_DELTA) {
      return;
    }
    candidates.push(el);
  });

  const el = candidates[0];
  if (candidates.length !== 1 || !el) {
    return null;
  }

  el.setAttribute(attr, "sole");
  return { attr, value: "sole" };
}

/** Exported for tests only — mirrors the marker attribute used above. */
export const CONTAINER_SELECTOR_ATTR = CONTAINER_ID_ATTR;
