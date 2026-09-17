// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Minimal browser abstraction layer. P1 extends this with capture
 * methods (captureVisibleTab, tabs.query, scripting.executeScript);
 * P0 only needs enough to prove the background/popup/options pages
 * load and can read the extension's own manifest.
 */
export interface BrowserAdapter {
  getManifestVersion(): string;
}

function createChromiumAdapter(): BrowserAdapter {
  return {
    getManifestVersion(): string {
      return chrome.runtime.getManifest().version;
    },
  };
}

export const browser: BrowserAdapter = createChromiumAdapter();
