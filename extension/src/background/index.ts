// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";

// P0: background service worker exists and starts cleanly. Capture
// message handling is added in P1 alongside real capture logic.
console.log(`FullScreenShot background service worker started (v${browser.getManifestVersion()})`);
