// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../manifest.base.json", import.meta.url), "utf8"));

// Closing the result tab, opening it, and everything else this extension does
// has to stay inside these three. `tabs` would be the easy way to close a tab
// and is exactly what must not be asked for.

test("the extension asks for exactly three permissions", () => {
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
});

test("no host permissions are requested", () => {
  assert.equal(manifest.host_permissions, undefined);
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"));
});

test("none of the permissions that would make this easier are requested", () => {
  for (const tempting of ["tabs", "windows", "downloads", "debugger", "webRequest", "cookies", "history", "nativeMessaging"]) {
    assert.ok(!manifest.permissions.includes(tempting), `must not request "${tempting}"`);
  }
});
