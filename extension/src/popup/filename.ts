// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Deterministic, local-only filename generation (UX-P3 8.8). Pure and
 * testable: no chrome.* APIs, no network, no personal metadata beyond
 * the page's own hostname/title.
 */
const MAX_TITLE_SLUG_LENGTH = 60;

function slugify(value: string, maxLength: number): string {
  const collapsed = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return collapsed.slice(0, maxLength).replace(/-+$/g, "");
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** `YYYY-MM-DD_HHmm` in local time — deliberately no seconds/timezone/personal metadata. */
export function formatLocalTimestamp(date: Date): string {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return `${y}-${m}-${d}_${hh}${mm}`;
}

export interface FilenameInput {
  hostname: string;
  title: string;
  date: Date;
  ext: string;
}

const FALLBACK_HOSTNAME = "page";
const FALLBACK_TITLE = "capture";

/**
 * Builds `{hostname}_{page-title}_{YYYY-MM-DD_HHmm}.{ext}`, sanitized
 * for safe use as a filesystem filename on Windows/macOS/Linux alike.
 */
export function buildFilename({ hostname, title, date, ext }: FilenameInput): string {
  const hostSlug = slugify(hostname, 40) || FALLBACK_HOSTNAME;
  const titleSlug = slugify(title, MAX_TITLE_SLUG_LENGTH) || FALLBACK_TITLE;
  const timestamp = formatLocalTimestamp(date);
  const cleanExt = ext.replace(/^\.+/, "");
  return `${hostSlug}_${titleSlug}_${timestamp}.${cleanExt}`;
}
