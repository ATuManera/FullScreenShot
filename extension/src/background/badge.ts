// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Minimal toolbar-icon progress hint via chrome.action's badge — no new
 * permission needed (the `action` API is already implicit for any MV3
 * extension declaring an `action` key in its manifest). Never left
 * stale: every setter that isn't `clearBadgeAfterDelay` is expected to
 * be followed, eventually, by either another update or a clear.
 */
let clearTimer: ReturnType<typeof setTimeout> | null = null;

function cancelPendingClear(): void {
  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

export function setBadgeProgress(current: number, total: number): void {
  cancelPendingClear();
  void chrome.action.setBadgeText({ text: `${current}/${total}` });
  void chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
}

export function setBadgeIndeterminate(): void {
  cancelPendingClear();
  void chrome.action.setBadgeText({ text: "…" });
  void chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
}

export function setBadgeSuccess(): void {
  cancelPendingClear();
  void chrome.action.setBadgeText({ text: "✓" });
  void chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
  clearBadgeAfterDelay(2500);
}

export function setBadgeError(): void {
  cancelPendingClear();
  void chrome.action.setBadgeText({ text: "!" });
  void chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
  clearBadgeAfterDelay(4000);
}

export function clearBadge(): void {
  cancelPendingClear();
  void chrome.action.setBadgeText({ text: "" });
}

export function clearBadgeAfterDelay(delayMs: number): void {
  cancelPendingClear();
  clearTimer = setTimeout(() => {
    clearTimer = null;
    void chrome.action.setBadgeText({ text: "" });
  }, delayMs);
}
