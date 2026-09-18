// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * `chrome.scripting.executeScript({ func })` serializes the function via
 * `Function.prototype.toString()` and re-evaluates it inside the target
 * page — it does NOT bring along imports or outer module scope, and its
 * return value must be structured-cloneable (so no HTMLElement refs can
 * cross back to the background script). Every function in this file is
 * therefore self-contained on purpose: it may only reference its own
 * parameters/locals and web-platform globals (document, window, ...).
 * State that must survive between the "hide" and "restore" calls for the
 * same tab is stashed on a page-global instead of returned.
 *
 * `geometry.ts`'s `measurePage` has no such constraint (no sibling calls,
 * only default-parameter globals) and is injected directly, unmodified —
 * see orchestrator.ts.
 *
 * The anchor classification below mirrors `sticky.ts`'s `classifyFixedAnchor`
 * and must be kept in step with it; that copy is the unit-tested one, this
 * one is the copy that can actually cross into the page.
 */

declare global {
  interface Window {
    __fssHiddenHandles?: Array<{ element: HTMLElement; previousInlineVisibility: string }>;
  }
}

/**
 * Which fixed/sticky elements stay visible for the tile about to be captured.
 *
 * `show-top` is the first retained band (a header belongs there), `hide-all`
 * every band in between, and `show-bottom` the final band — the only place a
 * bottom-anchored footer can land exactly once. `show-all` is for a capture
 * that is a single viewport, where the output is the viewport and everything
 * in it belongs.
 */
export type FixedVisibilityMode = "show-all" | "show-top" | "show-bottom" | "hide-all";

export interface FixedElementCensus {
  top: number;
  bottom: number;
  other: number;
  hidden: number;
}

/**
 * Applies `mode` to every fixed/sticky element, reversibly, and reports what
 * it found. Hiding is `visibility: hidden` on the element's inline style —
 * never a DOM move and never a layout-affecting property, so the page's
 * geometry (and therefore the capture plan) is unchanged.
 */
export function applyFixedElementVisibility(mode: FixedVisibilityMode): FixedElementCensus {
  const win = window;
  const doc = document;
  const body = doc.body;
  const all = body ? body.querySelectorAll<HTMLElement>("*") : [];
  const viewportHeight = win.innerHeight;
  const viewportWidth = win.innerWidth;
  const ANCHOR_SLACK_RATIO = 0.1;
  const BAR_WIDTH_RATIO = 0.6;
  const OVERLAY_HEIGHT_RATIO = 0.9;

  const classify = (top: number, bottom: number, width: number): "top" | "bottom" | "other" => {
    const height = bottom - top;
    if (height <= 0 || bottom <= 0 || top >= viewportHeight) return "other";
    if (width < viewportWidth * BAR_WIDTH_RATIO) return "other";
    if (height >= viewportHeight * OVERLAY_HEIGHT_RATIO) return "other";
    const slack = viewportHeight * ANCHOR_SLACK_RATIO;
    const gapTop = top;
    const gapBottom = viewportHeight - bottom;
    if (gapTop <= slack && gapTop < gapBottom) return "top";
    if (gapBottom <= slack && gapBottom < gapTop) return "bottom";
    return "other";
  };

  // Any previous mode is undone first, so each call is absolute rather than
  // cumulative — otherwise an element hidden for one tile could never come
  // back for the next.
  const previous = win.__fssHiddenHandles ?? [];
  for (const { element, previousInlineVisibility } of previous) {
    element.style.visibility = previousInlineVisibility;
    element.removeAttribute("data-fullscreenshot-hidden");
  }

  const census: FixedElementCensus = { top: 0, bottom: 0, other: 0, hidden: 0 };
  const handles: Array<{ element: HTMLElement; previousInlineVisibility: string }> = [];
  all.forEach((el) => {
    const position = win.getComputedStyle(el).position;
    if (position !== "fixed" && position !== "sticky") {
      return;
    }
    const rect = el.getBoundingClientRect();
    const anchor = classify(rect.top, rect.bottom, rect.width);
    census[anchor] += 1;

    let visible: boolean;
    switch (mode) {
      case "show-all":
        visible = true;
        break;
      case "show-top":
        visible = anchor !== "bottom";
        break;
      case "show-bottom":
        visible = anchor === "bottom";
        break;
      default:
        visible = false;
    }
    if (visible) {
      return;
    }
    handles.push({ element: el, previousInlineVisibility: el.style.visibility });
    el.setAttribute("data-fullscreenshot-hidden", "true");
    el.style.visibility = "hidden";
    census.hidden += 1;
  });
  win.__fssHiddenHandles = handles;
  return census;
}

/** Restores every element hidden by `applyFixedElementVisibility` for this tab. */
export function restoreFixedAndStickyElements(): number {
  const win = window;
  const handles = win.__fssHiddenHandles ?? [];
  for (const { element, previousInlineVisibility } of handles) {
    element.style.visibility = previousInlineVisibility;
    element.removeAttribute("data-fullscreenshot-hidden");
  }
  win.__fssHiddenHandles = [];
  return handles.length;
}
