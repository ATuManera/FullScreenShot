// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

const statusEl = document.getElementById("status");
const previewWrap = document.getElementById("preview-wrap");
const imagePreview = document.getElementById("image-preview") as HTMLImageElement | null;
const pdfPreview = document.getElementById("pdf-preview") as HTMLIFrameElement | null;
const textPreview = document.getElementById("text-preview") as HTMLPreElement | null;
const downloadLink = document.getElementById("download-link") as HTMLAnchorElement | null;

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function mimeTypeOf(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1] ?? "application/octet-stream";
}

async function dataUrlToText(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  return res.text();
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) {
    setStatus("No capture id provided.");
    return;
  }

  const stored = await chrome.storage.session.get(id);
  const entry = stored[id] as { dataUrl?: unknown; filename?: unknown } | undefined;
  const dataUrl = entry?.dataUrl;
  if (typeof dataUrl !== "string") {
    setStatus("This result is no longer available (it may have already been viewed, or the browser session ended).");
    return;
  }
  const filename = typeof entry?.filename === "string" ? entry.filename : "fullscreenshot.bin";

  const mimeType = mimeTypeOf(dataUrl);

  if (previewWrap && downloadLink) {
    previewWrap.hidden = false;
    downloadLink.hidden = false;
    downloadLink.href = dataUrl;
    downloadLink.download = filename;
    downloadLink.textContent = `Download ${filename.split(".").pop()?.toUpperCase()}`;

    if (mimeType === "image/png" && imagePreview) {
      imagePreview.src = dataUrl;
      imagePreview.hidden = false;
    } else if (mimeType === "application/pdf" && pdfPreview) {
      pdfPreview.src = dataUrl;
      pdfPreview.hidden = false;
    } else if (mimeType === "text/markdown" && textPreview) {
      textPreview.textContent = await dataUrlToText(dataUrl);
      textPreview.hidden = false;
    }
  }
  setStatus("Capture complete.");

  await chrome.storage.session.remove(id);
}

void main();
