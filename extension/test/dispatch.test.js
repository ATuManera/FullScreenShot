// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Loads the real background service worker under a stubbed `chrome` and
 * records which injected functions each capture mode actually runs, so a mode
 * silently taking another mode's path — Full Page wandering into scroll-area
 * location, or Visible Area starting to scroll the page — fails here rather
 * than in a physical test. The stubs stop each capture at
 * `captureVisibleTab`, which is as far as this needs to go: everything that
 * distinguishes the three paths has already happened by then.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CAPTURE_SENTINEL = "stub: capture reached captureVisibleTab";

let onMessage;
let injected;
let captureCalls;

function makeChromeStub() {
  injected = [];
  captureCalls = 0;
  return {
    runtime: {
      onMessage: {
        addListener: (fn) => { if (!onMessage) onMessage = fn; },
        removeListener: () => {},
      },
      sendMessage: async () => undefined,
      getManifest: () => ({ manifest_version: 3 }),
      getURL: (p) => `chrome-extension://stub/${p}`,
      getPlatformInfo: async () => ({ os: "mac" }),
    },
    tabs: {
      query: async () => [{ id: 7, windowId: 1, url: "https://example.test/page", title: "Page" }],
      get: async () => ({ id: 7, windowId: 1, url: "https://example.test/page", title: "Page" }),
      create: async () => ({ id: 8 }),
      captureVisibleTab: async () => { captureCalls += 1; throw new Error(CAPTURE_SENTINEL); },
      onRemoved: { addListener: () => {}, removeListener: () => {} },
    },
    scripting: {
      executeScript: async ({ func, args = [] }) => {
        const name = func?.name ?? "anonymous";
        injected.push(name);
        switch (name) {
          case "begin":
            return [{ result: { scrollX: 0, scrollY: 0, documentElementInlineOverflow: "", bodyInlineOverflow: "", documentElementInlineScrollBehavior: "" } }];
          case "measurePage":
            return [{ result: { scrollWidth: 1200, scrollHeight: 4000, viewportWidth: 1200, viewportHeight: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 } }];
          case "scrollWindowToVerified":
            return [{ result: { requestedY: args[0], actualY: args[0], maxScrollY: 3200 } }];
          case "selectSoleScrollCandidate":
            return [{ result: { attr: "data-fullscreenshot-container-id", value: "sole" } }];
          case "prepareContainerForCapture":
            return [{ result: { scrollHeight: 2000, clientWidth: 600, clientHeight: 400, originalScrollTop: 0, pageScrollX: 0, pageScrollY: 0, cropX: 10, cropY: 20, cropWidth: 600, visibleHeight: 400, devicePixelRatio: 1 } }];
          case "positionContainerBand":
            return [{ result: { requestedOffset: args[2], achievedOffset: args[2], maxContentOffset: 1600, cropX: 10, cropY: 20, availableHeight: 400 } }];
          default:
            return [{ result: 0 }];
        }
      },
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } },
  };
}

function start(mode) {
  return new Promise((resolve) => {
    onMessage(
      { type: "START_CAPTURE", mode, exportFormat: "png", pdfPageSize: "auto", pdfOrientation: "portrait", markdownMode: "article" },
      {},
      resolve,
    );
  });
}

/** Waits until the background has stopped issuing stubbed work for this capture. */
async function settle() {
  for (let i = 0; i < 60; i++) {
    const before = injected.length + captureCalls;
    await new Promise((r) => setTimeout(r, 15));
    if (injected.length + captureCalls === before) return;
  }
}

before(async () => {
  // The WASM core is loaded through `fetch` of a file: URL, which Node's fetch
  // does not serve — read it from disk instead so the real Rust planner runs.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.href ?? input?.url;
    if (typeof url === "string" && url.startsWith("file:")) {
      return new Response(await readFile(fileURLToPath(url)), { headers: { "content-type": "application/wasm" } });
    }
    return realFetch(input, init);
  };
  globalThis.chrome = makeChromeStub();
  await import("../../dist/chromium/background/index.js");
  assert.ok(onMessage, "background did not register a runtime message listener");
});

test("Full Page scrolls the window and never runs scroll-area location", async () => {
  globalThis.chrome = makeChromeStub();
  const ack = await start("fullpage");
  assert.deepEqual(ack, { type: "STARTED" });
  await settle();

  assert.ok(injected.includes("measurePage"), "expected the page to be measured");
  assert.ok(injected.includes("scrollWindowToVerified"), "expected a verified window scroll");
  assert.ok(!injected.includes("selectSoleScrollCandidate"), "Full Page must not look for a scroll area");
  assert.ok(!injected.includes("positionContainerBand"), "Full Page must not scroll a container");
  assert.equal(captureCalls, 1, "capture should stop at the first failing screenshot");
});

test("Visible Area captures without touching the page's scroll position", async () => {
  globalThis.chrome = makeChromeStub();
  await start("visible");
  await settle();

  assert.deepEqual(injected, [], "Visible Area must inject nothing into the page");
  assert.equal(captureCalls, 1);
});

test("Scroll Area locates a container and scrolls that, not the window", async () => {
  globalThis.chrome = makeChromeStub();
  await start("scrollarea");
  await settle();

  assert.ok(injected.includes("selectSoleScrollCandidate"), "expected the sole-candidate path");
  assert.ok(injected.includes("prepareContainerForCapture"), "expected the container to be brought into view");
  assert.ok(injected.includes("positionContainerBand"), "expected the container's own band positioning");
  assert.ok(!injected.includes("scrollWindowToVerified"), "Scroll Area must not drive the window scroll loop");
});

test("the capture guard is released after a failed capture, so the next one is accepted", async () => {
  globalThis.chrome = makeChromeStub();
  const ack = await start("visible");
  assert.deepEqual(ack, { type: "STARTED" }, "a previous failure must not leave the guard held");
  await settle();
});

test("a single capture at a time is refused, not queued", async () => {
  globalThis.chrome = makeChromeStub();
  const first = start("fullpage");
  const second = start("fullpage");
  assert.deepEqual(await first, { type: "STARTED" });
  assert.deepEqual(await second, { type: "ALREADY_CAPTURING" });
  await settle();
});

test("the page's scroll position is restored even when the capture fails", async () => {
  globalThis.chrome = makeChromeStub();
  await start("fullpage");
  await settle();
  assert.ok(injected.includes("restore"), "expected the transactional page-state restore to run");
  assert.ok(injected.includes("restoreFixedAndStickyElements"), "expected hidden fixed/sticky elements to be restored");
});

test("a failed scroll-area capture still releases the container it marked", async () => {
  globalThis.chrome = makeChromeStub();
  await start("scrollarea");
  await settle();
  assert.ok(injected.includes("releaseContainer"), "expected the marker attribute and scrollTop to be released");
  assert.ok(injected.includes("restore"), "expected the page scroll to be restored");
});
