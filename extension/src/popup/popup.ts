// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { isCapturableUrl } from "../capture/geometry.js";
import { detectScrollCandidates } from "../capture/scrollDetectionInjectable.js";
import { rankAndDeduplicate, classifyScrollAreaUiState } from "../capture/scrollAnalysis.js";
import { type CaptureMode, type ExportFormat, type InboundMessage, type MarkdownExportMode, type OutboundMessage, type PdfOrientation, type PdfPageSize } from "../background/messages.js";
import { mapBrowserError, type FriendlyError } from "./errors.js";
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences, type LazyModePreference } from "./preferences.js";
import { describesAFinishedCapture, progressStateForMessage, type ProgressRelevantMessage, type ProgressUiState } from "./progressView.js";

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
/**
 * Full-page loading mode lives in the options page, not here, so the popup
 * has no control bound to it — but it still has to travel with the capture
 * request. Held from the load below so the value sent is the one in force
 * when the button is pressed.
 */
let lazyMode: LazyModePreference = DEFAULT_PREFERENCES.lazyMode;

async function applyStoredPreferences(): Promise<void> {
  const prefs = await loadPreferences();
  lazyMode = prefs.lazyMode;
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

// --- Transport --------------------------------------------------------
// Discrete commands go through `chrome.runtime.sendMessage`, not a
// long-lived `chrome.runtime.connect` port — see messages.ts's doc
// comment for why: a port opened once here and reused for the popup's
// whole lifetime would silently go stale whenever the background
// service worker restarts in between (routine under MV3), and any
// later `port.postMessage()` would throw "Attempting to use a
// disconnected port object" (uncaught, since a plain postMessage call
// has nothing to catch it). `sendMessage` has no such state: every
// call is a fresh, self-contained round trip.
//
// PROGRESS/DONE/CANCELLED/ERROR/NO_CONTAINER_SELECTED arrive later,
// asynchronously, pushed by the background via its own
// `chrome.runtime.sendMessage` calls — heard here via a persistent
// `onMessage` listener. If the popup is closed when one is sent, it's
// simply never delivered (no error either side); the capture keeps
// running in the background regardless, and a reopened popup catches
// up via GET_STATE.
async function sendCommand(message: InboundMessage): Promise<OutboundMessage | null> {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as OutboundMessage | undefined;
    return response ?? null;
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[FullScreenShot] command failed to reach the background", message.type, raw);
    return null;
  }
}

/** Wipes the progress readout so a finished capture leaves nothing behind in the DOM. */
function clearProgress(): void {
  progressText.textContent = "";
  progressBar.removeAttribute("data-indeterminate");
  progressBar.removeAttribute("aria-valuenow");
  progressFill.style.width = "0%";
}

/** Applies a progress/busy decision (from progressView.ts) to the actual DOM. */
function applyProgressUiState(state: ProgressUiState): void {
  setBusy(state.busy);
  if (state.progressText !== null) {
    renderProgress(state.progressText, state.progressCurrent, state.progressTotal);
    return;
  }
  // No text to show and nothing running: clear the readout rather than leave
  // the last capture's words sitting in a hidden row, ready to reappear.
  if (!state.busy) {
    clearProgress();
  }
}

/**
 * The capture whose lifecycle has already ended.
 *
 * Two kinds of update can describe a capture that is already over. A
 * `GET_STATE` reply is a snapshot taken when the command was answered, so one
 * requested moments before a capture failed still says "Processing…" when it
 * arrives — and a popup reopened near the end of a capture does exactly that,
 * which is how a failed capture came to sit under its own error notice still
 * showing a progress bar and Cancel. A PROGRESS can arrive late for the same
 * reason, since `chrome.runtime.sendMessage` gives no ordering guarantee
 * between separate calls. Neither is state; both are history.
 */
let finishedSession: string | null = null;

/**
 * The capture this popup started, learned from the STARTED reply.
 *
 * Used to recognise the scroll-area picker being armed *for this request*.
 * An arming message from some earlier capture must not close a popup that is
 * now being used for something else.
 */
let startedSession: string | null = null;

/** Applies an update unless it is a stale description of a capture that already ended. */
function applyUpdate(message: ProgressRelevantMessage): void {
  if (describesAFinishedCapture(message, finishedSession)) {
    return;
  }
  applyProgressUiState(progressStateForMessage(message));
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  const message = raw as OutboundMessage;
  if (message.type === "PICKER_ARMED") {
    // The page now has a picker on it and needs the keyboard. While this
    // window is open it holds focus, so an Escape meant for the picker would
    // only dismiss the popup — which is why cancelling used to take two.
    // Closing only on this message, and only for this popup's own capture,
    // means the window never gets out of the way before there is something
    // there to receive the user.
    if (message.sessionId !== undefined && message.sessionId === startedSession) {
      window.close();
    }
    return;
  }
  if (message.type !== "STARTED" && describesAFinishedCapture(message, finishedSession)) {
    return;
  }
  if (message.type === "DONE" || message.type === "CANCELLED" || message.type === "ERROR" || message.type === "NO_CONTAINER_SELECTED") {
    if (message.sessionId !== undefined) {
      finishedSession = message.sessionId;
    }
  }
  switch (message.type) {
    case "STATE":
    case "PROGRESS":
    case "DONE":
    case "CANCELLED":
      applyProgressUiState(progressStateForMessage(message));
      return;
    case "NO_CONTAINER_SELECTED":
      applyProgressUiState(progressStateForMessage(message));
      showError({ title: "No area selected", body: "Choose a scrollable region on the page, or use Full page / Visible area instead." }, "no scroll container selected");
      return;
    case "ALREADY_CAPTURING":
      applyProgressUiState(progressStateForMessage(message));
      showError({ title: "Capture already running", body: "Wait for the current capture to finish, or cancel it, before starting another." }, "already capturing");
      return;
    case "ERROR":
      applyProgressUiState(progressStateForMessage(message));
      showError(mapBrowserError(message.message), message.message);
      return;
    case "STARTED":
      return;
  }
});

cancelBtn.addEventListener("click", () => {
  void sendCommand({ type: "CANCEL" }).then((response) => {
    if (response?.type === "STATE") {
      applyUpdate(response);
    }
  });
});

async function startCapture(mode: CaptureMode): Promise<void> {
  clearError();
  setBusy(true);
  renderProgress("Preparing…");

  const exportFormat = (checkedValue(exportFormatRadios()) ?? "png") as ExportFormat;
  const pdfPageSize = (checkedValue(pdfPageSizeRadios()) ?? "auto") as PdfPageSize;
  const pdfOrientation = (checkedValue(pdfOrientationRadios()) ?? "portrait") as PdfOrientation;
  const markdownMode = (checkedValue(markdownModeRadios()) ?? "article") as MarkdownExportMode;

  const response = await sendCommand({
    type: "START_CAPTURE",
    mode,
    exportFormat,
    pdfPageSize,
    pdfOrientation,
    markdownMode,
    lazyMode,
  });

  if (response === null) {
    // The command never reached the background — never surface the raw
    // browser/runtime error text; show recovery copy only now, after the
    // attempt has genuinely failed.
    setBusy(false);
    showError(mapBrowserError("disconnected port object"), "sendMessage(START_CAPTURE) failed");
    return;
  }
  if (response.type === "ALREADY_CAPTURING") {
    // This popup's own optimistic "Preparing…" was for a request that
    // got refused — replace it with the real in-progress capture's
    // state right away instead of leaving stale text up until the next
    // PROGRESS broadcast happens to arrive.
    const freshState = await sendCommand({ type: "GET_STATE" });
    applyUpdate(freshState?.type === "STATE" ? freshState : response);
    showError({ title: "Capture already running", body: "Wait for the current capture to finish, or cancel it, before starting another." }, "already capturing");
    return;
  }
  if (response.type === "STARTED") {
    startedSession = response.sessionId ?? null;
  }
  // Busy state is already set; PROGRESS/DONE/ERROR arrive via the onMessage
  // listener above, and PICKER_ARMED closes this window if a picker goes up.
}

primaryCta.addEventListener("click", () => {
  const mode = (checkedValue(captureModeRadios()) ?? "fullpage") as CaptureMode;
  void startCapture(mode);
});
markdownExportBtn.addEventListener("click", () => void startCapture("markdown"));

// --- Startup ---------------------------------------------------------------
async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const hostname = hostnameOf(tab?.url);

  if (!tab || !tab.id || !tab.url || !isCapturableUrl(tab.url)) {
    if (pageContextEl) pageContextEl.textContent = "Protected browser page";
    showRestricted(PROTECTED_PAGE);
    return;
  }

  if (pageContextEl) pageContextEl.textContent = hostname ?? "";

  await applyStoredPreferences();
  const state = await sendCommand({ type: "GET_STATE" });
  if (state?.type === "STATE") {
    // The reply describes the moment it was answered. If the capture it
    // describes has finished in the meantime — and the terminal message
    // arrived here first — this snapshot must not put the busy UI back.
    applyUpdate(state);
  }
  await analyzeScrollAreas(tab.id);
  updatePrimaryCtaLabel();
}

void main();
