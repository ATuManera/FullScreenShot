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

## Full Page + Scroll Area runtime repair (`fix/fullpage-scrollarea-runtime`)

These four gates must pass physically before PDF/Markdown acceptance is
resumed. They exist because Full Page and Scroll Area were physically
broken on `polish/final-chrome-ux`: Full Page produced a tall PNG made of
one viewport repeated, and Scroll Area with two or more regions never
completed. Serve the fixtures over HTTP (`file://` URLs restrict what an
extension may inject) — from the repo root:

```
python3 -m http.server 8899 --directory tests/pages
```

### Gate A — Full Page on the controlled fixture

Open `http://127.0.0.1:8899/fullpage-acceptance.html`, then Full page → PNG.

- [ ] A1. The result is roughly 8 screens tall, not one viewport repeated.
- [ ] A2. Scrolling the result top to bottom shows SECTION 1 … SECTION 8 in
      order, each exactly once, with both its "TOP EDGE OF BAND n" and
      "BOTTOM EDGE OF BAND n" lines present.
- [ ] A3. "STICKY HEADER" appears exactly once, at the very top, and nowhere
      else down the image.
- [ ] A4. "FIXED FOOTER" appears exactly once, at the very bottom of the
      image, and nowhere else down it.
- [ ] A5. No visible seam or duplicated strip at any band boundary.
- [ ] A6. After the capture the page is back where it started, with no
      leftover outlines and nothing hidden.

### Gate B — Full Page on a real long page

Open a real long article (a news site, a long Wikipedia page).

- [ ] B1. The result contains the whole article, each part exactly once.
- [ ] B2. The site's sticky navigation bar is not repeated down the image.
- [ ] B3. If the page refuses to scroll (some app shells and scroll-jacking
      marketing pages do), the capture stops with "The page didn't scroll"
      and suggests Visible area — it must never hand back a tall image of
      the same viewport repeated. `tests/pages/scroll-jacked-page.html`
      reproduces this deliberately.

### Gate C — Scroll area, exactly one internal region

Open `http://127.0.0.1:8899/scrollarea-single.html`.

- [ ] C1. The popup shows "Scroll area" and "1 scrollable region detected".
- [ ] C2. The primary button reads "Capture scroll area".
- [ ] C3. Pressing it captures immediately — no picker, no blue outlines.
- [ ] C4. The result contains PANEL ROW 1 … PANEL ROW 14, each exactly once,
      and nothing from outside the panel (no page heading, no note text).
- [ ] C5. The panel is left scrolled back where it was.

### Gate D — Scroll area, multiple internal regions

Open `http://127.0.0.1:8899/scrollarea-multiple.html`.

- [ ] D1. The popup shows "Choose scroll area…" and "2 scrollable regions
      detected"; the primary button reads "Choose scroll area".
- [ ] D2. Pressing it outlines both panels in blue, the cursor becomes a
      pointer over them, and **the popup closes itself** — the choice happens
      on the page, so the page gets the keyboard.
- [ ] D2b. The popup must not close before the outlines appear. On a page
      whose regions vanish just beforehand, the popup stays open and says so
      rather than closing onto nothing.
- [ ] D3. Hovering a panel thickens its outline.
- [ ] D4. Clicking the right-hand (green-bordered) panel captures it. The
      result contains BETA ROW 1 … BETA ROW 12 and no ALPHA rows.
- [ ] D5. No blue selector outline appears anywhere in the captured image.
- [ ] D6. Repeat and click the left-hand panel: the result contains ALPHA
      rows only.
- [ ] D7. Repeat and press Escape **once**: outlines disappear and no capture
      starts. One press, not two — the popup is already out of the way, so the
      key reaches the picker.
- [ ] D8. Repeat and click empty page background instead: same as D7 — this
      must not hang.
- [ ] D9. Repeat, press Escape once, then reopen FullScreenShot **straight
      away**. It must be ready, with no red error notice — Escape is a choice,
      not a failure.
      No "Choose a scroll area…", no progress bar, no Cancel, and no delay
      before it settles.
- [ ] D10. Repeat, press Escape, and start a different capture (Visible area)
      immediately. It must be accepted, not refused as "Capture already
      running".
- [ ] D11. On a page with no scrollable region at all, the "No area selected"
      notice is still the right answer and should still appear — that message
      belongs to "there is nothing here to pick", not to Escape.
- [ ] D9. Repeat and press Cancel in the popup while the picker is open:
      outlines disappear and the popup returns to ready.
- [ ] D12. After every one of the above, the page has no leftover blue
      outlines and no leftover pointer cursor.

### Gate F — Fast vs Reliable full-page loading

Open `chrome://extensions` → FullScreenShot → Details → Extension options (or
right-click the toolbar icon → Options) to reach **Full-page loading**.

Open `http://127.0.0.1:8899/lazy-fullpage-acceptance.html`. Sections 4, 5 and
6 of this page do not exist until it has actually been scrolled near its
bottom, one per arrival — so the captured image says whether the capture
loaded them.

- [ ] F1. With **Fast** selected, capture Full page. The result is about 3
      screens tall and contains SECTION 1-3 only. (This is correct: Fast plans
      from the height the page has when capture starts.)
- [ ] F2. Switch to **Reliable** and capture Full page again. The result is
      about twice as tall and contains SECTION 1 through SECTION 6, in order,
      each exactly once — the last three labelled "LAZY".
- [ ] F3. During a Reliable capture the popup shows "Preparing… (pre-scroll n
      of 8)" before it starts counting tiles.
- [ ] F4. After both captures the page is back at the top and nothing is left
      scrolled or hidden.
- [ ] F5. On a real lazy-loading page (an image-heavy article, an infinite-ish
      feed), Reliable brings in visibly more content than Fast, and a feed
      that never stops growing ends with "The page changed during capture"
      rather than scrolling forever.
- [ ] F6. The setting persists: reopen the options page and the choice you
      made is still selected.

### Gate G — long output and terminal error state

This gate exists because a real capture of
`fullpage-acceptance.html` failed on a scaled display with
"invalid dimensions: 1660x8484", and the popup then showed "Capture failed"
with a progress bar, "Processing…" and Cancel still underneath it.

Display scaling matters here: run at least one pass on a **scaled** resolution
(System Settings → Displays → a "More Space"/scaled option, which gives a
fractional device pixel ratio) as well as the default.

- [ ] G1. Full page → PNG on `http://127.0.0.1:8899/fullpage-acceptance.html`
      completes with no error, on both a default and a scaled display.
- [ ] G2. The result page opens and reports a height of several thousand
      pixels — around 8500 on a 1.5x display — and the PNG opens in Preview
      at those exact dimensions.
- [ ] G3. All 8 bands, one sticky header and one fixed footer, as in Gate A.
- [ ] G4. Repeat on a real long article. A capture of tens of thousands of
      pixels is expected to work; it is no longer bounded by anything but a
      memory budget.
- [ ] G5. Force a failure — capture a protected page mid-flow, or reload the
      extension during a capture. When the error notice appears there is **no**
      progress bar, **no** "Processing…", and **no** Cancel beneath it, and
      the capture button is usable again immediately.
- [ ] G6. Start a capture, close the popup, reopen it just as the capture is
      finishing. The popup must never end up showing an error and a progress
      bar at the same time.
- [ ] G7. After an error, starting a new capture works and shows fresh
      progress.

### Gate H — Settings and About live in the popup

- [ ] H1. Open FullScreenShot and click **Settings** in the footer. It opens
      inside the popup. **No browser tab is created.**
- [ ] H2. The Full-page loading choice is there, showing the value currently
      in force, with its hint underneath.
- [ ] H3. Switch it to Reliable. The hint updates immediately.
- [ ] H4. Press **Done** (or **‹ Back**) — both return to the capture view.
- [ ] H5. Close and reopen the popup: it opens on the capture view, and
      Settings still shows Reliable. The choice persisted.
- [ ] H6. Start a Full page capture right after changing the setting, without
      reopening the popup: it uses the setting you just picked.
- [ ] H7. Click **About**. It opens inside the popup. **No browser tab.**
      It shows the icon, the real version (0.1.0), the local-only guarantees,
      the licence and the attribution.
- [ ] H8. **‹ Back** returns to the capture view.
- [ ] H9. Check both views in light and dark mode, and reach every control
      with Tab alone — focus must stay visible throughout.
- [ ] H10. There is no longer an "Extension options" entry in the extension's
      own menu on `chrome://extensions` — Settings lives only in the popup.

### Gate R — the one re-check after the link repair

Links were not clickable because the injected text extractor referenced a
helper from its own module, which does not exist in the page it is
re-evaluated in. The first `<a>` on any page threw, so the extension emitted
a PDF with no links — and no text layer either. That is fixed, and link
clicking is now machine-verified in Chrome's PDF viewer on the generated
file; what is not verified is the extension actually running in your Chrome.

Do this first. If R3 passes, the repair holds and the rest of Gate P is a
re-confirmation rather than an investigation.

- [ ] R1. `cargo xtask build`, reload the unpacked extension, and capture
      `tests/pages/pdf-text-acceptance.html` → Full page → PDF → A4.
- [ ] R2. The result page says **"PDF · A4 · Portrait · Searchable text"**.
      If it does not, the text layer is still not being produced — stop and
      report it, because links and text now fail and succeed together.
- [ ] R3. Open the PDF in Chrome and click **"documento de origen"**.
      Expected: it opens `https://example.com/principio`.
- [ ] R4. Open the service-worker console (`chrome://extensions` →
      FullScreenShot → "service worker") and confirm it logged a line like
      `PDF text layer: 49 fragments, 5 links, … ms` — and **no** warning
      about extraction having failed.

### Gate P — the PDF is a document, not just a picture

Automated checks proved the text layer with poppler, qpdf and PDFium
separately, and every link in the generated PDF is now clicked by machine in
Chrome's own viewer. What still cannot be automated is searching, selecting
and copying inside that viewer: the plugin exposes neither its find bar nor
its accessibility tree. Those items below remain unverified until you run
them; the link items (P9-P12) are a confirmation that the extension's own
output behaves like the file the tests exercise.

Use `tests/pages/pdf-text-acceptance.html` (open it from disk) unless an
item says otherwise.

- [ ] P1. Full page → PDF → A4 → Portrait. The result page says
      **"PDF · A4 · Portrait · Searchable text"**. If it does not say
      "Searchable text", stop and report it — the rest of this gate is
      meaningless.
- [ ] P2. Open the PDF in Chrome. It looks **exactly** like the PNG of the
      same page: same colours, same layout, no text drawn twice, no ghost
      text, no boxes around links.
- [ ] P3. Cmd+F in the viewer → search `Marcador inferior`. It is found, on
      the last page.
- [ ] P4. Search `información`, `auditoría`, `Perú`, `señal`, `pingüino`.
      Each is found, with its accent.
- [ ] P5. Search `no debe aparecer`. It must find **nothing** — that text is
      hidden on the page five different ways and must not be in the PDF.
- [ ] P6. Drag-select the first paragraph. The highlight sits over the words
      you are dragging across, not above or below them, and not shifted
      sideways.
- [ ] P7. Copy that selection and paste it somewhere. It reads like the
      original sentence, with spaces around the bold and italic words —
      "la palabra información en negrita", not "la palabrainformación".
- [ ] P8. Select the narrow, wrapped paragraph. Each line highlights as its
      own line; the words do not pile up on the first one.
- [ ] P9. Click the link near the top. It opens `example.com/principio`.
- [ ] P10. Click the **second half** of the link that wraps across two
      lines. It opens too — both halves are clickable.
- [ ] P11. Click the link near the bottom. It opens `example.com/final`.
- [ ] P12. The three links that must **not** be clickable — "acción de
      página" (`javascript:`), "recurso incrustado" (`data:`) and "correo"
      (`mailto:`) — do nothing. Nothing runs, nothing opens.
- [ ] P13. The fixed footer text ("Pie fijo") appears **once** in the PDF,
      at the bottom, and is searchable there. Search it and confirm one
      match, not one per page.
- [ ] P14. The sticky header ("Cabecera fija") appears **once**, at the top.
- [ ] P15. Repeat P1–P3 with **Letter** and with **Auto**. Auto is a single
      long page; search still works at its very bottom.
- [ ] P16. `tests/pages/scrollarea-single.html` → Scroll area → PDF. Search
      `PANEL ROW 14`: found. Search `FUERA DEL PANEL`: **not** found — the
      page around the container must not be in the text layer. The link
      inside the panel is clickable.
- [ ] P17. A real long page (a Wikipedia article) → Full page → PDF. Search
      a word from the top, one from the middle and one from the end. The
      export does not feel noticeably slower than the PNG of the same page.
- [ ] P18. A page made mostly of images (an image gallery) → PDF. It still
      exports, and the result page does **not** claim "Searchable text" if
      there was no text to place.
- [ ] P19. Open one of these PDFs in macOS Preview as well. Visual, search
      and copy behave the same as in Chrome.
- [ ] P20. Full page → **PNG** on the same pages. The PNGs are unchanged
      from before this branch — the PDF work must not have touched them.

### Gate E — nothing already working regressed

- [ ] E1. Visible area still captures exactly the current viewport.
- [ ] E2. The result page still opens, still survives a reload, and Download
      still works.
- [ ] E3. Full Page never shows "Locating scroll area…".
- [ ] E4. Cancel during a Full Page capture stops it, restores the page
      scroll, and leaves the popup ready for a new capture.
- [ ] E5. A page with no fixed or sticky elements at all captures exactly as
      before, with no extra pause at the end.
- [ ] E6. Markdown export is unchanged — the PDF work did not touch it.
- [ ] E7. Scroll area → PNG still produces exactly the container's content.

## Sign-off

This checklist may only be marked complete by Fernando Gallarday after
physically running it. No automated report may claim "PASS" on any of
these items.
