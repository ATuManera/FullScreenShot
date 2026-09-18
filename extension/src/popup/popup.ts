// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { isCapturableUrl } from "../capture/geometry.js";
import { detectScrollCandidates } from "../capture/scrollDetectionInjectable.js";
import { rankAndDeduplicate, classifyScrollAreaUiState } from "../capture/scrollAnalysis.js";
import { PORT_NAME, type CaptureMode, type ExportFormat, type MarkdownExportMode, type OutboundMessage, type PdfOrientation, type PdfPageSize } from "../background/messages.js";
import { mapBrowserError, type FriendlyError } from "./errors.js";
import { loadPreferences, savePreferences } from "./preferences.js";

const PROTECTED_PAGE: FriendlyError = {
  title: "Capture unavailable on this page",
  body: "Chrome doesn't allow extensions to capture protected browser pages. Open a regular website to use FullScreenShot.",
};

// --- Element references -----------------------------------------------
const pageContextEl = document.getElementById("page-context");
const restrictedNotice = document.getElementById("restricted-notice") as HTMLDivElement;
const restrictedTitle = document.getElementById("restricted-title") as HTMLParagraphElement;
const restrictedBody = document.getElementById("restricted-body") as HTMLParagraphElement;
const errorNotice = document.getElementById("error-notice") as HTMLDivElement;
const errorTitle = document.getElementById("error-title") as HTMLParagraphElement;
const errorBody = document.getElementById("error-body") as HTMLParagraphElement;

const viewMain = document.getElementById("view-main") as HTMLElement;
const viewMarkdown = document.getElementById("view-markdown") as HTMLElement;

const scrollareaCard = document.getElementById("scrollarea-card") as HTMLLabelElement;
const scrollareaTitle = document.getElementById("scrollarea-title") as HTMLSpanElement;
const scrollareaSubtitle = document.getElementById("scrollarea-subtitle") as HTMLSpanElement;

const pdfOptions = document.getElementById("pdf-options") as HTMLElement;
const primaryCta = document.getElementById("primary-cta") as HTMLButtonElement;

const progressRow = document.getElementById("progress-row") as HTMLDivElement;
const progressBar = document.getElementById("progress-bar") as HTMLDivElement;
const progressFill = document.getElementById("progress-fill") as HTMLDivElement;
const progressText = document.getElementById("progress-text") as HTMLParagraphElement;
const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;

const markdownEntry = document.getElementById("markdown-entry") as HTMLButtonElement;
const markdownBack = document.getElementById("markdown-back") as HTMLButtonElement;
const markdownExportBtn = document.getElementById("markdown-export-btn") as HTMLButtonElement;
const markdownModeHint = document.getElementById("markdown-mode-hint") as HTMLParagraphElement;

function captureModeRadios(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[name="capture-mode"]'));
}
function exportFormatRadios(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[name="export-format"]'));
}
function pdfPageSizeRadios(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[name="pdf-page-size"]'));
}
function pdfOrientationRadios(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[name="pdf-orientation"]'));
}
function markdownModeRadios(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[name="markdown-mode"]'));
}

function checkedValue(radios: HTMLInputElement[]): string | undefined {
  return radios.find((r) => r.checked)?.value;
}
function setChecked(radios: HTMLInputElement[], value: string): void {
  for (const r of radios) {
    r.checked = r.value === value;
  }
}

// --- Small helpers -------------------------------------------------------
function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function primaryCtaLabel(): string {
  const mode = checkedValue(captureModeRadios()) as CaptureMode | undefined;
  switch (mode) {
    case "visible":
      return "Capture visible area";
    case "scrollarea":
      return scrollAreaState.kind === "multiple" ? "Choose scroll area" : "Capture scroll area";
    case "fullpage":
    default:
      return "Capture full page";
  }
}

function updatePrimaryCtaLabel(): void {
  if (!busy) {
    primaryCta.textContent = primaryCtaLabel();
  }
}

function showRestricted(friendly: FriendlyError): void {
  restrictedTitle.textContent = friendly.title;
  restrictedBody.textContent = friendly.body;
  restrictedNotice.hidden = false;
  viewMain.hidden = true;
  viewMarkdown.hidden = true;
  markdownEntry.hidden = true;
}

function showError(friendly: FriendlyError, rawMessage: string): void {
  console.error("[FullScreenShot]", rawMessage);
  errorTitle.textContent = friendly.title;
  errorBody.textContent = friendly.body;
  errorNotice.hidden = false;
}

function clearError(): void {
  errorNotice.hidden = true;
}

// --- Busy / progress state ------------------------------------------------
let busy = false;

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  primaryCta.disabled = nextBusy;
  markdownEntry.disabled = nextBusy;
  markdownExportBtn.disabled = nextBusy;
  for (const r of [...captureModeRadios(), ...exportFormatRadios(), ...pdfPageSizeRadios(), ...pdfOrientationRadios(), ...markdownModeRadios()]) {
    r.disabled = nextBusy;
  }
  progressRow.hidden = !nextBusy;
  if (!nextBusy) {
    updatePrimaryCtaLabel();
  }
}

function renderProgress(text: string, current?: number, total?: number): void {
  progressText.textContent = text;
  if (current !== undefined && total !== undefined && total > 0) {
    progressBar.removeAttribute("data-indeterminate");
    progressBar.setAttribute("aria-valuenow", String(Math.round((current / total) * 100)));
    progressFill.style.width = `${Math.min(100, Math.round((current / total) * 100))}%`;
  } else {
    progressBar.setAttribute("data-indeterminate", "true");
    progressBar.removeAttribute("aria-valuenow");
  }
}

// --- Scroll-area contextual state (UX-P2) --------------------------------
type ScrollAreaState = { kind: "none" } | { kind: "single" } | { kind: "multiple"; count: number };
let scrollAreaState: ScrollAreaState = { kind: "none" };

function applyScrollAreaState(state: ScrollAreaState): void {
  scrollAreaState = state;
  if (state.kind === "none") {
    scrollareaCard.hidden = true;
    return;
  }
  scrollareaCard.hidden = false;
  if (state.kind === "single") {
    scrollareaTitle.textContent = "Scroll area";
    scrollareaSubtitle.textContent = "1 scrollable region detected";
  } else {
    scrollareaTitle.textContent = "Choose scroll area…";
    scrollareaSubtitle.textContent = `${state.count} scrollable regions detected`;
  }
  updatePrimaryCtaLabel();
}

async function analyzeScrollAreas(tabId: number): Promise<void> {
  try {
    const [{ result: rawCandidates }] = (await chrome.scripting.executeScript({
      target: { tabId },
      func: detectScrollCandidates,
    })) as unknown as [{ result: ReturnType<typeof detectScrollCandidates> }];
    const deduplicated = rankAndDeduplicate(rawCandidates ?? []);
    const classification = classifyScrollAreaUiState(deduplicated);
    applyScrollAreaState(classification.kind === "multiple" ? { kind: "multiple", count: classification.count } : { kind: classification.kind });
  } catch (e) {
    // Scroll-area analysis failing must never block Full Page / Visible
    // Area (section 6.10) — log and simply omit the scroll-area mode.
    console.error("[FullScreenShot] scroll-area analysis failed", e);
    applyScrollAreaState({ kind: "none" });
  }
}

// --- Preferences ----------------------------------------------------------
async function applyStoredPreferences(): Promise<void> {
  const prefs = await loadPreferences();
  setChecked(exportFormatRadios(), prefs.exportFormat);
  setChecked(pdfPageSizeRadios(), prefs.pdfPageSize);
  setChecked(pdfOrientationRadios(), prefs.pdfOrientation);
  setChecked(markdownModeRadios(), prefs.markdownMode);
  pdfOptions.hidden = prefs.exportFormat !== "pdf";
  updateMarkdownHint();
}

function updateMarkdownHint(): void {
  const mode = checkedValue(markdownModeRadios());
  markdownModeHint.textContent = mode === "full-dom" ? "Preserves more page structure" : "Best for readable page content";
}

exportFormatRadios().forEach((r) =>
  r.addEventListener("change", () => {
    const value = checkedValue(exportFormatRadios()) as ExportFormat;
    pdfOptions.hidden = value !== "pdf";
    void savePreferences({ exportFormat: value });
  }),
);
pdfPageSizeRadios().forEach((r) =>
  r.addEventListener("change", () => {
    void savePreferences({ pdfPageSize: checkedValue(pdfPageSizeRadios()) as PdfPageSize });
  }),
);
pdfOrientationRadios().forEach((r) =>
  r.addEventListener("change", () => {
    void savePreferences({ pdfOrientation: checkedValue(pdfOrientationRadios()) as PdfOrientation });
  }),
);
markdownModeRadios().forEach((r) =>
  r.addEventListener("change", () => {
    updateMarkdownHint();
    void savePreferences({ markdownMode: checkedValue(markdownModeRadios()) as MarkdownExportMode });
  }),
);
captureModeRadios().forEach((r) => r.addEventListener("change", updatePrimaryCtaLabel));

// --- Markdown subview toggle -----------------------------------------------
markdownEntry.addEventListener("click", () => {
  viewMain.hidden = true;
  viewMarkdown.hidden = false;
});
markdownBack.addEventListener("click", () => {
  viewMarkdown.hidden = true;
  viewMain.hidden = false;
});

// --- Capture port (single, reused for the popup's lifetime) ---------------
const port = chrome.runtime.connect({ name: PORT_NAME });

port.onMessage.addListener((raw: unknown) => {
  const message = raw as OutboundMessage;
  switch (message.type) {
    case "STATE": {
      if (message.active) {
        setBusy(true);
        if (message.progress) {
          renderProgress(message.progress.text, message.progress.current, message.progress.total);
        }
      }
      return;
    }
    case "PROGRESS":
      setBusy(true);
      renderProgress(message.text, message.current, message.total);
      return;
    case "DONE":
      renderProgress("Capture ready", undefined, undefined);
      setBusy(false);
      return;
    case "CANCELLED":
      renderProgress("Cancelled — page restored", undefined, undefined);
      setBusy(false);
      return;
    case "NO_CONTAINER_SELECTED":
      setBusy(false);
      showError({ title: "No area selected", body: "Choose a scrollable region on the page, or use Full page / Visible area instead." }, "no scroll container selected");
      return;
    case "ALREADY_CAPTURING":
      setBusy(true);
      showError({ title: "Capture already running", body: "Wait for the current capture to finish, or cancel it, before starting another." }, "already capturing");
      return;
    case "ERROR":
      setBusy(false);
      showError(mapBrowserError(message.message), message.message);
      return;
  }
});

cancelBtn.addEventListener("click", () => {
  port.postMessage({ type: "CANCEL" });
});

function startCapture(mode: CaptureMode): void {
  clearError();
  setBusy(true);
  renderProgress("Preparing…");

  const exportFormat = (checkedValue(exportFormatRadios()) ?? "png") as ExportFormat;
  const pdfPageSize = (checkedValue(pdfPageSizeRadios()) ?? "auto") as PdfPageSize;
  const pdfOrientation = (checkedValue(pdfOrientationRadios()) ?? "portrait") as PdfOrientation;
  const markdownMode = (checkedValue(markdownModeRadios()) ?? "article") as MarkdownExportMode;

  port.postMessage({
    type: "START_CAPTURE",
    mode,
    exportFormat,
    pdfPageSize,
    pdfOrientation,
    markdownMode,
  });
}

primaryCta.addEventListener("click", () => {
  const mode = (checkedValue(captureModeRadios()) ?? "fullpage") as CaptureMode;
  startCapture(mode);
});
markdownExportBtn.addEventListener("click", () => startCapture("markdown"));

// --- Startup ---------------------------------------------------------------
async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const hostname = hostnameOf(tab?.url);

  if (!tab || !tab.id || !tab.url || !isCapturableUrl(tab.url)) {
    if (pageContextEl) pageContextEl.textContent = "Protected browser page";
    showRestricted(PROTECTED_PAGE);
    port.postMessage({ type: "GET_STATE" });
    return;
  }

  if (pageContextEl) pageContextEl.textContent = hostname ?? "";

  await applyStoredPreferences();
  port.postMessage({ type: "GET_STATE" });
  await analyzeScrollAreas(tab.id);
  updatePrimaryCtaLabel();
}

void main();
