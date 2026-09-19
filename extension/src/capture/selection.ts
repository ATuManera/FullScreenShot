// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Interactive "Select Scroll Area" mode and the element-targeting helpers a
 * chosen container needs during capture. Like injectable.ts, every exported
 * function here is self-contained (see that file's header comment) because
 * they all run via `chrome.scripting.executeScript({ func })`.
 *
 * Two shipped defects shape this file:
 *
 * 1. The picker used to *be* the background's wait: `executeScript` was handed
 *    an async function whose Promise resolved only on a click, and the
 *    background awaited that call. Clicking anything that was not a candidate
 *    settled nothing, so the flow could stay pending indefinitely with the
 *    page left holding the picker's outlines, marker attributes and
 *    document-level capture listeners. The picker now installs itself,
 *    returns immediately, and reports its outcome as a runtime message
 *    (selectionProtocol.ts) — and owns a page-side watchdog, so the overlay is
 *    cleaned up even if nothing is listening any more.
 *
 * 2. The container's on-screen rectangle was measured once, before the loop,
 *    and reused for every crop, with nothing ensuring the container was
 *    on-screen at all. A container taller than (or below) the viewport
 *    produced crops clamped to the screenshot's bounds, so tiles came back
 *    with mismatched heights and the compositor failed with a raw
 *    "invalid dimensions: 640x64". Capture geometry is now established by
 *    `prepareContainerForCapture`, which brings the container into view first
 *    and reports the genuinely visible band.
 */

export const CONTAINER_SELECTOR_ATTR = "data-fullscreenshot-container-id";

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

/** Everything `captureScrollArea` needs once the container has been brought into view. */
export interface ContainerCaptureGeometry {
  /** The container's own scroll extent and its restore point. */
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  originalScrollTop: number;
  /** The page scroll this preparation step moved to, so it can be restored. */
  pageScrollX: number;
  pageScrollY: number;
  /** The container's content box, in CSS px, clipped to what is actually on screen. */
  cropX: number;
  cropY: number;
  cropWidth: number;
  /** Height of the on-screen band — the real tile height, which may be less than `clientHeight`. */
  visibleHeight: number;
  devicePixelRatio: number;
}

/** Where a requested band of container content actually ended up on screen. */
export interface ContainerBandOutcome {
  requestedOffset: number;
  /** The content row now sitting at the top of the on-screen band. */
  achievedOffset: number;
  /** The largest content offset this container can ever bring to the top of a band. */
  maxContentOffset: number;
  cropX: number;
  cropY: number;
  /** How much of the band is genuinely on screen — less than requested means the page ran out of room. */
  availableHeight: number;
}

declare global {
  interface Window {
    __fssPickerCleanup?: (outcome: "cancelled") => void;
  }
}

/**
 * Installs the visual picker and returns how many candidates it highlighted.
 * Returns immediately — the user's choice arrives later as a
 * `SCROLL_AREA_SELECTION` runtime message tagged with `requestId`.
 *
 * Every exit path (candidate click, click elsewhere, Escape, navigation away,
 * watchdog expiry) restores the page and reports exactly one outcome, so the
 * flow can never be left pending and the page can never be left decorated.
 */
export function runSelectionPicker(attr: string, requestId: string, watchdogMs: number): number {
  const MIN_W = 40;
  const MIN_H = 40;
  const MIN_SCROLL_DELTA = 24;
  const MESSAGE_TYPE = "SCROLL_AREA_SELECTION";

  // A previous picker left running (e.g. the worker was evicted mid-selection)
  // must be torn down before a new one is installed.
  if (window.__fssPickerCleanup) {
    window.__fssPickerCleanup("cancelled");
  }
  for (const stale of Array.from(document.querySelectorAll(`[${attr}]`))) {
    stale.removeAttribute(attr);
  }

  const root = document.documentElement;
  const body = document.body;
  const all = body ? body.querySelectorAll<HTMLElement>("*") : [];
  const candidates: HTMLElement[] = [];
  all.forEach((el) => {
    if (el === root || el === body) return;
    if (el.scrollHeight <= el.clientHeight + 1 || el.clientWidth === 0 || el.clientHeight === 0) return;
    if (el.getAttribute("aria-hidden") === "true") return;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    const overflowY = style.overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") return;
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_W || rect.height < MIN_H) return;
    if (el.scrollHeight - el.clientHeight < MIN_SCROLL_DELTA) return;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return;
    candidates.push(el);
  });

  let settled = false;
  /**
   * Reports the outcome and confirms it arrived.
   *
   * Fire-and-forget was not enough. A terminal outcome that fails to land —
   * no receiver at that instant, the worker mid-restart, the extension
   * context torn down — left the page tidy and the extension still waiting,
   * with nothing to end the selection but its watchdog. That turns a
   * deterministic "cancel" into "cancel in ninety seconds". The background
   * answers with `{ received: true }`, and anything else is retried a few
   * times over well under a second before giving up.
   */
  const report = (payload: Record<string, unknown>): void => {
    if (settled) return;
    settled = true;
    const message = { type: MESSAGE_TYPE, requestId, ...payload };
    const retryDelayMs = 150;
    const attempt = (remaining: number): void => {
      const again = (): void => {
        if (remaining > 0) setTimeout(() => attempt(remaining - 1), retryDelayMs);
      };
      let pending: unknown;
      try {
        pending = chrome.runtime.sendMessage(message);
      } catch {
        again();
        return;
      }
      void Promise.resolve(pending).then((response) => {
        const acknowledged = typeof response === "object" && response !== null && (response as { received?: unknown }).received === true;
        if (!acknowledged) again();
      }, again);
    };
    attempt(4);
  };

  if (candidates.length === 0) {
    // Nothing to pick is not the same as choosing not to pick.
    report({ status: "no-candidates" });
    return 0;
  }

  const previousOutline = new Map<HTMLElement, string>();
  const previousCursor = new Map<HTMLElement, string>();
  candidates.forEach((el, i) => {
    el.setAttribute(attr, String(i));
    previousOutline.set(el, el.style.outline);
    previousCursor.set(el, el.style.cursor);
    el.style.outline = "2px solid #2563eb";
    el.style.cursor = "pointer";
  });

  let watchdog = 0;
  // `keepAttrOn`: the chosen element keeps its marker attribute so the capture
  // steps can re-find it by `[attr="value"]`; everything else is put back
  // exactly as it was, including the attribute.
  const cleanup = (keepAttrOn: HTMLElement | null): void => {
    if (watchdog) clearTimeout(watchdog);
    candidates.forEach((el) => {
      el.style.outline = previousOutline.get(el) ?? "";
      el.style.cursor = previousCursor.get(el) ?? "";
      if (el !== keepAttrOn) el.removeAttribute(attr);
    });
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("mouseover", onHover, true);
    window.removeEventListener("pagehide", onPageHide, true);
    window.__fssPickerCleanup = undefined;
  };

  function onHover(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    const matched = target ? target.closest(`[${attr}]`) : null;
    candidates.forEach((el) => {
      el.style.outline = el === matched ? "3px solid #1d4ed8" : "2px solid #2563eb";
    });
  }
  function onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    const matched = target ? target.closest(`[${attr}]`) : null;
    e.preventDefault();
    e.stopPropagation();
    if (matched instanceof HTMLElement) {
      const value = matched.getAttribute(attr) ?? "";
      cleanup(matched);
      report({ status: "selected", attr, value });
      return;
    }
    // Clicking outside every candidate is a decision too. Leaving it
    // unhandled is what allowed the flow to hang.
    cleanup(null);
    report({ status: "cancelled" });
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    cleanup(null);
    report({ status: "cancelled" });
  }
  function onPageHide(): void {
    cleanup(null);
    report({ status: "error", message: "The page navigated away during scroll-area selection." });
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mouseover", onHover, true);
  window.addEventListener("pagehide", onPageHide, true);
  window.__fssPickerCleanup = (): void => {
    cleanup(null);
    report({ status: "cancelled" });
  };
  watchdog = setTimeout(() => {
    cleanup(null);
    report({ status: "cancelled" });
  }, watchdogMs) as unknown as number;

  return candidates.length;
}

/** Tears down a picker left installed on the page, reporting nothing. */
export function abortSelectionPicker(): boolean {
  const cleanup = window.__fssPickerCleanup;
  if (!cleanup) return false;
  cleanup("cancelled");
  return true;
}

/**
 * Brings the container fully into view (as far as the page allows), then
 * reports the geometry the capture will actually use. `scrollIntoView` alone
 * is not enough: it may leave the container's top edge above the viewport, so
 * the position is corrected and re-read before measuring. The returned
 * `visibleHeight` is the height of the band that `captureVisibleTab()` can
 * really see, which is what every tile must be cropped to.
 */
export function prepareContainerForCapture(attr: string, value: string): Promise<ContainerCaptureGeometry | null> {
  const el = document.querySelector(`[${attr}="${value}"]`) as HTMLElement | null;
  if (!el) {
    return Promise.resolve(null);
  }
  const originalScrollTop = el.scrollTop;
  const twoFrames = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  el.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
  return twoFrames()
    .then(() => {
      const rect = el.getBoundingClientRect();
      const topEdge = rect.top - el.clientTop;
      if (topEdge < 0) {
        window.scrollBy(0, topEdge);
        return twoFrames();
      }
      return undefined;
    })
    .then(() => {
      const rect = el.getBoundingClientRect();
      const cropX = rect.left + el.clientLeft;
      const cropY = rect.top + el.clientTop;
      const visibleHeight = Math.min(el.clientHeight, window.innerHeight - cropY);
      return {
        scrollHeight: el.scrollHeight,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
        originalScrollTop,
        pageScrollX: window.scrollX,
        pageScrollY: window.scrollY,
        cropX,
        cropY,
        cropWidth: el.clientWidth,
        visibleHeight,
        devicePixelRatio: window.devicePixelRatio,
      };
    });
}

/**
 * Brings one band of the container's content on screen and reports where it
 * really landed.
 *
 * `element.scrollTop` alone is enough only while the container's box fits in
 * the viewport. A container taller than the window can scroll its content no
 * further than `scrollHeight - clientHeight`, yet the rows past that point sit
 * in the part of its box that is below the fold — reachable only by moving the
 * page as well. Scrolling the container as far as it goes and then moving the
 * page by exactly the remainder keeps the requested row at the top of the
 * visible band without ever scrolling the page for its own sake (section 19),
 * and without silently dropping the tail of a tall container's content.
 */
export function positionContainerBand(attr: string, value: string, contentOffset: number, bandHeight: number): Promise<ContainerBandOutcome | null> {
  const el = document.querySelector(`[${attr}="${value}"]`) as HTMLElement | null;
  if (!el) {
    return Promise.resolve(null);
  }
  const twoFrames = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  const containerTop = Math.min(contentOffset, maxScrollTop);
  el.scrollTop = containerTop;
  const pageExtra = contentOffset - containerTop;

  return twoFrames()
    .then(() => {
      // Put box row `pageExtra` at the viewport's top edge; for every tile a
      // container of ordinary height can reach on its own, `pageExtra` is 0
      // and this is just "keep the container's top aligned".
      const boxTop = el.getBoundingClientRect().top + el.clientTop;
      const delta = boxTop - -pageExtra;
      if (Math.abs(delta) > 0.5) {
        window.scrollBy(0, delta);
        return twoFrames();
      }
      return undefined;
    })
    .then(() => {
      const rect = el.getBoundingClientRect();
      const boxTop = rect.top + el.clientTop;
      const cropY = Math.max(0, boxTop);
      const achievedExtra = cropY - boxTop;
      return {
        requestedOffset: contentOffset,
        achievedOffset: el.scrollTop + achievedExtra,
        maxContentOffset: Math.max(0, el.scrollHeight - bandHeight),
        cropX: rect.left + el.clientLeft,
        cropY,
        availableHeight: Math.min(el.clientHeight - achievedExtra, window.innerHeight - cropY),
      };
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

/**
 * Restores the container's scroll position and removes the marker attribute
 * the capture used to re-find it. Runs from `captureScrollArea`'s `finally`,
 * so the page keeps none of the capture's bookkeeping — the previous
 * implementation reset `scrollTop` to 0 rather than to where the user had it,
 * and left the marker attribute behind permanently.
 */
export function releaseContainer(attr: string, value: string, restoreScrollTop: number): boolean {
  const el = document.querySelector(`[${attr}="${value}"]`) as HTMLElement | null;
  if (!el) {
    return false;
  }
  el.scrollTop = restoreScrollTop;
  el.removeAttribute(attr);
  return true;
}
