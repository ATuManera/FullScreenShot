// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";
import { CaptureCancelledError, captureFullPage, captureVisible, PageNotCapturableError } from "../capture/orchestrator.js";
import { bytesToDataUrl } from "./bytes.js";
import { parseInboundMessage, PORT_NAME, type CaptureMode, type OutboundMessage } from "./messages.js";

console.log(`FullScreenShot background service worker started (v${browser.getManifestVersion()})`);

function randomResultId(): string {
  return crypto.randomUUID();
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
    const result =
      mode === "visible" ? await captureVisible(tab.id) : await captureFullPage(tab.id, (status) => send({ type: "PROGRESS", status }), isCancelled);

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
