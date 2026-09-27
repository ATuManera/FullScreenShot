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
 * The one scroll-region detector. The popup's count, the direct capture and
 * the interactive picker all take their candidates from here: each of them
 * used to run its own copy of this filter, and the copies disagreed with the
 * popup's deduplicated count (see `scrollAnalysis.rankAndDeduplicate`), so a
 * page announced as having one region opened the picker anyway.
 *
 * Without `markAttr` it only reads the page (the popup's analysis). With it,
 * each candidate is tagged `markAttr="<index>"` so a later step can re-find
 * exactly the regions that survive ranking — see `keepScrollCandidates`.
 *
 * Reported geometry is the part of each element that is actually on screen:
 * clipped by the viewport and by every ancestor that clips it. An element
 * inside a collapsed `max-height: 0; overflow: hidden` panel has a full-size
 * box of its own and used to be offered as a region nobody could see.
 */
export function detectScrollCandidates(markAttr: string | null = null): ScrollCandidateGeometry[] {
  const root = document.documentElement;
  const body = document.body;
  const all = body ? body.querySelectorAll<HTMLElement>("*") : [];
  const results: ScrollCandidateGeometry[] = [];
  const found: HTMLElement[] = [];

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
    // Form controls scroll their own value, not page content: a long
    // <textarea> is an input to fill in, not a region to capture.
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT" || tag === "INPUT") {
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
    let left = Math.max(rect.left, 0);
    let top = Math.max(rect.top, 0);
    let right = Math.min(rect.right, window.innerWidth);
    let bottom = Math.min(rect.bottom, window.innerHeight);

    // Walk up, clipping by each ancestor that actually clips this element.
    // An absolutely positioned box escapes static ancestors until its
    // containing block; a fixed one escapes them all.
    let position = style.position;
    for (let ancestor = el.parentElement; ancestor && ancestor !== root && position !== "fixed" && right > left && bottom > top; ancestor = ancestor.parentElement) {
      const ancestorStyle = window.getComputedStyle(ancestor);
      if (position === "absolute" && ancestorStyle.position === "static") {
        continue;
      }
      if (ancestorStyle.overflowX !== "visible" || ancestorStyle.overflowY !== "visible") {
        const clip = ancestor.getBoundingClientRect();
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
      }
      position = ancestorStyle.position;
    }
    // Nothing of it on screen: not a usable capture target.
    if (right <= left || bottom <= top) {
      return;
    }

    results.push({
      index: results.length,
      top,
      left,
      width: right - left,
      height: bottom - top,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
    found.push(el);
  });

  if (markAttr) {
    // A marker left over from an earlier run would make `[attr="0"]`
    // ambiguous, so clear any before tagging this run's candidates.
    for (const stale of Array.from(document.querySelectorAll(`[${markAttr}]`))) {
      stale.removeAttribute(markAttr);
    }
    found.forEach((el, index) => el.setAttribute(markAttr, String(index)));
  }

  return results;
}

/**
 * Removes the marker from every candidate `detectScrollCandidates` tagged
 * except those whose index is in `keep` — the regions that survived ranking
 * and deduplication. Returns how many remain marked.
 */
export function keepScrollCandidates(attr: string, keep: string[]): number {
  let remaining = 0;
  for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) {
    if (keep.includes(el.getAttribute(attr) ?? "")) {
      remaining += 1;
    } else {
      el.removeAttribute(attr);
    }
  }
  return remaining;
}

/**
 * Finds the element that scrolls the page when the document root does not.
 *
 * With `html { overflow: hidden }` and `body { height: 100%; overflow: auto }`
 * the page's content scrolls inside the body: the root's `scrollHeight` is
 * one screen, so Full Page planned and captured exactly one screen. When
 * that is the case the body is tagged `attr="page"` and returned, so Full
 * Page can capture it the way Scroll Area captures a container. Returns
 * `null` for an ordinary page, whose root scrolls.
 */
export function locatePageScroller(attr: string): ContainerSelector | null {
  const body = document.body;
  const scroller = document.scrollingElement ?? document.documentElement;
  if (!body || scroller.scrollHeight > scroller.clientHeight + 1) {
    return null;
  }
  if (body.scrollHeight <= body.clientHeight + 1) {
    return null;
  }
  const overflowY = window.getComputedStyle(body).overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") {
    return null;
  }
  for (const stale of Array.from(document.querySelectorAll(`[${attr}]`))) {
    stale.removeAttribute(attr);
  }
  body.setAttribute(attr, "page");
  return { attr, value: "page" };
}

/** Exported for tests only — mirrors the marker attribute used above. */
export const CONTAINER_SELECTOR_ATTR = CONTAINER_ID_ATTR;
