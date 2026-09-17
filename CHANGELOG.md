# Changelog

All notable changes to FullScreenShot are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- P1: real Capture Visible and Capture Full Page in Chrome/Edge, producing
  a valid PNG — rate-limited `captureVisibleTab()` tiling, fixed/sticky
  element handling, transactional page-state restore on success/cancel/
  error, streaming Rust compositor, and a result page for viewing/
  downloading the PNG without the `downloads` permission.
- P2: Selected Scroll Area (interactive container picker + internal-scroll
  capture with viewport cropping), Reliable lazy-loading mode with
  infinite-scroll detection, and a configurable tile-count safety limit.
- P3: real paginated PDF export (A4/Letter/Auto, Portrait/Landscape) and
  real Markdown export (DOM-to-AST extraction, Article/Full DOM modes,
  YAML frontmatter, untrusted-AST sanitization) for Capture Full Page and
  Selected Scroll Area, plus a popup export-format selector.

- P0 Foundation: Rust workspace (`screenshot-core`, `screenshot-png`,
  `screenshot-pdf`, `screenshot-md`, `screenshot-wasm`) with capture
  geometry/planning, PNG encoding, PDF pagination, Markdown AST/writer,
  and a WASM bridge exposing tile planning.
- Legal and attribution documentation: `LICENSE` (MPL-2.0, Incompatible
  With Secondary Licenses), `AUTHORS.md`, `NOTICE.md`, `TRADEMARKS.md`,
  `THIRD_PARTY_NOTICES.md`, `SECURITY.md`, `PRIVACY.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
- Minimal Manifest V3 extension shell that loads in Chrome/Edge.
- Architecture Decision Records: ADR-0001, ADR-0002, ADR-0006 for
  P0-relevant decisions.
- Basic CI (GitHub Actions): fmt, clippy, tests, workspace build, WASM
  build, TypeScript typecheck.

## [0.1.0] - Unreleased

Initial foundation. Not yet functional for end-user captures (see
`docs/superpowers/specs/2026-09-17-p0-foundation-design.md` for scope).
