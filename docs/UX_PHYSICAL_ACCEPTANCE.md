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

## Regression checks — capture runtime repair (`fix/ux-capture-runtime-regression`)

Added after the first physical pass found all three capture paths
broken with "Uncaught Error: Attempting to use a disconnected port
object" (popup messaging moved from a long-lived
`chrome.runtime.connect` port to `chrome.runtime.sendMessage` /
`chrome.runtime.onMessage`) and results occasionally showing "no
longer available" (result payloads moved from `chrome.storage.session`
+ base64 to an IndexedDB-backed store, no longer deleted on read).

- [ ] 28. Capture Visible area, Full page, and a Scroll area **each at
      least twice in a row**, in the same popup session, without
      reloading the extension — confirms no stale-connection error
      reappears on a second or third capture.
- [ ] 29. Open the popup, wait at least 30 seconds without clicking
      anything (long enough for the service worker to plausibly go
      idle), then start a capture — must start normally, not throw a
      raw connection error.
- [ ] 30. After a capture finishes and its result tab opens, **reload
      that result tab** (Cmd+R) — the preview and Download button must
      still work identically, not show "no longer available".
- [ ] 31. Leave a finished result tab open and idle for a few minutes,
      then try Download — must still work (results are not deleted
      merely by having been viewed once).
- [ ] 32. Start a capture, close the popup immediately, reopen it —
      progress/busy state must reconstruct correctly (not idle, not a
      duplicate capture started).
- [ ] 33. Cancel a capture, then immediately start a new one — the new
      capture must be accepted, not rejected as "already capturing".

## Final Chrome UX polish (`polish/final-chrome-ux`)

Covers the 16px icon optical adjustment, the redesigned Result Page,
and the popup progress-state cleanup. As with every section above,
nothing here has been performed by the agent — Node/TypeScript tests
and static inspection (see the branch's final report for exactly what
*was* verified that way) cannot substitute for a real browser session.

**Icon**

- [ ] 34. Toolbar icon at real 16×16 size — camera recognition remains
      strong (this was not touched), and the page tab peeking from
      behind it is now perceptibly clearer than the previous build,
      without the icon reading as a printer, scanner, floppy/save
      icon, or badge.

**Result Page**

- [ ] 35. After any capture, the result tab shows the exact generated
      filename prominently (long names wrap or ellipsize without
      breaking the layout; hovering shows the full name via the title
      tooltip).
- [ ] 36. PNG result shows "PNG · <width> × <height>" matching the
      actual captured image dimensions.
- [ ] 37. PDF result shows the correct page size and orientation you
      picked (Auto/A4/Letter, Portrait/Landscape).
- [ ] 38. Markdown result shows just "Markdown" (no fabricated
      dimensions).
- [ ] 39. Before clicking Download: status reads "Capture complete",
      the note "Chrome will use your configured download location" is
      visible, and the TTL note "available for up to 15 minutes" is
      visible — no specific filesystem path is ever shown anywhere.
- [ ] 40. Click Download: status changes to "Download started" (never
      "Downloaded successfully" or similar), the button becomes
      "Download again", and a "Close" button appears.
- [ ] 41. Click "Download again" — triggers a second, correct download
      of the same file (browser's normal duplicate-filename handling
      is fine).
- [ ] 42. Click "Close" — the result tab closes. If it does *not*
      close in your Chrome, confirm the fallback text "You can close
      this tab when you're done." appears instead of a dead button.
- [ ] 43. Reload the result tab (Cmd+R) *before* the 15-minute TTL —
      the same result, filename, and metadata reappear correctly
      (confirms this pass didn't regress the existing IndexedDB
      persistence).
- [ ] 44. Open a result URL whose id is expired or unknown (e.g. wait
      out the TTL, or hand-edit the `id` query param) — shows "Result
      expired" / "This temporary capture is no longer available." with
      **no** Download button present anywhere.
- [ ] 45. Preview: a very tall full-page PNG scrolls with the page
      itself (not trapped in a small internal scrollbox), and is not
      stretched/distorted.
- [ ] 46. Result Page keyboard-only: Tab reaches Download, Download
      again, and Close in a logical order, each with a visible focus
      ring; status changes are announced (screen reader/VoiceOver, if
      available).
- [ ] 47. Result Page in macOS light mode and dark mode — filename,
      status, and buttons all stay legible with no hard-coded white
      surface glaring in dark mode.

**Popup**

- [ ] 48. Idle popup (just opened, nothing started) — no progress bar,
      no Cancel button, anywhere.
- [ ] 49. Start Full page capture — progress bar and Cancel appear;
      status text never reads "Locating scroll area…" for this mode.
- [ ] 50. Start Scroll area capture with multiple candidates — the
      on-page picker appears; status text appropriately reflects
      scroll-area selection, not a generic capture progress number
      until an area is actually chosen.
- [ ] 51. Let a capture finish (any mode) — progress bar and Cancel
      disappear immediately after; no leftover progress text or
      disabled controls.
- [ ] 52. Trigger an error (e.g. capture a protected page mid-flow if
      possible, or disconnect and retry) — progress bar and Cancel
      disappear; only the friendly error notice remains.
- [ ] 53. With one capture already running (e.g. started from another
      window), open a second popup and press the primary button — see
      "Capture already running", and the progress text reflects the
      real in-progress capture (not a stuck "Preparing…").

## Sign-off

This checklist may only be marked complete by Fernando Gallarday after
physically running it. No automated report may claim "PASS" on any of
these 53 items.
