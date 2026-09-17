// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";

const versionEl = document.getElementById("version");
if (versionEl) {
  versionEl.textContent = browser.getManifestVersion();
}
