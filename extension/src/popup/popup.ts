// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";
import { PORT_NAME, type CaptureMode, type OutboundMessage } from "../background/messages.js";

const status = document.getElementById("status");
const visibleBtn = document.getElementById("capture-visible") as HTMLButtonElement | null;
const fullPageBtn = document.getElementById("capture-fullpage") as HTMLButtonElement | null;
const scrollAreaBtn = document.getElementById("capture-scrollarea") as HTMLButtonElement | null;
const cancelBtn = document.getElementById("cancel") as HTMLButtonElement | null;

if (status) {
  status.textContent = `FullScreenShot v${browser.getManifestVersion()} — Ready.`;
}

function setBusy(busy: boolean): void {
  if (visibleBtn) visibleBtn.disabled = busy;
  if (fullPageBtn) fullPageBtn.disabled = busy;
  if (scrollAreaBtn) scrollAreaBtn.disabled = busy;
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

  port.postMessage({ type: "START_CAPTURE", mode });
}

visibleBtn?.addEventListener("click", () => startCapture("visible"));
fullPageBtn?.addEventListener("click", () => startCapture("fullpage"));
scrollAreaBtn?.addEventListener("click", () => startCapture("scrollarea"));
