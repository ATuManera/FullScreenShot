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
let messageListeners;
/** Null makes the background fall through to the interactive picker. */
let soleCandidate;
let injected;
let injectedCalls;
let captureCalls;
let broadcasts;
let tabsCreated;
let persistentCommandListener;
/** Successive `scrollHeight` readings, to model a page that grows while pre-scrolling. */
let measureHeights;

function makeChromeStub() {
  injected = [];
  injectedCalls = [];
  captureCalls = 0;
  broadcasts = [];
  tabsCreated = [];
  return {
    runtime: {
      onMessage: {
        // Several listeners coexist here: the command listener registered at
        // startup, and the short-lived one a pending scroll-area selection
        // adds. Both must receive every message, as they do in the browser.
        addListener: (fn) => { messageListeners.push(fn); if (!onMessage) onMessage = fn; },
        removeListener: (fn) => { messageListeners = messageListeners.filter((l) => l !== fn); },
      },
      sendMessage: async (m) => { broadcasts.push(m); return undefined; },
      getManifest: () => ({ manifest_version: 3 }),
      getURL: (p) => `chrome-extension://stub/${p}`,
      getPlatformInfo: async () => ({ os: "mac" }),
    },
    tabs: {
      query: async () => [{ id: 7, windowId: 1, url: "https://example.test/page", title: "Page" }],
      get: async () => ({ id: 7, windowId: 1, url: "https://example.test/page", title: "Page" }),
      create: async (props) => { tabsCreated.push(props); return { id: 8 }; },
      captureVisibleTab: async () => { captureCalls += 1; throw new Error(CAPTURE_SENTINEL); },
      onRemoved: { addListener: () => {}, removeListener: () => {} },
    },
    scripting: {
      executeScript: async ({ func, args = [] }) => {
        const name = func?.name ?? "anonymous";
        injected.push(name);
        injectedCalls.push({ name, args });
        switch (name) {
          case "begin":
            return [{ result: { scrollX: 0, scrollY: 0, documentElementInlineOverflow: "", bodyInlineOverflow: "", documentElementInlineScrollBehavior: "" } }];
          case "measurePage": {
            const scrollHeight = measureHeights?.length ? measureHeights.shift() : 4000;
            return [{ result: { scrollWidth: 1200, scrollHeight, viewportWidth: 1200, viewportHeight: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 } }];
          }
          case "scrollWindowToVerified":
            return [{ result: { requestedY: args[0], actualY: args[0], maxScrollY: 3200 } }];
          case "selectSoleScrollCandidate":
            return [{ result: soleCandidate }];
          case "runSelectionPicker":
            return [{ result: 2 }];
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

function start(mode, lazyMode = "fast") {
  return new Promise((resolve) => {
    onMessage(
      { type: "START_CAPTURE", mode, exportFormat: "png", pdfPageSize: "auto", pdfOrientation: "portrait", markdownMode: "article", lazyMode },
      {},
      resolve,
    );
  });
}

const countOf = (name) => injected.filter((n) => n === name).length;

/**
 * Waits until the background has stopped issuing stubbed work for this
 * capture. The quiet window has to outlast the real pauses in the pipeline —
 * the Reliable pre-scroll's per-pass settle and the capture rate limiter —
 * or a test would hand back while a capture is still running and its calls
 * would land in the next test's recording.
 */
async function settle() {
  const QUIET_MS = 700;
  const POLL_MS = 50;
  let quiet = 0;
  for (let elapsed = 0; elapsed < 20_000; elapsed += POLL_MS) {
    const before = injected.length + captureCalls;
    await new Promise((r) => setTimeout(r, POLL_MS));
    quiet = injected.length + captureCalls === before ? quiet + POLL_MS : 0;
    if (quiet >= QUIET_MS) return;
  }
}

function resetStub() {
  messageListeners = persistentCommandListener ? [persistentCommandListener] : [];
  onMessage = persistentCommandListener;
  globalThis.chrome = makeChromeStub();
  measureHeights = null;
  soleCandidate = { attr: "data-fullscreenshot-container-id", value: "sole" };
}

/** Delivers a message the way the browser does: to every registered listener. */
function deliver(message) {
  let response;
  for (const listener of messageListeners) {
    listener(message, {}, (r) => { response = r; });
  }
  return response;
}

function getState() {
  let state;
  onMessage({ type: "GET_STATE" }, {}, (r) => { state = r; });
  return state;
}

/** The request id the page-side picker was handed, so a test can answer as it would. */
function pendingSelectionRequestId() {
  const call = injectedCalls.find((c) => c.name === "runSelectionPicker");
  return call ? call.args[1] : null;
}

async function waitForPicker() {
  for (let i = 0; i < 100; i++) {
    if (pendingSelectionRequestId()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
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
  resetStub();
  await import("../../dist/chromium/background/index.js");
  assert.ok(onMessage, "background did not register a runtime message listener");
  // The module registers its command listener once, at import. Later stubs
  // replace `chrome` but cannot re-run that registration, so keep it.
  persistentCommandListener = onMessage;
});

test("Full Page scrolls the window and never runs scroll-area location", async () => {
  resetStub();
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
  resetStub();
  await start("visible");
  await settle();

  assert.deepEqual(injected, [], "Visible Area must inject nothing into the page");
  assert.equal(captureCalls, 1);
});

test("Scroll Area locates a container and scrolls that, not the window", async () => {
  resetStub();
  await start("scrollarea");
  await settle();

  assert.ok(injected.includes("selectSoleScrollCandidate"), "expected the sole-candidate path");
  assert.ok(injected.includes("prepareContainerForCapture"), "expected the container to be brought into view");
  assert.ok(injected.includes("positionContainerBand"), "expected the container's own band positioning");
  assert.ok(!injected.includes("scrollWindowToVerified"), "Scroll Area must not drive the window scroll loop");
});

test("the capture guard is released after a failed capture, so the next one is accepted", async () => {
  resetStub();
  const ack = await start("visible");
  assert.deepEqual(ack, { type: "STARTED" }, "a previous failure must not leave the guard held");
  await settle();
});

test("a single capture at a time is refused, not queued", async () => {
  resetStub();
  const first = start("fullpage");
  const second = start("fullpage");
  assert.deepEqual(await first, { type: "STARTED" });
  assert.deepEqual(await second, { type: "ALREADY_CAPTURING" });
  await settle();
});

test("the page's scroll position is restored even when the capture fails", async () => {
  resetStub();
  await start("fullpage");
  await settle();
  assert.ok(injected.includes("restore"), "expected the transactional page-state restore to run");
  assert.ok(injected.includes("restoreFixedAndStickyElements"), "expected hidden fixed/sticky elements to be restored");
});

test("a failed scroll-area capture still releases the container it marked", async () => {
  resetStub();
  await start("scrollarea");
  await settle();
  assert.ok(injected.includes("releaseContainer"), "expected the marker attribute and scrollTop to be released");
  assert.ok(injected.includes("restore"), "expected the page scroll to be restored");
});

// --- Reliable lazy mode wiring -------------------------------------------
// The regression: the background called `captureFullPage(..., "fast", ...)`
// unconditionally, so the options-page setting was persisted, displayed, and
// then thrown away. Serialization tests alone would not have caught it — the
// value has to be observed arriving at the capture loop.

test("Fast does not pre-scroll: the page is measured once, for the plan", async () => {
  resetStub();
  await start("fullpage", "fast");
  await settle();
  assert.equal(countOf("measurePage"), 1, "Fast must measure only to build the capture plan");
});

test("Reliable pre-scrolls before capturing, re-measuring as content loads", async () => {
  resetStub();
  await start("fullpage", "reliable");
  await settle();
  assert.ok(countOf("measurePage") > 1, "Reliable must re-measure the page during pre-scroll");
});

test("Reliable measures the capture plan after the pre-scroll, not before", async () => {
  // Lazy content that only appears while pre-scrolling has to be inside the
  // height the plan is built from, or the capture stops short of it.
  resetStub();
  await start("fullpage", "reliable");
  await settle();
  const lastMeasure = injected.lastIndexOf("measurePage");
  const firstTileScroll = injected.findIndex((n, i) => n === "scrollWindowToVerified" && i > lastMeasure);
  assert.ok(firstTileScroll > lastMeasure, "the plan's measurement must come after pre-scrolling");
});

test("Reliable returns the page to the top, verified, before the first tile", async () => {
  resetStub();
  await start("fullpage", "reliable");
  await settle();
  const scrolls = injectedCalls.filter((c) => c.name === "scrollWindowToVerified");
  assert.ok(scrolls.length >= 2, "expected a pre-scroll reset plus the first tile");
  assert.equal(scrolls[0].args[0], 0, "the pre-scroll must end back at the page top");
  const lastMeasure = injected.lastIndexOf("measurePage");
  const firstTile = injectedCalls.findIndex((c, i) => c.name === "scrollWindowToVerified" && i > lastMeasure);
  assert.equal(injectedCalls[firstTile].args[0], 0, "the first captured tile must be the page top");
});

test("an unrecognised lazy mode never reaches the capture loop", async () => {
  resetStub();
  const ack = await new Promise((resolve) => {
    const handled = onMessage({ type: "START_CAPTURE", mode: "fullpage", lazyMode: "turbo" }, {}, resolve);
    if (handled === false) resolve(undefined);
  });
  assert.equal(ack, undefined, "a message with an invalid lazy mode must be ignored outright");
  await settle();
  assert.deepEqual(injected, [], "no capture may start from a rejected message");
});

// --- Fixed-element band policy -------------------------------------------

test("each tile declares which anchored elements belong in its band", async () => {
  resetStub();
  await start("fullpage");
  await settle();
  const modes = injectedCalls.filter((c) => c.name === "applyFixedElementVisibility").map((c) => c.args[0]);
  assert.equal(modes[0], "show-top", "the first retained band is where a header belongs");
  assert.ok(modes.length >= 1);
});

test("hidden fixed elements are restored after every tile, not only later ones", async () => {
  resetStub();
  await start("fullpage");
  await settle();
  assert.ok(countOf("restoreFixedAndStickyElements") >= 1, "expected fixed/sticky restoration");
});

test("Reliable keeps pre-scrolling while the page is still growing", async () => {
  // Consulting the wrong predicate made this stop after two passes no matter
  // how much content was still arriving, so lazy sections past the second
  // trip to the bottom never made it into the capture plan.
  resetStub();
  measureHeights = [3000, 3600, 4200, 4800, 4800, 4800, 4800, 4800, 4800];
  await start("fullpage", "reliable");
  await settle();
  assert.ok(countOf("measurePage") > 3, `expected pre-scrolling to continue while growing, saw ${countOf("measurePage")} measurements`);
});

test("Reliable stops a page that never stops growing, instead of scrolling forever", async () => {
  resetStub();
  measureHeights = Array.from({ length: 40 }, (_, i) => 3000 + i * 600);
  await start("fullpage", "reliable");
  await settle();
  const failure = broadcasts.find((m) => m.type === "ERROR");
  assert.ok(failure, "expected the capture to end with an error");
  assert.match(failure.message, /infinite scroll/i);
  assert.equal(captureCalls, 0, "no tile should be captured from a page that never settles");
});

// --- Scroll-area selection reaches a terminal state on the user's action ---
// The physical failure: Escape removed the picker from the page, but the
// extension kept reporting a capture in progress, and only settled after a
// delay — so reopening it showed a stale waiting state instead of a ready one.

test("Escape ends the selection as a cancellation, not as a failure", async () => {
  resetStub();
  soleCandidate = null;
  await start("scrollarea");
  assert.ok(await waitForPicker(), "expected the interactive picker to be injected");

  deliver({ type: "SCROLL_AREA_SELECTION", requestId: pendingSelectionRequestId(), status: "cancelled" });
  await settle();

  assert.ok(broadcasts.some((m) => m.type === "CANCELLED"), "backing out must read as a cancellation");
  assert.ok(
    !broadcasts.some((m) => m.type === "NO_CONTAINER_SELECTED"),
    "choosing not to pick is not the same as there being nothing to pick",
  );
});

test("the page is told its terminal outcome was received, so it stops retrying", async () => {
  resetStub();
  soleCandidate = null;
  await start("scrollarea");
  await waitForPicker();

  const ack = deliver({ type: "SCROLL_AREA_SELECTION", requestId: pendingSelectionRequestId(), status: "cancelled" });
  assert.deepEqual(ack, { received: true });
  await settle();
});

test("state is idle the moment a cancellation is acknowledged", async () => {
  resetStub();
  soleCandidate = null;
  await start("scrollarea");
  await waitForPicker();
  assert.equal(getState().active, true, "a pending selection is an active capture");

  deliver({ type: "SCROLL_AREA_SELECTION", requestId: pendingSelectionRequestId(), status: "cancelled" });
  await settle();

  assert.equal(getState().active, false, "reopening must not find a capture still running");
});

test("a cancelled selection releases the capture guard immediately", async () => {
  resetStub();
  soleCandidate = null;
  await start("scrollarea");
  await waitForPicker();
  deliver({ type: "SCROLL_AREA_SELECTION", requestId: pendingSelectionRequestId(), status: "cancelled" });
  await settle();

  const ack = await start("visible");
  assert.deepEqual(ack, { type: "STARTED" }, "the next capture must not be refused");
  await settle();
});

test("cancelling produces no result and opens no result page", async () => {
  resetStub();
  soleCandidate = null;
  await start("scrollarea");
  await waitForPicker();
  deliver({ type: "SCROLL_AREA_SELECTION", requestId: pendingSelectionRequestId(), status: "cancelled" });
  await settle();

  assert.deepEqual(tabsCreated, [], "a cancelled capture has nothing to show");
  assert.ok(!broadcasts.some((m) => m.type === "DONE"));
});

test("cancellation does not wait on the watchdog", async () => {
  // The watchdog is minutes away; if it were doing the work here, this test
  // could not finish.
  resetStub();
  soleCandidate = null;
  await start("scrollarea");
  await waitForPicker();

  const startedAt = Date.now();
  deliver({ type: "SCROLL_AREA_SELECTION", requestId: pendingSelectionRequestId(), status: "cancelled" });
  for (let i = 0; i < 200 && getState().active; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(getState().active, false);
  assert.ok(Date.now() - startedAt < 1000, `settled in ${Date.now() - startedAt}ms, which is not event-driven`);
  await settle();
});

test("a page with nothing to pick is reported as such, not as a cancellation", async () => {
  resetStub();
  soleCandidate = null;
  // The picker reports it found no candidates at all.
  await start("scrollarea");
  await waitForPicker();
  deliver({ type: "SCROLL_AREA_SELECTION", requestId: pendingSelectionRequestId(), status: "no-candidates" });
  await settle();

  assert.ok(broadcasts.some((m) => m.type === "NO_CONTAINER_SELECTED"));
  assert.ok(!broadcasts.some((m) => m.type === "CANCELLED"));
});

test("a message from an earlier selection cannot cancel the current one", async () => {
  resetStub();
  soleCandidate = null;
  await start("scrollarea");
  await waitForPicker();

  const ack = deliver({ type: "SCROLL_AREA_SELECTION", requestId: "a-previous-selection", status: "cancelled" });
  assert.equal(ack, undefined, "an unrelated message must not be acknowledged");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(getState().active, true, "the live selection must survive a stale message");

  deliver({ type: "SCROLL_AREA_SELECTION", requestId: pendingSelectionRequestId(), status: "cancelled" });
  await settle();
  assert.equal(getState().active, false);
});

test("while waiting for a choice, state says so rather than something stale", async () => {
  // What a reopened popup reconstructs from. It used to still read
  // "Locating scroll area…" because the prompt went out as a bare broadcast.
  resetStub();
  soleCandidate = null;
  await start("scrollarea");
  await waitForPicker();

  const state = getState();
  assert.equal(state.active, true);
  assert.match(state.progress.text, /choose a scroll area/i);
  deliver({ type: "SCROLL_AREA_SELECTION", requestId: pendingSelectionRequestId(), status: "cancelled" });
  await settle();
});

test("a selection that picks a container still captures it", async () => {
  resetStub();
  soleCandidate = null;
  await start("scrollarea");
  await waitForPicker();
  deliver({
    type: "SCROLL_AREA_SELECTION",
    requestId: pendingSelectionRequestId(),
    status: "selected",
    attr: "data-fullscreenshot-container-id",
    value: "1",
  });
  await settle();

  assert.ok(injected.includes("prepareContainerForCapture"), "expected the chosen container to be captured");
  assert.ok(!broadcasts.some((m) => m.type === "CANCELLED"));
});
