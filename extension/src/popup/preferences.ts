// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Locally persisted user preferences (UX-P3 8.7). Only non-sensitive UI
 * choices are stored — never page URLs/content, never the active
 * capture mode (that always resets to "fullpage" per UX-P1 6.3).
 */
import type { ExportFormat, MarkdownExportMode, PdfOrientation, PdfPageSize } from "../background/messages.js";

export type LazyModePreference = "fast" | "reliable";

export interface Preferences {
  exportFormat: ExportFormat;
  pdfPageSize: PdfPageSize;
  pdfOrientation: PdfOrientation;
  markdownMode: MarkdownExportMode;
  lazyMode: LazyModePreference;
}

export const DEFAULT_PREFERENCES: Preferences = {
  exportFormat: "png",
  pdfPageSize: "auto",
  pdfOrientation: "portrait",
  markdownMode: "article",
  lazyMode: "fast",
};

const STORAGE_KEY = "fullscreenshot.preferences";

function isExportFormat(v: unknown): v is ExportFormat {
  return v === "png" || v === "pdf";
}
function isPdfPageSize(v: unknown): v is PdfPageSize {
  return v === "a4" || v === "letter" || v === "auto";
}
function isPdfOrientation(v: unknown): v is PdfOrientation {
  return v === "portrait" || v === "landscape";
}
function isMarkdownExportMode(v: unknown): v is MarkdownExportMode {
  return v === "article" || v === "full-dom";
}
function isLazyModePreference(v: unknown): v is LazyModePreference {
  return v === "fast" || v === "reliable";
}

/**
 * Merges a (possibly partial, possibly corrupt — storage is never fully
 * trusted) stored value over the defaults, field by field. Pure and
 * testable without chrome.storage.
 */
export function mergePreferences(stored: unknown): Preferences {
  const candidate = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  return {
    exportFormat: isExportFormat(candidate.exportFormat) ? candidate.exportFormat : DEFAULT_PREFERENCES.exportFormat,
    pdfPageSize: isPdfPageSize(candidate.pdfPageSize) ? candidate.pdfPageSize : DEFAULT_PREFERENCES.pdfPageSize,
    pdfOrientation: isPdfOrientation(candidate.pdfOrientation) ? candidate.pdfOrientation : DEFAULT_PREFERENCES.pdfOrientation,
    markdownMode: isMarkdownExportMode(candidate.markdownMode) ? candidate.markdownMode : DEFAULT_PREFERENCES.markdownMode,
    lazyMode: isLazyModePreference(candidate.lazyMode) ? candidate.lazyMode : DEFAULT_PREFERENCES.lazyMode,
  };
}

export async function loadPreferences(): Promise<Preferences> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return mergePreferences(stored[STORAGE_KEY]);
}

export async function savePreferences(partial: Partial<Preferences>): Promise<Preferences> {
  const current = await loadPreferences();
  const next = mergePreferences({ ...current, ...partial });
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
