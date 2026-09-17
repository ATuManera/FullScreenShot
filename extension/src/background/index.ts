// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";
import { CaptureCancelledError, captureFullPage, captureScrollArea, captureVisible, PageNotCapturableError } from "../capture/orchestrator.js";
import { enterSelectionMode, type ContainerSelector } from "../capture/selection.js";
import { bytesToDataUrl } from "./bytes.js";
import { parseInboundMessage, PORT_NAME, type CaptureMode, type OutboundMessage } from "./messages.js";

console.log(`FullScreenShot background service worker started (v${browser.getManifestVersion()})`);

function randomResultId(): string {
  return crypto.randomUUID();
}

async function resolveResult(
  mode: CaptureMode,
  tabId: number,
  send: (message: OutboundMessage) => void,
  isCancelled: () => boolean,
): Promise<Awaited<ReturnType<typeof captureVisible>> | null> {
  if (mode === "visible") {
    return captureVisible(tabId);
  }
  if (mode === "fullpage") {
    return captureFullPage(tabId, (status) => send({ type: "PROGRESS", status }), isCancelled);
  }

  send({ type: "PROGRESS", status: "Click a scrollable area on the page (Esc to cancel)…" });
  const [{ result: selector }] = (await chrome.scripting.executeScript({
    target: { tabId },
    func: enterSelectionMode,
  })) as unknown as [{ result: ContainerSelector | null }];

  if (!selector) {
    send({ type: "NO_CONTAINER_SELECTED" });
    return null;
  }

  return captureScrollArea(tabId, selector, (status) => send({ type: "PROGRESS", status }), isCancelled);
}

async function runCapture(mode: CaptureMode, port: chrome.runtime.Port, isCancelled: () => boolean): Promise<void> {
  const send = (message: OutboundMessage): void => {
    try {
      port.postMessage(message);
    } catch {
      // Port closed (popup dismissed) — the capture keeps running so the
      // result is still stored, just not reported live.
    }
  };

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) {
      send({ type: "ERROR", message: "No active tab to capture." });
      return;
    }

    send({ type: "PROGRESS", status: "Preparing…" });
    const result = await resolveResult(mode, tab.id, send, isCancelled);
    if (!result) {
      return;
    }

    send({ type: "PROGRESS", status: "Exporting…" });
    const resultId = randomResultId();
    const dataUrl = bytesToDataUrl(result.pngBytes, "image/png");
    await chrome.storage.session.set({ [resultId]: dataUrl });

    await chrome.tabs.create({ url: chrome.runtime.getURL(`result/result.html?id=${encodeURIComponent(resultId)}`) });

    send({ type: "DONE", resultId, width: result.width, height: result.height });
  } catch (e) {
    if (e instanceof CaptureCancelledError) {
      send({ type: "CANCELLED" });
      return;
    }
    if (e instanceof PageNotCapturableError) {
      send({ type: "ERROR", message: e.message });
      return;
    }
    send({ type: "ERROR", message: e instanceof Error ? e.message : String(e) });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) {
    return;
  }

  let cancelled = false;

  port.onMessage.addListener((raw: unknown) => {
    const message = parseInboundMessage(raw);
    if (!message) {
      return;
    }
    if (message.type === "CANCEL") {
      cancelled = true;
      return;
    }
    void runCapture(message.mode, port, () => cancelled);
  });
});
