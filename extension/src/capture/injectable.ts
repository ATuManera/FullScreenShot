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
 */

declare global {
  interface Window {
    __fssHiddenHandles?: Array<{ element: HTMLElement; previousInlineVisibility: string }>;
  }
}

/** Finds and reversibly hides fixed/sticky elements; returns how many. */
export function hideFixedAndStickyElements(): number {
  const win = window;
  const doc = document;
  const body = doc.body;
  const all = body ? body.querySelectorAll<HTMLElement>("*") : [];
  const handles: Array<{ element: HTMLElement; previousInlineVisibility: string }> = [];
  all.forEach((el) => {
    const position = win.getComputedStyle(el).position;
    if (position === "fixed" || position === "sticky") {
      handles.push({ element: el, previousInlineVisibility: el.style.visibility });
      el.setAttribute("data-fullscreenshot-hidden", "true");
      el.style.visibility = "hidden";
    }
  });
  win.__fssHiddenHandles = handles;
  return handles.length;
}

/** Restores elements hidden by `hideFixedAndStickyElements` for this tab. */
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
