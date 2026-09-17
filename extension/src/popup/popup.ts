// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";
import {
  PORT_NAME,
  type CaptureMode,
  type ExportFormat,
  type MarkdownExportMode,
  type OutboundMessage,
  type PdfOrientation,
  type PdfPageSize,
} from "../background/messages.js";

const status = document.getElementById("status");
const visibleBtn = document.getElementById("capture-visible") as HTMLButtonElement | null;
const fullPageBtn = document.getElementById("capture-fullpage") as HTMLButtonElement | null;
const scrollAreaBtn = document.getElementById("capture-scrollarea") as HTMLButtonElement | null;
const markdownBtn = document.getElementById("export-markdown") as HTMLButtonElement | null;
const cancelBtn = document.getElementById("cancel") as HTMLButtonElement | null;
const exportFormatSelect = document.getElementById("export-format") as HTMLSelectElement | null;
const pdfOptionsField = document.getElementById("pdf-options") as HTMLDivElement | null;
const pdfPageSizeSelect = document.getElementById("pdf-page-size") as HTMLSelectElement | null;
const pdfOrientationSelect = document.getElementById("pdf-orientation") as HTMLSelectElement | null;
const markdownModeSelect = document.getElementById("markdown-mode") as HTMLSelectElement | null;

if (status) {
  status.textContent = `FullScreenShot v${browser.getManifestVersion()} — Ready.`;
}

exportFormatSelect?.addEventListener("change", () => {
  if (pdfOptionsField) {
    pdfOptionsField.hidden = exportFormatSelect.value !== "pdf";
  }
});

function setBusy(busy: boolean): void {
  if (visibleBtn) visibleBtn.disabled = busy;
  if (fullPageBtn) fullPageBtn.disabled = busy;
  if (scrollAreaBtn) scrollAreaBtn.disabled = busy;
  if (markdownBtn) markdownBtn.disabled = busy;
  if (cancelBtn) cancelBtn.hidden = !busy;
}

function startCapture(mode: CaptureMode): void {
  setBusy(true);
  if (status) {
    status.textContent = "Preparing…";
  }

  const port = chrome.runtime.connect({ name: PORT_NAME });

  const finish = (text: string): void => {
    if (status) status.textContent = text;
    setBusy(false);
    cancelBtn?.removeEventListener("click", onCancelClick);
    port.disconnect();
  };

  const onCancelClick = (): void => {
    port.postMessage({ type: "CANCEL" });
  };
  cancelBtn?.addEventListener("click", onCancelClick);

  port.onMessage.addListener((raw: unknown) => {
    const message = raw as OutboundMessage;
    switch (message.type) {
      case "PROGRESS":
        if (status) status.textContent = message.status;
        return;
      case "DONE":
        finish("Done.");
        return;
      case "CANCELLED":
        finish("Cancelled — page restored.");
        return;
      case "NO_CONTAINER_SELECTED":
        finish("No area selected.");
        return;
      case "ERROR":
        finish(`Error: ${message.message}`);
        return;
    }
  });

  const exportFormat = (exportFormatSelect?.value ?? "png") as ExportFormat;
  const pdfPageSize = (pdfPageSizeSelect?.value ?? "auto") as PdfPageSize;
  const pdfOrientation = (pdfOrientationSelect?.value ?? "portrait") as PdfOrientation;
  const markdownMode = (markdownModeSelect?.value ?? "article") as MarkdownExportMode;

  port.postMessage({
    type: "START_CAPTURE",
    mode,
    exportFormat,
    pdfPageSize,
    pdfOrientation,
    markdownMode,
  });
}

visibleBtn?.addEventListener("click", () => startCapture("visible"));
fullPageBtn?.addEventListener("click", () => startCapture("fullpage"));
scrollAreaBtn?.addEventListener("click", () => startCapture("scrollarea"));
markdownBtn?.addEventListener("click", () => startCapture("markdown"));
