// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Message contract between popup.ts and background/index.ts, carried over
 * a single `chrome.runtime.connect({ name: PORT_NAME })` port so the
 * background can push multiple progress updates during one capture.
 * Every inbound message is validated by `parseInboundMessage` — never
 * trust a runtime message's shape, per the extension's threat model
 * (SECURITY.md: "extension message spoofing", "unexpected messages").
 */
export const PORT_NAME = "fullscreenshot-capture";

export type CaptureMode = "visible" | "fullpage" | "scrollarea" | "markdown";
export type ExportFormat = "png" | "pdf";
export type PdfPageSize = "a4" | "letter" | "auto";
export type PdfOrientation = "portrait" | "landscape";
export type MarkdownExportMode = "article" | "full-dom";

export interface StartCaptureMessage {
  type: "START_CAPTURE";
  mode: CaptureMode;
  exportFormat: ExportFormat;
  pdfPageSize: PdfPageSize;
  pdfOrientation: PdfOrientation;
  markdownMode: MarkdownExportMode;
}

export interface CancelMessage {
  type: "CANCEL";
}

export type InboundMessage = StartCaptureMessage | CancelMessage;

export interface ProgressMessage {
  type: "PROGRESS";
  status: string;
}

export interface DoneMessage {
  type: "DONE";
  resultId: string;
  width: number;
  height: number;
}

export interface CancelledMessage {
  type: "CANCELLED";
}

export interface ErrorMessage {
  type: "ERROR";
  message: string;
}

export interface NoContainerSelectedMessage {
  type: "NO_CONTAINER_SELECTED";
}

export type OutboundMessage = ProgressMessage | DoneMessage | CancelledMessage | ErrorMessage | NoContainerSelectedMessage;

function isCaptureMode(value: unknown): value is CaptureMode {
  return value === "visible" || value === "fullpage" || value === "scrollarea" || value === "markdown";
}

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "png" || value === "pdf";
}

function isPdfPageSize(value: unknown): value is PdfPageSize {
  return value === "a4" || value === "letter" || value === "auto";
}

function isPdfOrientation(value: unknown): value is PdfOrientation {
  return value === "portrait" || value === "landscape";
}

function isMarkdownExportMode(value: unknown): value is MarkdownExportMode {
  return value === "article" || value === "full-dom";
}

/** Validates an untrusted message received on the capture port. */
export function parseInboundMessage(raw: unknown): InboundMessage | null {
  if (typeof raw !== "object" || raw === null || !("type" in raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.type === "CANCEL") {
    return { type: "CANCEL" };
  }
  if (candidate.type === "START_CAPTURE") {
    const mode = candidate.mode;
    const exportFormat = candidate.exportFormat ?? "png";
    const pdfPageSize = candidate.pdfPageSize ?? "auto";
    const pdfOrientation = candidate.pdfOrientation ?? "portrait";
    const markdownMode = candidate.markdownMode ?? "article";
    if (isCaptureMode(mode) && isExportFormat(exportFormat) && isPdfPageSize(pdfPageSize) && isPdfOrientation(pdfOrientation) && isMarkdownExportMode(markdownMode)) {
      return { type: "START_CAPTURE", mode, exportFormat, pdfPageSize, pdfOrientation, markdownMode };
    }
  }
  return null;
}
