# UX Physical Acceptance Checklist

For Fernando Gallarday to run on his Mac, in real Chrome, before any
publication decision. Nothing in this checklist has been performed by
the agent that implemented UX-P1–UX-P4 — Node/TypeScript tests and
static inspection cannot substitute for a real browser session (see
`docs/UX_PREMIUM_POLISH.md` and the branch's final report for exactly
what *was* verified).

## Setup

1. `cargo xtask build`
2. `cargo xtask package chromium`
3. Chrome → `chrome://extensions` → enable Developer mode → "Load
   unpacked" → select `dist/chromium/`.

Check each item below. For anything that fails, note the Chrome
version, macOS version, and what you saw (a screenshot helps) so it can
be fixed before the next pass.

## Checklist

- [ ] 1. Chrome regular website (e.g. a news site or Wikipedia) — popup
      opens, shows the site's hostname, capture controls enabled.
- [ ] 2. Chrome Web Store page or another protected page
      (`chrome://extensions`, `chrome-extension://…`) — popup shows
      "Capture unavailable on this page" with no raw error text
      anywhere, capture controls disabled/hidden.
- [ ] 3. A page with zero internal scroll areas — "Scroll area" card is
      not shown at all.
- [ ] 4. A page with exactly one internal scroll container (e.g. a
      chat widget, a single scrollable table) — "Scroll area" card
      shows "1 scrollable region detected"; selecting it and pressing
      the primary button captures that region directly, with **no**
      on-page picker/overlay appearing.
- [ ] 5. A page with multiple internal scroll containers (e.g. a
      dashboard with several scrollable panels) — card shows "N
      scrollable regions detected"; the primary button becomes "Choose
      scroll area" and opens the interactive picker on the page.
- [ ] 6. Full Page → PNG — produces a correct, complete full-page PNG.
- [ ] 7. Visible area → PNG — produces a correct viewport-only PNG.
- [ ] 8. Scroll area → PNG — produces a PNG of just that container's
      content, not the surrounding page.
- [ ] 9. PDF export (try Auto, A4, and Letter page sizes) — valid,
      correctly paginated PDF.
- [ ] 10. Markdown export, Article mode — readable, correctly
      structured Markdown.
- [ ] 11. Markdown export, Full DOM mode — more structure preserved
      than Article mode.
- [ ] 12. A page with a sticky header — header is not duplicated
      across the stitched full-page result.
- [ ] 13. A page with a fixed footer — footer handled correctly (not
      duplicated/not corrupting the capture).
- [ ] 14. A page with lazy-loaded images, using Reliable mode
      (Settings → Full-page loading → Reliable) — lazy content is
      actually captured.
- [ ] 15. Cancel a capture partway through — page scroll position and
      any hidden elements are fully restored; no corrupt/partial
      download appears.
- [ ] 16. Start a capture, close the popup, reopen it mid-capture —
      popup reconstructs the correct busy/progress state instead of
      looking idle or starting a second capture.
- [ ] 17. Chrome zoom 80% — popup and capture output remain correct.
- [ ] 18. Chrome zoom 100% — baseline.
- [ ] 19. Chrome zoom 125% — popup and capture output remain correct.
- [ ] 20. Chrome zoom 150% — popup and capture output remain correct.
- [ ] 21. macOS light mode — popup/options/result pages use the light
      palette correctly, all text legible.
- [ ] 22. macOS dark mode — same pages switch to the dark palette
      correctly, all text legible, no unstyled/white flashes.
- [ ] 23. Keyboard-only navigation — Tab through the popup reaches
      every control in a logical order; capture-mode cards and
      segmented controls are operable with arrow keys/Space; a visible
      focus ring is always present; Escape cancels the on-page
      scroll-area picker.
- [ ] 24. Icon appearance at real toolbar size — recognizable, not a
      blurry smear, not a letter "F".
- [ ] 25. About screen shows FullScreenShot, ATuManera, Fernando
      Gallarday, the repository link, the version number, and the
      license identifier.
- [ ] 26. No raw browser/engineering errors surfaced anywhere in the
      popup during normal use (deliberately try triggering one, e.g.
      by capturing a protected page).
- [ ] 27. The on-page scroll-area selector overlay never appears
      inside an actual captured image (check items 8 and 5 closely —
      the overlay/outline must be gone before the screenshot is taken).

## Sign-off

This checklist may only be marked complete by Fernando Gallarday after
physically running it. No automated report may claim "PASS" on any of
these 27 items.
