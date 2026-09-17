# FullScreenShot

> Privacy-first full-page screenshot browser extension powered by Rust
> and WebAssembly. Capture visible pages, complete pages and scrollable
> regions, with local export to PNG, PDF and Markdown.

**Status: pre-alpha (P0 — Foundation).** Capture functionality is not
implemented yet; see [Roadmap](#roadmap).

## What is FullScreenShot

FullScreenShot is an open-source browser extension for Chrome, Edge,
and Safari that captures full web pages — visible viewport, entire
scrollable pages, or a specific scrollable container — and exports the
result as PNG, PDF, or semantic Markdown. Everything runs locally in
your browser: no servers, no accounts, no telemetry.

## Features (target scope)

- Capture Visible / Capture Full Page / Capture Selected Scroll Area
- Export to PNG (lossless), PDF (paginated), and Markdown (from the
  DOM, not OCR)
- Handles fractional device-pixel-ratio, browser zoom, sticky/fixed
  headers, and lazy-loaded content
- Manifest V3, minimal permissions, no `<all_urls>`, no
  `chrome.debugger`

## Architecture

```text
Chrome / Edge / Safari
        │
        ▼
Minimal WebExtension adapter (JavaScript / TypeScript)
        │
        ▼
Rust / WebAssembly Core
        (geometry, capture planning, stitching, PNG, PDF, Markdown)
```

The browser-dependent shell is intentionally small and auditable; all
non-trivial logic (geometry, tiling, compositing, encoding, Markdown
generation) lives in Rust, compiled to WebAssembly. See
`docs/architecture/` for the Architecture Decision Records behind
these choices.

## Installation

### From source (current state — no store listing yet)

```bash
git clone https://github.com/ATuManera/FullScreenShot
cd FullScreenShot
rustup target add wasm32-unknown-unknown
cargo xtask build
```

**Chrome:** open `chrome://extensions`, enable Developer mode, "Load
unpacked", select `dist/chromium/` (built by `browser/chromium/build.sh`).

**Edge:** open `edge://extensions`, enable Developer mode, "Load
unpacked", select `dist/chromium/`.

**Safari:** Safari packaging lands in a later phase (P4); see the
roadmap below.

## Privacy & Security

See `PRIVACY.md` and `SECURITY.md`. In short: 100% local processing,
no telemetry, no analytics, no cloud, no account, no remote code.

## Limitations

Pre-alpha: capture, export, and Safari support are not implemented
yet. Some internal browser pages cannot be captured by any extension
regardless of permissions (browser security restriction) — FullScreenShot
will report this clearly rather than silently fail.

## Design inspiration

FullScreenShot's functional scope was informed by studying
[mrcoles/full-page-screen-capture-chrome-extension](https://github.com/mrcoles/full-page-screen-capture-chrome-extension)
([license](https://github.com/mrcoles/full-page-screen-capture-chrome-extension/blob/master/LICENSE))
as a reference for known full-page-capture problems (DPR handling,
sticky elements, seams). FullScreenShot is an independent
implementation with a different architecture (Rust/WASM core, Manifest
V3, streaming compositor) and does not reuse its code or assets.

## Contributing

See `CONTRIBUTING.md`.

## License

Mozilla Public License 2.0, "Incompatible With Secondary Licenses".
See `LICENSE`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md`.

## Attribution

FullScreenShot — original project by **ATuManera** / **Fernando
Gallarday**. Canonical repository:
https://github.com/ATuManera/FullScreenShot. See `AUTHORS.md`,
`NOTICE.md`, and `TRADEMARKS.md`.

## Roadmap

- P1: Chrome/Edge Capture Visible + Capture Full Page → PNG
- P2: Selected Scroll Area, lazy loading, huge-page handling
- P3: PDF export, Markdown export
- P4: Safari
- P5: Security hardening, `cargo audit`/`cargo deny`
- P6: Release-candidate packaging
