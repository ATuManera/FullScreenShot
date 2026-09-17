// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Detects position:fixed / position:sticky elements and reversibly hides
 * them between tiles so a header/footer anchored to the viewport isn't
 * duplicated in every tile of the stitched output. Never removes anything
 * from the DOM — only toggles an inline style, restored byte-for-byte.
 */
const MARKER_ATTR = "data-fullscreenshot-hidden";

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
