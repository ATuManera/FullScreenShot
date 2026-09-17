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
- P4: Safari packaging preparation — compatibility analysis, a
  `safari-web-extension-converter` wrapper script, `cargo xtask package
  chromium|safari`, and a version-consistency check across Cargo.toml/
  manifest/package.json.
- P5: security hardening — `cargo audit`/`cargo deny` in CI and
  `cargo xtask test` (0 vulnerabilities, all licenses allow-listed), a
  hostile-content DOM fixture verified in a real browser, and hostile/
  fuzzed runtime-message tests including a prototype-pollution check.
- P6: release-candidate packaging (`dist/chromium/`,
  `artifacts/fullscreen-shot-chromium-0.1.0.zip`), explicit DPR 1.5/
  1.75/2.0 (Retina) compositor test coverage, and a systematic pass
  through every MVP acceptance criterion in the project brief.

### Known gaps (tracked, not silently ignored)

- No persistent `@playwright/test` suite runnable via `npm test`/CI yet
  — browser verification so far was done interactively (real
  assertions, not manual screenshot inspection) and is documented in
  the P1/P2/P3/P5 design specs, but isn't yet a committed, repeatable
  test suite. See the P6 spec for why this wasn't attempted blind in
  this particular environment.
- Safari packaging is prepared (compatibility analysis, conversion
  script) but not run — this environment has no full Xcode install.

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
