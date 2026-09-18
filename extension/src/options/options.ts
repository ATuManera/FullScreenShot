// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";
import { loadPreferences, savePreferences } from "../popup/preferences.js";

const versionLine = document.getElementById("version-line");
if (versionLine) {
  versionLine.textContent = `Version ${browser.getManifestVersion()}`;
}

const lazyModeRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="lazy-mode"]'));
const lazyModeHint = document.getElementById("lazy-mode-hint") as HTMLParagraphElement | null;

function updateHint(): void {
  if (!lazyModeHint) return;
  const value = lazyModeRadios.find((r) => r.checked)?.value;
  lazyModeHint.textContent = value === "reliable" ? "Reliable: load lazy content before capture." : "Fast: capture immediately.";
}

async function init(): Promise<void> {
  const prefs = await loadPreferences();
  for (const r of lazyModeRadios) {
    r.checked = r.value === prefs.lazyMode;
  }
  updateHint();
}

for (const r of lazyModeRadios) {
  r.addEventListener("change", () => {
    updateHint();
    const value = lazyModeRadios.find((radio) => radio.checked)?.value;
    if (value === "fast" || value === "reliable") {
      void savePreferences({ lazyMode: value });
    }
  });
}

// Jump to the section named by the URL fragment (popup footer links to
// options.html#settings / #about) — browsers do this automatically for
// same-document anchors, but the page is loaded fresh each time from the
// popup, so a fresh navigation with a fragment is what actually happens
// and needs no extra JS. Kept only as a defensive fallback.
if (window.location.hash) {
  document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
}

void init();
