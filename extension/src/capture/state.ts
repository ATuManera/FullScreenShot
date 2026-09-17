// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Transactional page-state snapshot: `begin()` captures what a capture
 * run is about to change, and either `restore()` (used on both normal
 * completion and on cancel/error) puts everything back. There is no
 * separate "commit" step that skips restoration — capture never leaves
 * scroll position or inline styles different from how it found them.
 */
export interface PageStateSnapshot {
  scrollX: number;
  scrollY: number;
  documentElementInlineOverflow: string;
  bodyInlineOverflow: string;
  documentElementInlineScrollBehavior: string;
}

export function begin(doc: Document = document, win: Window = window): PageStateSnapshot {
  const root = doc.documentElement;
  const body = doc.body;
  return {
    scrollX: win.scrollX,
    scrollY: win.scrollY,
    documentElementInlineOverflow: root.style.overflow,
    bodyInlineOverflow: body ? body.style.overflow : "",
    documentElementInlineScrollBehavior: root.style.scrollBehavior,
  };
}

export function restore(snapshot: PageStateSnapshot, doc: Document = document, win: Window = window): void {
  const root = doc.documentElement;
  const body = doc.body;
  root.style.overflow = snapshot.documentElementInlineOverflow;
  root.style.scrollBehavior = snapshot.documentElementInlineScrollBehavior;
  if (body) {
    body.style.overflow = snapshot.bodyInlineOverflow;
  }
  win.scrollTo(snapshot.scrollX, snapshot.scrollY);
}

/** Disables smooth scrolling for the duration of a capture so `scrollTo` is synchronous-ish. */
export function suppressSmoothScroll(doc: Document = document): void {
  doc.documentElement.style.scrollBehavior = "auto";
}
