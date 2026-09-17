// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Pure DOM measurement — no chrome.* APIs, so this is directly testable
 * by loading it as a plain ES module against any page (including the
 * fixtures in tests/pages/).
 */
export interface PageMetrics {
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
}

export function measurePage(doc: Document = document, win: Window = window): PageMetrics {
  const root = doc.documentElement;
  return {
    scrollWidth: root.scrollWidth,
    scrollHeight: root.scrollHeight,
    viewportWidth: win.innerWidth,
    viewportHeight: win.innerHeight,
    devicePixelRatio: win.devicePixelRatio,
    scrollX: win.scrollX,
    scrollY: win.scrollY,
  };
}

export interface ElementMetrics {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  scrollLeft: number;
  scrollTop: number;
}

export function measureElement(el: Element): ElementMetrics {
  return {
    scrollWidth: el.scrollWidth,
    scrollHeight: el.scrollHeight,
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
    scrollLeft: el.scrollLeft,
    scrollTop: el.scrollTop,
  };
}

/** True when `el` has its own scrollable overflow larger than its box. */
export function isScrollContainer(el: Element, win: Window = window): boolean {
  const style = win.getComputedStyle(el);
  const overflowY = style.overflowY;
  const scrollable = overflowY === "auto" || overflowY === "scroll";
  return scrollable && el.scrollHeight > el.clientHeight + 1;
}

/**
 * URLs/schemes browsers never let an extension capture regardless of
 * permissions (internal pages, store listings, etc). Detecting this lets
 * FullScreenShot report a clear message instead of silently failing.
 */
export function isCapturableUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const blockedSchemes = new Set(["chrome:", "edge:", "about:", "devtools:", "view-source:", "chrome-extension:", "chrome-error:"]);
  if (blockedSchemes.has(parsed.protocol)) {
    return false;
  }
  if (parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore")) {
    return false;
  }
  if (parsed.hostname === "microsoftedge.microsoft.com" && parsed.pathname.startsWith("/addons")) {
    return false;
  }
  return true;
}
