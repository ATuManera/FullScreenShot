# ADR-0002: Minimal Manifest V3 permissions, no `chrome.debugger`

## Status

Accepted (P0)

## Context

FullScreenShot is a privacy-first extension. Browser permissions are
the primary trust signal users and store reviewers see. Some
implementations of full-page capture (including some historical
extensions) use `chrome.debugger` to script arbitrary page behavior,
or request `<all_urls>` broadly, to sidestep the limitations of
`captureVisibleTab()`.

## Decision

Use Manifest V3 exclusively. Start with the minimal permission set:
`activeTab`, `scripting`, `storage`. Do not request `<all_urls>`,
`debugger`, `webRequest`, `nativeMessaging`, `history`, or `cookies`
unless a specific, documented technical requirement in a later phase
proves no narrower permission suffices — and if so, that requirement
and the rejected narrower alternatives must be recorded in a new ADR
before the permission is added.

Full-page capture is implemented via repeated `captureVisibleTab()`
calls driven by content-script-controlled scrolling, not via
`chrome.debugger`.

## Alternatives considered

- **`chrome.debugger` for full-page capture:** rejected — grants far
  broader capability than screenshot capture needs (arbitrary CDP
  access), is a strong negative signal in store review and to
  privacy-conscious users, and is unnecessary given
  `captureVisibleTab()` plus scroll-driven tiling achieves the same
  result.
- **`<all_urls>` host permission upfront:** rejected — `activeTab`
  already grants per-invocation access to the page the user explicitly
  triggers the extension on, which matches FullScreenShot's UX (user
  clicks the extension to capture the current tab) without a
  standing, always-on broad host permission.

## Consequences

- Full-page capture must handle `captureVisibleTab()` rate limits
  itself (see the P1 rate limiter design).
- Some browser-internal or store-protected pages will not be
  capturable; the extension must detect and report this clearly (see
  spec section on browser limitations) rather than request elevated
  permissions to work around it.
