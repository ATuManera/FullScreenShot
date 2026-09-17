// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

const statusEl = document.getElementById("status");
const previewWrap = document.getElementById("preview-wrap");
const previewImg = document.getElementById("preview") as HTMLImageElement | null;
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

  const stored = await chrome.storage.session.get(id);
  const dataUrl = stored[id];
  if (typeof dataUrl !== "string") {
    setStatus("This result is no longer available (it may have already been viewed, or the browser session ended).");
    return;
  }

  if (previewImg && previewWrap && downloadLink) {
    previewImg.src = dataUrl;
    previewWrap.hidden = false;
    downloadLink.href = dataUrl;
    downloadLink.hidden = false;
  }
  setStatus("Capture complete.");

  await chrome.storage.session.remove(id);
}

void main();
