// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Pure presentation logic for the Result Page — no DOM, no chrome.*,
 * so every wording/formatting decision is directly testable. Kept
 * deliberately honest about what FullScreenShot can and cannot know
 * without the `downloads` permission (see DOWNLOAD_LOCATION_NOTE): it
 * never claims a filesystem path or that Chrome finished writing the
 * file, only that the download was started.
 */

export interface ResultDisplayMeta {
  width?: number;
  height?: number;
  pdfPageSize?: "a4" | "letter" | "auto";
  pdfOrientation?: "portrait" | "landscape";
  textLayer?: boolean;
}

export const READY_STATUS = "Capture complete";
export const DOWNLOADED_STATUS = "Download started";
export const EXPIRED_STATUS = "Result expired";
export const MISSING_STATUS = "No capture selected";

/** Truthful about what Chrome has told the extension — never a fabricated path (no `downloads` permission). */
export const DOWNLOAD_LOCATION_NOTE = "Chrome will use your configured download location.";

/** Timestamp-based TTL wording — matches the opportunistic-cleanup implementation, not an active countdown. */
export const TTL_NOTE = "Temporary result · available for up to 15 minutes.";

export const EXPIRED_BODY = "This temporary capture is no longer available. Create a new capture to continue.";
export const MISSING_BODY = "Open this page from a FullScreenShot capture to see a result here.";

export const DOWNLOAD_AGAIN_LABEL = "Download again";
export const CLOSE_LABEL = "Close";
export const CLOSE_FALLBACK_TEXT = "You can close this tab when you're done.";

/**
 * How the page asks to be closed, with everything it touches passed in.
 *
 * There is no permission-free way to be told whether `window.close()` worked,
 * and no synchronous signal either. What is reliable is the negative: a tab
 * that actually closed never runs anything scheduled afterwards. So the
 * scheduled step means the close was refused, and the button gives way to an
 * instruction instead of sitting there looking broken.
 *
 * Kept here, with its effects as ports, so the sequence is testable without a
 * browser — the bug this replaces was precisely a control that looked
 * available and did nothing.
 */
export interface CloseControlPorts {
  close: () => void;
  hideButton: () => void;
  showFallback: (text: string) => void;
  schedule: (run: () => void, delayMs: number) => void;
}

/** How long to wait before concluding the browser refused to close the tab. */
export const CLOSE_CONFIRMATION_DELAY_MS = 300;

export function requestClose(ports: CloseControlPorts): void {
  ports.close();
  ports.schedule(() => {
    ports.hideButton();
    ports.showFallback(CLOSE_FALLBACK_TEXT);
  }, CLOSE_CONFIRMATION_DELAY_MS);
}

function extensionLabel(mimeType: string): string {
  if (mimeType === "image/png") return "PNG";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "text/markdown") return "Markdown";
  return "File";
}

/** e.g. "Download PNG", "Download PDF", "Download Markdown". */
export function downloadButtonLabel(mimeType: string): string {
  return `Download ${extensionLabel(mimeType)}`;
}

function formatDimensions(width: number, height: number): string {
  return `${width} × ${height}`;
}

function formatPdfPageSizeName(pageSize: ResultDisplayMeta["pdfPageSize"]): string | null {
  if (pageSize === "a4") return "A4";
  if (pageSize === "letter") return "Letter";
  // "auto" sizes the PDF page to the captured content — there's no
  // standard page name to show, so it's simply omitted rather than
  // printing a made-up label.
  return null;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/**
 * What a PDF's text layer is called when it exists.
 *
 * Only shown when the composer reported placing text. A PDF of a page made
 * entirely of images has no text layer, and saying "Searchable text" over it
 * would be the one claim on this page that the file cannot back up.
 */
export const SEARCHABLE_TEXT_NOTE = "Searchable text";

/**
 * The one-line format summary under the filename, e.g.
 * "PNG · 1664 × 944", "PDF · A4 · Portrait · Searchable text", "Markdown".
 * Never fakes metadata that isn't available — falls back to just the format
 * name.
 */
export function formatFormatSummary(mimeType: string, meta: ResultDisplayMeta): string {
  if (mimeType === "image/png") {
    return meta.width && meta.height ? `PNG · ${formatDimensions(meta.width, meta.height)}` : "PNG";
  }
  if (mimeType === "application/pdf") {
    const pageName = formatPdfPageSizeName(meta.pdfPageSize);
    const orientation = meta.pdfOrientation ? capitalize(meta.pdfOrientation) : null;
    const searchable = meta.textLayer === true ? SEARCHABLE_TEXT_NOTE : null;
    const parts = [pageName, orientation, searchable].filter((part): part is string => part !== null);
    return parts.length > 0 ? `PDF · ${parts.join(" · ")}` : "PDF";
  }
  if (mimeType === "text/markdown") {
    return "Markdown";
  }
  return extensionLabel(mimeType);
}
