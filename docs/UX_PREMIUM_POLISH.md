# UX Premium Polish (UX-P1 → UX-P4)

- Date: 2026-09-18
- Branch: `phase/ux-premium-polish`
- Scope: popup/options/result UI, contextual scroll-area detection,
  capture progress/state/preferences, branding. No changes to the Rust
  capture core architecture.

This document records the design decisions behind the UX-P1–UX-P4 pass,
per the repository's existing spec convention
(`docs/superpowers/specs/`), adapted for this UI-focused, non-phase-gate
task.

## UX-P1 — Popup hierarchy

**Problem.** The previous popup had three visually identical capture
buttons, always-visible PDF/Markdown controls regardless of relevance,
and leaked raw Chrome errors (`Error: The extensions gallery cannot be
scripted.`).

**Decision: capture-mode cards, not buttons.** `input[type=radio]`
styled as cards (native semantics preserved — screen readers and
keyboard navigation get real radio-group behavior for free) let the
user pick *what* to capture, separately from *how to trigger it* (one
primary CTA). The CTA's label changes with the selected mode
(`primaryCtaLabel()` in `popup.ts`), so there's exactly one dominant
action at any time.

**Decision: segmented control for PNG/PDF, not a `<select>`.** Two
mutually exclusive choices don't need a dropdown's extra interaction
cost; a segmented control also makes the current choice visible at a
glance (dropdowns hide it behind a closed control).

**Decision: progressive disclosure for PDF options.** `#pdf-options` is
only unhidden when the PNG/PDF segmented control's checked value is
`pdf` (`popup.ts`'s `change` listener on `exportFormatRadios()`). This
directly fixes "PDF settings remain visible even when PNG is selected."

**Decision: Markdown as a subview, not permanent popup real estate.**
`#view-main`/`#view-markdown` are two sibling `<main>` elements toggled
via `hidden`; the "Export page as Markdown ›" row is the only trace of
Markdown in the default view. This is a plain visibility toggle, not a
router — the popup is a single static document, so there's nothing
heavier to build here.

**Decision: centralized error mapping (`popup/errors.ts`).**
`mapBrowserError(rawMessage): FriendlyError` is the single place that
decides what a human sees. Every `ERROR` message received on the
capture port goes through it before touching the DOM; the raw message
is `console.error`'d instead, for developers. This directly replaces
the leaked "extensions gallery cannot be scripted" text with "Capture
unavailable on this page."

**Decision: pre-detect restricted pages, not just catch their
errors.** `popup.ts`'s `main()` calls the existing (P1-era)
`isCapturableUrl()` before rendering the capture UI at all, so a
protected page never even shows enabled capture controls — the error
mapper is the fallback for cases pre-detection can't know about (a
runtime failure once scripting is actually attempted).

## UX-P2 — Contextual scroll-area detection

**Problem.** "Select Scroll Area" was always shown, even on pages with
no meaningful internal scroll container, and even when there was
exactly one obvious candidate (forcing the user through a picker for a
non-choice).

**Split: in-page detection vs. pure ranking.** Per the executeScript
self-containment constraint already established in this codebase
(`injectable.ts`, `selection.ts`, `markdown.ts` — a function passed to
`chrome.scripting.executeScript({ func })` is serialized via
`Function.prototype.toString()` and re-evaluated with no access to
outer module scope), the actual DOM walk
(`scrollDetectionInjectable.ts`'s `detectScrollCandidates`) can only
return plain geometry data, not ranked/deduplicated results — it
can't `import` anything. Ranking and deduplication
(`scrollAnalysis.ts`'s `rankAndDeduplicate`) therefore runs afterwards,
in the popup, as a pure, directly unit-testable function over that raw
geometry.

**Cheap-first filtering.** `detectScrollCandidates` rejects on a plain
geometry/property check (`scrollHeight <= clientHeight + 1`,
zero-sized box, `aria-hidden`) before ever calling
`getComputedStyle` — the expensive call only runs for elements that
already look plausible, per the performance constraint (section 15) on
not freezing large pages.

**Deduplication heuristic.** Two candidates whose bounding boxes
overlap ≥90% (in either direction) are treated as the same region;
between them, the *smaller* one is kept. Nested wrapper markup (an
outer `overflow:auto` div around one actual scrollable child) is the
common case this targets — the inner element is normally the
meaningful content region, and the outer one is incidental. This is a
deliberate, documented heuristic (`scrollAnalysis.ts`'s
`rankAndDeduplicate` doc comment), not a proof — a real page could
defeat it, in which case the worst case is one extra candidate shown,
not a broken capture.

**0 / 1 / 2+ UI states.**
`classifyScrollAreaUiState(deduplicated candidates)` returns a 3-way
union (`{kind:"none"}` / `{kind:"single"}` / `{kind:"multiple", count}`)
that `popup.ts`'s `applyScrollAreaState` renders directly: 0 hides the
Scroll Area card entirely; 1 shows it with "1 scrollable region
detected" and a CTA that captures directly, no picker; 2+ shows "N
scrollable regions detected" with a "Choose scroll area…" CTA that
invokes the existing interactive picker (`selection.ts`'s
`enterSelectionMode`, unchanged).

**Direct-capture path for the "exactly one" case.**
`selectSoleScrollCandidate` (in `scrollDetectionInjectable.ts`) re-runs
a geometry filter kept manually in sync with `detectScrollCandidates`'s,
and only tags an element (the same reversible
`data-fullscreenshot-container-id` marker attribute `selection.ts`
already knows how to re-find) when it finds *exactly* one match. If the
page changed between popup-open analysis and the moment the user clicks
the CTA (dynamic content), `background/index.ts`'s `resolveResult` falls
back to the interactive picker rather than failing outright.

**Never mutates the page merely to analyze it.**
`detectScrollCandidates` (used for the popup's live count/subtitle) is
a pure read — no attribute, no style, no DOM change. Only
`selectSoleScrollCandidate` (run once, right before an actual capture)
tags an element, matching the pattern the existing interactive picker
already used.

## UX-P3 — State, progress, persistence, workflow

**Structured progress instead of a status string.**
`orchestrator.ts`'s `ProgressCallback` changed from `(status: string)
=> void` to `(progress: {text, current?, total?}) => void` — every
call site that has a real tile count (`Capturing N of M…`) now reports
it structurally, so the popup can render a real determinate progress
bar instead of parsing text, and the background can drive a real
`chrome.action` badge (`3/8`) instead of a fake percentage.

**Background holds the authoritative capture state, not the popup.**
MV3 popups can close mid-capture; the popup is not where capture state
lives. `background/index.ts` keeps a single in-memory `active:
ActiveCapture | null` slot. `background/captureGuard.ts` isolates the
two decisions around it as pure functions —
`shouldRefuseNewCapture(active)` and `buildStateMessage(active)` — so
they're unit-tested without a chrome.* mock. A `GET_STATE` message
(sent once, right after the popup opens a single long-lived port) lets
a reopened popup reconstruct the correct busy/idle UI instead of
guessing or starting a second capture; `START_CAPTURE` while `active`
is set returns `ALREADY_CAPTURING` rather than queuing.

**Toolbar badge (`background/badge.ts`).** `chrome.action.setBadgeText`
needs no new permission (implicit for any `action`-declaring MV3
extension). Progress badges (`3/8`), an indeterminate `…`, a success
`✓` (auto-clears after 2.5s), and an error `!` (auto-clears after 4s)
— every setter either gets followed by another update or schedules its
own clear, so nothing is left stale.

**Smart filenames (`popup/filename.ts`).**
`{hostname}_{page-title}_{YYYY-MM-DD_HHmm}.{ext}`, built in
`background/index.ts` at the moment a capture finishes (it has
`tab.title`/`tab.url` in scope) and stored alongside the result's data
URL for `result.ts` to use as the `<a download>` filename. Pure and
unit-tested: accent stripping, unsafe-character sanitization, length
capping, safe fallbacks (`page`/`capture`) when hostname/title are
empty.

**Preferences (`popup/preferences.ts`).** Export format, PDF page
size/orientation, Markdown mode, and the Fast/Reliable full-page
loading choice persist via `chrome.storage.local`; the active capture
mode deliberately does not (always resets to Full page). Storage is
never trusted blindly — `mergePreferences` validates every field
individually against its enum and falls back to that field's own
default, so one corrupted field can't invalidate the rest.

## UX-P4 — Branding, dark mode, accessibility

**Icon (v3).** `extension/icons/fullscreen-shot.svg` — an original
camera pictogram (rounded indigo `#4F46E5` square, white camera body +
viewfinder bump + lens, with a white page tab peeking out from behind
its bottom-right corner). v2's abstract capture-frame-brackets + page +
chevron design was rejected by the owner: it read fine in the popup at
32px but was too abstract to parse as "screenshot" at real 16px
toolbar size. v3 replaces the brackets metaphor with a simplified
camera — the strongest immediate "capture" signal — keeping the page
tab as a secondary, subtler "full page" cue so it doesn't compete with
the camera silhouette. Two other camera candidates (a down-chevron
hidden inside the lens; a short tail hanging from the lens) were built
and compared side by side in a simulated 7-icon toolbar strip
(`docs/assets/icon-v3-toolbar-comparison.png`) before picking the page
tab variant, since the other two kept the camera marginally cleaner
but their secondary signal was close to invisible at 16px. No letter,
no copied product iconography — the underlying rectangle+bump+circle
camera silhouette is a generic, universal pictogram convention, not
copied from any specific product. `icon-16.png` renders from a
16px-specific optical pass rather than a scale-down of the 128px
master, while 32/48/128 come straight from `fullscreen-shot.svg`. That
optical pass was itself refined once more in the final Chrome polish
pass (`extension/icons/fullscreen-shot-16.svg`, see "Final Chrome UX
polish" below) after the owner's physical toolbar test found the page
tab still too subtle. Rasterized via `rsvg-convert` (already
present on this build host; not added as a project dependency),
visually reviewed at each size before being committed, and checked
against white/light-gray/dark-gray/black backgrounds
(`docs/assets/icon-preview.png`, a local validation aid, not shipped
in the extension). Wired into `manifest.base.json`'s both `icons` and
`action.default_icon` (unchanged paths — only the PNG/SVG content
changed).

**Dark mode.** Design tokens as CSS custom properties on `:root`,
redefined under `@media (prefers-color-scheme: dark)` — no toggle (none
existed before; out of scope to add one now per the task brief). Same
token set applied consistently across `popup.css`, `options.css`, and
`result.css` for a single coherent look across all three pages.

**Accessibility.** Capture-mode cards and every segmented control are
real `input[type=radio]` groups (native keyboard/screen-reader
semantics, no custom ARIA reimplementation needed). Visible
`:focus-visible` rings on every interactive element. No color-only
state communication — selected cards/segments get a border/background
change *and* the native `checked` state; disabled controls use the
native `disabled` attribute (announced by assistive tech automatically).
`@media (prefers-reduced-motion: reduce)` collapses all transitions and
the indeterminate progress animation. The existing scroll-area picker's
Escape-to-cancel behavior (`selection.ts`) was already in place and is
unchanged.

**Settings/About polish.** `options.html` gained a real `options.css`
(previously unstyled) using the same tokens, plus a "Full-page loading"
setting explaining Fast/Reliable in plain language ("Fast: capture
immediately" / "Reliable: load lazy content before capture") instead of
implementation vocabulary (rate limiter, tiles, WASM). About still
carries the full legal attribution (ATuManera, Fernando Gallarday,
repository, `MPL-2.0-no-copyleft-exception`, privacy link) unchanged in
substance from before this pass.

## Final Chrome UX polish (`polish/final-chrome-ux`)

A later, narrower pass on top of UX-P1–P4 and the runtime/IndexedDB
repair, scoped to three things the owner flagged after physically
testing Icon V3 and the post-repair Result Page.

**16px icon.** Covered above — `fullscreen-shot-16.svg`'s page tab
enlarged from 30×60 to 34×64 and shifted 4px, chosen over a
same-size-but-repositioned alternative that read worse once compared
at true 16px scale (`docs/assets/icon-v3-16px-optical-comparison.png`).
The camera itself, and the master SVG/32/48/128 PNGs, are unchanged.

**Result Page.** `result.html`/`result.css`/`result.ts` rebuilt around
a new pure module, `result/resultView.ts`, that owns every piece of
displayed copy and formatting (filename, "PNG · WxH" / "PDF · A4 ·
Portrait" / "Markdown" summaries, status text, TTL/location notes) so
it's unit-tested independent of the DOM. Explicit states: Ready
("Capture complete" → Download <Format>), Downloaded ("Download
started" → Download again / Close), Expired ("Result expired", no
Download control), and a distinct Missing-id state ("No capture
selected") for a bare/garbled result URL. Never claims what Chrome
hasn't confirmed: no filesystem path (no `downloads` permission to
verify one), no "Downloaded successfully" (only "started"). Close is a
best-effort `window.close()` — works for a `chrome.tabs.create`-opened
tab without any new permission — that swaps to "You can close this tab
when you're done." if the tab is still visible ~300ms later, instead of
shipping a button that can silently do nothing.

`shared/resultStore.ts` gained optional `width`/`height`/`pdfPageSize`/
`pdfOrientation` fields on `StoredResult` (backward-tolerant — a record
saved before this change simply has them `undefined`), populated in
`background/index.ts` from the pixel dimensions the capture pipeline
already computed. No second PNG decode, no duplicated screenshot bytes.

**Popup progress state.** The busy/progress-bar/Cancel visibility
decision that used to live as scattered `setBusy()`/`renderProgress()`
calls inside popup.ts's `onMessage` switch is now one pure function,
`popup/progressView.ts`'s `progressStateForMessage`, covering every
message type that can affect it (STATE, PROGRESS, DONE, CANCELLED,
ERROR, NO_CONTAINER_SELECTED, ALREADY_CAPTURING) — unit-tested
directly. Also fixes a real stale-text case: pressing the primary CTA
while a capture is already running left this popup's own optimistic
"Preparing…" showing under the error until the next PROGRESS broadcast
happened to arrive; it now issues an immediate `GET_STATE` and applies
the real in-progress text right away. Scroll-area analysis was already
independent of this state machine (verified, not changed) — it never
calls into progress UI, so "Locating scroll area…" was already scoped
to the Scroll Area mode only.

## What this pass deliberately did not touch

- The Rust capture core (`crates/`) — untouched except for the
  pre-existing `chore/upgrade-png-0.18` branch work, which this branch
  is based on.
- `crates/screenshot-wasm`'s exported API surface.
- The manifest's permission set (`activeTab`, `scripting`, `storage` —
  unchanged; no new permission was needed for any of UX-P1–UX-P4).
- Safari packaging (explicitly out of scope for this task per the
  brief's "Chrome-first scope" section).

## Historial

| Fecha      | Commits de código | Cambio                                                                                                                                                            |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-18 | `e74aebd`          | Creación del icono v1 (brackets de encuadre + página con líneas de contenido) documentada en esta sección UX-P4.                                                 |
| 2026-09-18 | `4c6c05b`          | Rediseño del icono a v2: se sustituyen las líneas de contenido por un chevron descendente (evita la lectura como "escáner de documento"); se añade un ajuste óptico específico para 16px y la hoja de validación `docs/assets/icon-preview.png`. |
| 2026-09-18 | `3d6500d`, `1d884f7` | V2 rechazado por el owner (demasiado abstracto a 16px real). Rediseño del icono a v3: cámara simplificada (cuerpo + visor + lente) con una pestaña de página asomando detrás, sustituyendo la metáfora de brackets abstractos. Se documenta la comparación de tres candidatos de cámara en un toolbar simulado (`docs/assets/icon-v3-toolbar-comparison.png`) y se actualiza `docs/assets/icon-preview.png`. |
| 2026-09-18 | `7767420`, `6995d00` | Final Chrome UX polish, parte 1: ajuste óptico del icono a 16px (pestaña de página ampliada de 30×64 a 34×64), con comparación de candidatos documentada en `docs/assets/icon-v3-16px-optical-comparison.png`. Cámara y master SVG/32/48/128 sin cambios. |
| 2026-09-18 | `7a4091d` | Final Chrome UX polish, parte 2: rediseño de la Result Page (estados Ready/Downloaded/Expired/Missing, resumen de formato/dimensiones, notas honestas sobre ubicación de descarga y TTL, botón Close con degradación) y extensión retrocompatible de `ResultMetadata` en `resultStore.ts`. |
| 2026-09-18 | `47cfb16` | Final Chrome UX polish, parte 3: se extrae la decisión de progreso/Cancel del popup a `popup/progressView.ts` (función pura) y se corrige un texto "Preparing…" obsoleto en el caso `ALREADY_CAPTURING`. |
| 2026-09-18 | `1300c53` | Final Chrome UX polish, parte 4: cobertura de tests para `resultView.ts` y `progressView.ts` (90/90 tests pasando). |
