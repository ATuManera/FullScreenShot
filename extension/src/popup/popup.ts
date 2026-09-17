// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";

const status = document.getElementById("status");
if (status) {
  status.textContent = `FullScreenShot v${browser.getManifestVersion()} — capture actions land in P1.`;
}
