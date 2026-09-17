// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Interactive "Select Scroll Area" mode and the element-targeting helpers
 * a chosen container needs during capture. Like injectable.ts, every
 * exported function here is self-contained (see that file's header
 * comment) because they all run via
 * `chrome.scripting.executeScript({ func })`.
 */

const CONTAINER_ID_ATTR = "data-fullscreenshot-container-id";

export interface ContainerSelector {
  attr: string;
  value: string;
}

export interface ElementCaptureMetrics {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  devicePixelRatio: number;
}

export interface ElementViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

/**
 * Highlights every scrollable candidate on the page and resolves with the
 * one the user clicks (or `null` if they press Escape). Never removes
 * anything from the DOM; only toggles `outline` and a marker attribute,
 * both cleared before resolving.
 */
export async function enterSelectionMode(): Promise<ContainerSelector | null> {
  const attr = "data-fullscreenshot-container-id";
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("*")).filter((el) => {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    const scrollable = overflowY === "auto" || overflowY === "scroll";
    return scrollable && el.scrollHeight > el.clientHeight + 1;
  });

  if (candidates.length === 0) {
    return null;
  }

  const previousOutlines = new Map<HTMLElement, string>();
  candidates.forEach((el, i) => {
    el.setAttribute(attr, String(i));
    previousOutlines.set(el, el.style.outline);
    el.style.outline = "2px solid #2563eb";
  });

  return new Promise<ContainerSelector | null>((resolve) => {
    // `keepAttrOn`: the chosen element keeps its marker attribute (later
    // capture steps re-find it via `[attr="value"]`); every other
    // candidate loses both the outline and the now-unneeded attribute.
    const cleanup = (keepAttrOn: HTMLElement | null): void => {
      candidates.forEach((el) => {
        el.style.outline = previousOutlines.get(el) ?? "";
        if (el !== keepAttrOn) {
          el.removeAttribute(attr);
        }
      });
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      const matched = target ? target.closest(`[${attr}]`) : null;
      if (matched instanceof HTMLElement) {
        e.preventDefault();
        e.stopPropagation();
        const value = matched.getAttribute(attr) ?? "";
        cleanup(matched);
        resolve({ attr, value });
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        cleanup(null);
        resolve(null);
      }
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
  });
}

export function measureContainerBySelector(attr: string, value: string): ElementCaptureMetrics | null {
  const el = document.querySelector(`[${attr}="${value}"]`) as HTMLElement | null;
  if (!el) {
    return null;
  }
  return {
    scrollWidth: el.scrollWidth,
    scrollHeight: el.scrollHeight,
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}

export function boundingRectBySelector(attr: string, value: string): ElementViewportRect | null {
  const el = document.querySelector(`[${attr}="${value}"]`) as HTMLElement | null;
  if (!el) {
    return null;
  }
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    devicePixelRatio: window.devicePixelRatio,
  };
}

export function scrollContainerBySelector(attr: string, value: string, top: number): boolean {
  const el = document.querySelector(`[${attr}="${value}"]`) as HTMLElement | null;
  if (!el) {
    return false;
  }
  el.scrollTop = top;
  return true;
}

/** Exported for tests only — mirrors the marker attribute name used above. */
export const CONTAINER_SELECTOR_ATTR = CONTAINER_ID_ATTR;
