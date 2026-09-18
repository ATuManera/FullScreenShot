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

**Icon (v2).** `extension/icons/fullscreen-shot.svg` — an original
design (rounded indigo `#4F46E5` square, white capture-frame corner
brackets, a plain vertical page with a white-on-indigo down-chevron
cut into its lower third). The chevron replaced v1's horizontal
content-line marks, which at toolbar size read as a text/OCR-scan
icon rather than "full page capture" — the failure mode this redesign
was commissioned to fix (see `docs/superpowers/specs/` conventions on
avoiding this look). No letter, no copied product iconography. Because
naively downscaling the 128px master blurred the chevron away at 16px,
`icon-16.png` is rendered from a 16px-specific optical pass (thicker
strokes, slightly larger page) rather than a plain scale-down of the
master SVG, while 32/48/128 come straight from
`fullscreen-shot.svg`. Rasterized via `rsvg-convert` (already present
on this build host; not added as a project dependency), visually
reviewed at each size before being committed, and checked against
white/light-gray/dark-gray/black backgrounds
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
