# Safari packaging

This directory holds Safari-specific packaging for FullScreenShot. Per
the project's own rule (prompt section 7), this document keeps four
distinct concerns separate: **technical compatibility**, **packaging**,
**code signing**, and **App Store submission**. Do not conflate them —
"it converts" does not mean "it's signed", and "it's signed" does not
mean "it's submitted".

## Current status (verified 2026-09-17, this environment)

This build environment has macOS with only the **Command Line Tools**
installed (`xcode-select -p` → `/Library/Developer/CommandLineTools`).
`xcodebuild -version` fails, explicitly requiring full Xcode.
`xcrun safari-web-extension-converter` — the tool that turns a standard
web extension into a Safari App Extension Xcode project — ships only
with full Xcode.app, and is confirmed absent here (`xcrun: error:
unable to find utility "safari-web-extension-converter"`).

Given that, here is exactly what is and isn't done for P4:

| Concern | Status |
|---|---|
| Technical compatibility analysis | Done (below) — best-effort, based on public Apple/WebKit documentation, **not** verified against a real Safari runtime |
| Packaging (Xcode project generation) | Script prepared (`convert.sh`), **not run** — requires full Xcode |
| Code signing | Not attempted — requires an Apple Developer certificate/team, out of scope for any automated environment |
| App Store submission | Not attempted — requires signing first, plus App Store Connect credentials |

## Technical compatibility analysis

FullScreenShot's extension code (`extension/src/`) uses only standard
WebExtension APIs, already scoped to the minimal permission set
(`activeTab`, `scripting`, `storage` — see ADR-0002). Safari has
supported Manifest V3 web extensions, including non-persistent
background service workers, since Safari 16.4. Based on Apple's public
WebExtensions documentation:

**Very likely compatible, unchanged:**
- `manifest_version: 3`, `action`, `options_page`, the `activeTab` /
  `scripting` / `storage` permissions.
- `chrome.tabs.query`, `chrome.tabs.get`, `chrome.tabs.captureVisibleTab`,
  `chrome.scripting.executeScript` (including the `func:` self-contained
  injection pattern used throughout `capture/injectable.ts`,
  `capture/selection.ts`, `capture/markdown.ts`).
- `chrome.runtime.connect`/`onConnect` port messaging (background ↔
  popup), `chrome.storage.local`/`chrome.storage.session`.
- Plain DOM APIs used by the pure `capture/geometry.ts`, `sticky.ts`,
  `state.ts` modules — these have no Safari-specific concerns at all
  since they only touch standard web-platform DOM APIs, already
  verified against a real Chromium via Playwright (see the P1–P3 specs)
  and not chrome-specific.

**Unverified — real risk, flagged rather than assumed away:**
- `OffscreenCanvas` + `createImageBitmap` inside the background service
  worker (`capture/orchestrator.ts`'s tile decode/crop path). Safari's
  OffscreenCanvas support inside an extension's *service worker*
  context specifically (as opposed to a page context) is less
  established than Chromium's; this needs to be checked against a real
  Safari Technology Preview or Safari 17+ install.
- The CSP directive `'wasm-unsafe-eval'` in `manifest.base.json` is a
  Chromium-specific CSP keyword for permitting WebAssembly
  instantiation under a strict `script-src`. WebKit's CSP parser may
  not recognize this keyword the same way; if not, the WASM module
  (`wasm-pack`'s `screenshot_wasm.js` + `.wasm`) may need a different
  (or no) CSP adjustment under Safari. This must be checked once a
  packaged build can actually be loaded in Safari.
- `chrome.storage.session` (used to hand the composed PNG/PDF/Markdown
  bytes to the result page) is a newer addition to the storage API;
  Safari's version support for it specifically (vs. `storage.local`)
  is unconfirmed here.

None of the above are known incompatibilities — they are simply items
this environment cannot verify without a real Safari runtime, which is
also unavailable here (no way to launch and drive Safari the way
Playwright drives Chromium in this session). A developer with a full
Xcode + Safari install should treat these three items as the first
things to check once `dist/safari/` loads.

## Packaging (prepared, not run)

`convert.sh` wraps the exact `xcrun safari-web-extension-converter`
invocation Apple documents for converting an existing web extension.
Run it on a machine with full Xcode installed:

```bash
./browser/safari/convert.sh
```

It converts `dist/chromium/` (built by `cargo xtask build`) into an
Xcode project under `browser/safari/build/`. From there, open the
generated `.xcodeproj` in Xcode to build, run in Simulator/on-device,
sign, and eventually submit — those remaining steps need Xcode's GUI
and an Apple Developer account, and are intentionally not scripted
here.

## Code signing and App Store submission

Not attempted, and this project does not attempt to automate them.
Both require an Apple Developer Program membership, a real signing
identity/provisioning profile, and (for submission) App Store Connect
access — credentials this environment does not have and should not be
asked to have. Section 6 ("RELEASE CANDIDATE") of the project's roadmap
explicitly defers store publication past P6.
