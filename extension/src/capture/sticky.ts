// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Detects position:fixed / position:sticky elements and reversibly hides
 * them between tiles so a header/footer anchored to the viewport isn't
 * duplicated in every tile of the stitched output. Never removes anything
 * from the DOM — only toggles an inline style, restored byte-for-byte.
 *
 * "Hidden between tiles" alone is not enough, because full-page stitching
 * keeps each tile's band only up to the next tile's origin. A viewport-
 * anchored element survives into the output only if it happens to sit inside
 * a band that is retained: the top of the first tile is retained, but the
 * bottom of it is discarded, which is why a `position: fixed; bottom: 0`
 * footer used to vanish entirely — neither duplicated nor preserved. Deciding
 * which edge an element belongs to is what lets the orchestrator show it in
 * the one band where it lands correctly. The classification below is the pure,
 * testable half; `injectable.ts` mirrors it for the in-page side.
 */
const MARKER_ATTR = "data-fullscreenshot-hidden";

/** Which viewport edge a fixed/sticky element is anchored to, if any. */
export type FixedAnchor = "top" | "bottom" | "other";

/** How close to an edge an element must sit to be claimed by it, as a share of viewport height. */
const ANCHOR_SLACK_RATIO = 0.1;
/** How much of the viewport width an element must span to count as a bar rather than a widget. */
const BAR_WIDTH_RATIO = 0.6;
/** An element this tall is a full-screen overlay, not a bar belonging to one edge. */
const OVERLAY_HEIGHT_RATIO = 0.9;

export interface AnchorGeometry {
  /** Viewport-relative edges, as `getBoundingClientRect` reports them. */
  top: number;
  bottom: number;
  width: number;
}

/**
 * Decides which viewport edge an element hangs off, from geometry alone.
 *
 * Deliberately not keyed off computed `top`/`bottom` strings: authors write
 * `top: 8px`, `bottom: 16px`, transforms and `calc()`, and Chrome reports used
 * values for positioned elements, so the declared side is not a reliable
 * signal. What does hold is that a header sits against the upper edge and a
 * footer against the lower one, and that a *bar* spans the viewport while a
 * corner widget does not.
 *
 * Anything that is off-screen, empty, covers the whole viewport, is too narrow
 * to be a bar, or sits too far from both edges is "other" — which keeps the
 * long-standing behaviour for it rather than guessing.
 */
export function classifyFixedAnchor(geometry: AnchorGeometry, viewportHeight: number, viewportWidth: number): FixedAnchor {
  const { top, bottom, width } = geometry;
  const height = bottom - top;
  if (height <= 0 || bottom <= 0 || top >= viewportHeight) {
    return "other";
  }
  if (width < viewportWidth * BAR_WIDTH_RATIO) {
    return "other";
  }
  if (height >= viewportHeight * OVERLAY_HEIGHT_RATIO) {
    return "other";
  }
  const slack = viewportHeight * ANCHOR_SLACK_RATIO;
  const gapTop = top;
  const gapBottom = viewportHeight - bottom;
  if (gapTop <= slack && gapTop < gapBottom) {
    return "top";
  }
  if (gapBottom <= slack && gapBottom < gapTop) {
    return "bottom";
  }
  return "other";
}

export interface HiddenElementHandle {
  element: HTMLElement;
  previousInlineVisibility: string;
}

export function findFixedAndStickyElements(root: Document = document): HTMLElement[] {
  const win = root.defaultView;
  if (!win) {
    return [];
  }
  const all = root.body ? root.body.querySelectorAll<HTMLElement>("*") : [];
  const found: HTMLElement[] = [];
  all.forEach((el) => {
    const position = win.getComputedStyle(el).position;
    if (position === "fixed" || position === "sticky") {
      found.push(el);
    }
  });
  return found;
}

/** Hides `elements` reversibly (visibility:hidden, never removed from the DOM). */
export function hideElements(elements: HTMLElement[]): HiddenElementHandle[] {
  return elements.map((element) => {
    const previousInlineVisibility = element.style.visibility;
    element.setAttribute(MARKER_ATTR, "true");
    element.style.visibility = "hidden";
    return { element, previousInlineVisibility };
  });
}

/** Restores elements hidden by `hideElements`, in any order. */
export function restoreElements(handles: HiddenElementHandle[]): void {
  for (const { element, previousInlineVisibility } of handles) {
    element.style.visibility = previousInlineVisibility;
    element.removeAttribute(MARKER_ATTR);
  }
}
