// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";
import { PORT_NAME, type OutboundMessage } from "../background/messages.js";

const status = document.getElementById("status");
const visibleBtn = document.getElementById("capture-visible") as HTMLButtonElement | null;
const fullPageBtn = document.getElementById("capture-fullpage") as HTMLButtonElement | null;
const cancelBtn = document.getElementById("cancel") as HTMLButtonElement | null;

if (status) {
  status.textContent = `FullScreenShot v${browser.getManifestVersion()} — Ready.`;
}

function setBusy(busy: boolean): void {
  if (visibleBtn) visibleBtn.disabled = busy;
  if (fullPageBtn) fullPageBtn.disabled = busy;
  if (cancelBtn) cancelBtn.hidden = !busy;
}

function startCapture(mode: "visible" | "fullpage"): void {
  setBusy(true);
  if (status) {
    status.textContent = "Preparing…";
  }

  const port = chrome.runtime.connect({ name: PORT_NAME });

  const onCancelClick = (): void => {
    port.postMessage({ type: "CANCEL" });
  };
  cancelBtn?.addEventListener("click", onCancelClick);

  port.onMessage.addListener((raw: unknown) => {
    const message = raw as OutboundMessage;
    if (message.type === "PROGRESS") {
      if (status) status.textContent = message.status;
      return;
    }
    if (message.type === "DONE") {
      if (status) status.textContent = "Done.";
      setBusy(false);
      cancelBtn?.removeEventListener("click", onCancelClick);
      port.disconnect();
      return;
    }
    if (message.type === "CANCELLED") {
      if (status) status.textContent = "Cancelled — page restored.";
      setBusy(false);
      cancelBtn?.removeEventListener("click", onCancelClick);
      port.disconnect();
      return;
    }
    if (message.type === "ERROR") {
      if (status) status.textContent = `Error: ${message.message}`;
      setBusy(false);
      cancelBtn?.removeEventListener("click", onCancelClick);
      port.disconnect();
    }
  });

  port.postMessage({ type: "START_CAPTURE", mode });
}

visibleBtn?.addEventListener("click", () => startCapture("visible"));
fullPageBtn?.addEventListener("click", () => startCapture("fullpage"));
