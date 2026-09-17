# Security Policy

## Reporting a vulnerability

Please report security issues privately by opening a GitHub Security
Advisory at https://github.com/ATuManera/FullScreenShot/security/advisories/new
rather than a public issue. If that is unavailable, open a regular
issue asking a maintainer to provide a private contact channel.

Include: affected version, browser, reproduction steps, and impact.

## Threat model

FullScreenShot runs with browser extension privileges inside the
user's browser and processes untrusted page content (DOM, CSS, images,
URLs). Relevant threats we design against:

- Malicious page DOM/CSS crafted to break capture logic or exfiltrate
  data via the extension's own privileges.
- Huge or adversarial dimensions causing memory exhaustion (browser
  tab or WASM linear memory).
- DOM mutation during an in-progress capture.
- Untrusted URLs, `javascript:` URLs, `data:` URLs, inline SVG.
- Cross-origin iframes and canvas/WebGL content that cannot be safely
  or meaningfully captured.
- Spoofed or malformed messages between content script, background
  script, and the WASM module.
- Prototype pollution via attacker-controlled JS objects.
- Untrusted serialized data crossing the JS↔WASM boundary.

## Non-goals

FullScreenShot does not defend against a compromised browser itself,
a malicious extension store, or physical access to the user's device.

## Supported versions

Only the latest published `0.x` release line receives security fixes
during pre-1.0 development.
