// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { loadResult } from "../shared/resultStore.js";
import {
  CLOSE_FALLBACK_TEXT,
  DOWNLOADED_STATUS,
  DOWNLOAD_AGAIN_LABEL,
  DOWNLOAD_LOCATION_NOTE,
  EXPIRED_BODY,
  EXPIRED_STATUS,
  MISSING_BODY,
  MISSING_STATUS,
  READY_STATUS,
  TTL_NOTE,
  downloadButtonLabel,
  formatFormatSummary,
} from "./resultView.js";

const statusPill = document.getElementById("status-pill");
const resultSummary = document.getElementById("result-summary") as HTMLElement | null;
const resultFilename = document.getElementById("result-filename");
const resultFormat = document.getElementById("result-format");
const downloadLocationNote = document.getElementById("download-location-note");
const ttlNote = document.getElementById("ttl-note");
const downloadLink = document.getElementById("download-link") as HTMLAnchorElement | null;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement | null;
const closeFallback = document.getElementById("close-fallback");

const resultExpired = document.getElementById("result-expired") as HTMLElement | null;
const expiredTitle = document.getElementById("expired-title");
const expiredBody = document.getElementById("expired-body");
const expiredCloseBtn = document.getElementById("expired-close-btn") as HTMLButtonElement | null;
const expiredCloseFallback = document.getElementById("expired-close-fallback");

const previewPanel = document.getElementById("preview-panel") as HTMLElement | null;
const imagePreview = document.getElementById("image-preview") as HTMLImageElement | null;
const pdfPreview = document.getElementById("pdf-preview") as HTMLIFrameElement | null;
const textPreview = document.getElementById("text-preview") as HTMLPreElement | null;

/**
 * `state` drives the status pill's color via CSS — text always carries
 * the meaning too, never color alone. The leading checkmark on "ready"
 * is a decorative prefix on top of the word "complete", not a
 * color/icon-only stand-in for it.
 */
function setStatus(text: string, state: "ready" | "downloaded" | "expired" | "missing"): void {
  if (statusPill) {
    statusPill.textContent = state === "ready" ? `✓ ${text}` : text;
    statusPill.dataset.state = state;
  }
}

/**
 * Attempts to close this extension-created tab without the `downloads`
 * or `tabs` permission. `window.close()` works for a tab Chrome
 * considers "opened by a script" — which `chrome.tabs.create()` from
 * the background counts as — but Chrome may still refuse it in some
 * contexts. There's no synchronous success signal, so failure is
 * detected by simply still being here shortly afterward, and the UI
 * degrades to a plain instruction rather than a button that appears to
 * do nothing.
 */
function attemptClose(button: HTMLButtonElement, fallback: HTMLElement | null): void {
  window.close();
  setTimeout(() => {
    if (!document.hidden) {
      button.hidden = true;
      if (fallback) {
        fallback.textContent = CLOSE_FALLBACK_TEXT;
        fallback.hidden = false;
      }
    }
  }, 300);
}

function wireClose(button: HTMLButtonElement | null, fallback: HTMLElement | null): void {
  if (!button) return;
  button.hidden = false;
  button.addEventListener("click", () => attemptClose(button, fallback));
}

function showExpired(status: string, state: "expired" | "missing", title: string, body: string): void {
  setStatus(status, state);
  if (resultSummary) resultSummary.hidden = true;
  if (resultExpired) resultExpired.hidden = false;
  if (expiredTitle) expiredTitle.textContent = title;
  if (expiredBody) expiredBody.textContent = body;
  wireClose(expiredCloseBtn, expiredCloseFallback);
}

/** Guards the download control against a rapid accidental double-click re-triggering the same download twice. */
function debounceClicks<T extends (event: MouseEvent) => void>(handler: T, cooldownMs = 400): T {
  let locked = false;
  return ((event: MouseEvent) => {
    if (locked) {
      event.preventDefault();
      return;
    }
    locked = true;
    setTimeout(() => {
      locked = false;
    }, cooldownMs);
    handler(event);
  }) as T;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) {
    showExpired(MISSING_STATUS, "missing", MISSING_STATUS, MISSING_BODY);
    return;
  }

  const stored = await loadResult(id);
  if (!stored) {
    showExpired(EXPIRED_STATUS, "expired", EXPIRED_STATUS, EXPIRED_BODY);
    return;
  }

  const mimeType = stored.blob.type;
  const objectUrl = URL.createObjectURL(stored.blob);

  if (resultSummary) resultSummary.hidden = false;
  if (resultFilename) {
    resultFilename.textContent = stored.filename;
    resultFilename.title = stored.filename;
  }
  if (resultFormat) {
    resultFormat.textContent = formatFormatSummary(mimeType, {
      width: stored.width,
      height: stored.height,
      pdfPageSize: stored.pdfPageSize,
      pdfOrientation: stored.pdfOrientation,
    });
  }
  if (downloadLocationNote) downloadLocationNote.textContent = DOWNLOAD_LOCATION_NOTE;
  if (ttlNote) ttlNote.textContent = TTL_NOTE;

  if (downloadLink) {
    downloadLink.href = objectUrl;
    downloadLink.download = stored.filename;
    const readyLabel = downloadButtonLabel(mimeType);
    downloadLink.textContent = readyLabel;
    downloadLink.addEventListener(
      "click",
      debounceClicks(() => {
        setStatus(DOWNLOADED_STATUS, "downloaded");
        downloadLink.textContent = DOWNLOAD_AGAIN_LABEL;
        wireClose(closeBtn, closeFallback);
      }),
    );
  }

  if (previewPanel) {
    if (mimeType === "image/png" && imagePreview) {
      imagePreview.src = objectUrl;
      imagePreview.alt = `Full captured page — ${stored.filename}`;
      imagePreview.hidden = false;
      previewPanel.hidden = false;
    } else if (mimeType === "application/pdf" && pdfPreview) {
      pdfPreview.src = objectUrl;
      pdfPreview.hidden = false;
      previewPanel.hidden = false;
    } else if (mimeType === "text/markdown" && textPreview) {
      textPreview.textContent = await stored.blob.text();
      textPreview.hidden = false;
      previewPanel.hidden = false;
    }
  }

  setStatus(READY_STATUS, "ready");
}

void main();
