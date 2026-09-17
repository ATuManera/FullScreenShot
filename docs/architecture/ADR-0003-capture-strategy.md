# ADR-0003: captureVisibleTab tiling, not chrome.debugger or a headless renderer

## Status

Accepted (P1)

## Context

Full-page capture needs one of: (a) repeated `captureVisibleTab()` calls
while scrolling, (b) `chrome.debugger` + the Chrome DevTools Protocol's
full-page screenshot capability, or (c) a separate headless rendering
pipeline.

## Decision

Use (a): scroll-driven, rate-limited `captureVisibleTab()` tiling,
composited by the Rust core (see ADR-0004). See ADR-0002 for why
`chrome.debugger` was rejected on permission grounds specifically; this
ADR covers the capture mechanism itself.

## Alternatives considered

- **`chrome.debugger` CDP full-page screenshot:** technically simpler
  (one call), but requires the `debugger` permission (rejected, ADR-0002)
  and ties capture correctness to an unstable/undocumented-for-extensions
  CDP surface.
- **A bundled headless rendering engine:** rejected outright — massive
  bundle size, defeats "no remote code"/minimal-footprint goals, and
  duplicates rendering work the browser already does correctly for the
  page the user is looking at.

## Consequences

- Correctness depends on precise scroll-position bookkeeping and a
  rate limiter (P1) rather than a single atomic browser-provided call.
- Fixed/sticky elements need explicit handling (ADR-0004 covers the
  compositor side; the hide/restore mechanism lives in
  `capture/injectable.ts`).
