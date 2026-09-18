// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { loadResult } from "../shared/resultStore.js";

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

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) {
    setStatus("No capture id provided.");
    return;
  }

  const stored = await loadResult(id);
  if (!stored) {
    setStatus("Result expired. This temporary capture is no longer available — capture the page again to create a new result.");
    return;
  }

  const objectUrl = URL.createObjectURL(stored.blob);

  if (previewWrap && downloadLink) {
    previewWrap.hidden = false;
    downloadLink.hidden = false;
    downloadLink.href = objectUrl;
    downloadLink.download = stored.filename;
    downloadLink.textContent = `Download ${stored.filename.split(".").pop()?.toUpperCase()}`;

    const mimeType = stored.blob.type;
    if (mimeType === "image/png" && imagePreview) {
      imagePreview.src = objectUrl;
      imagePreview.hidden = false;
    } else if (mimeType === "application/pdf" && pdfPreview) {
      pdfPreview.src = objectUrl;
      pdfPreview.hidden = false;
    } else if (mimeType === "text/markdown" && textPreview) {
      textPreview.textContent = await stored.blob.text();
      textPreview.hidden = false;
    }
  }
  setStatus("Capture complete.");
}

void main();
