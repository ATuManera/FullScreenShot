// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Which of the popup's views is on screen.
 *
 * Settings and About used to be a separate page opened in a browser tab — a
 * whole document, and a tab to dismiss afterwards, for two radio buttons and
 * a version number. They are views of the same small window now, alongside
 * the Markdown export panel that already worked this way.
 *
 * Kept pure and DOM-free (like progressView.ts) so the navigation itself is
 * testable: every subview leads back to Main and nowhere else, and a freshly
 * opened popup always starts at Main rather than wherever it was left.
 */
export type PopupView = "main" | "markdown" | "settings" | "about";

export const ALL_VIEWS: readonly PopupView[] = ["main", "markdown", "settings", "about"];

/** A popup is opened afresh every time; it never resumes a subview. */
export const DEFAULT_VIEW: PopupView = "main";

export type PopupNavigation = { kind: "open"; view: PopupView } | { kind: "back" };

/**
 * Applies a navigation. "Back" always means Main: the popup is two levels
 * deep at most, so there is no history to keep and nothing that could strand
 * someone in a subview.
 */
export function navigate(current: PopupView, action: PopupNavigation): PopupView {
  if (action.kind === "back") {
    return "main";
  }
  return action.view;
}

/** Whether `view`'s container should be visible while `current` is showing. */
export function isViewVisible(view: PopupView, current: PopupView): boolean {
  return view === current;
}
