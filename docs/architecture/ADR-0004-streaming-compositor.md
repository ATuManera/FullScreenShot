# ADR-0004: Streaming, banded compositor instead of a giant in-memory canvas

## Status

Accepted (P1)

## Context

Full-page captures can be tens of thousands of pixels tall. Compositing
tiles into a single RGBA bitmap held entirely in memory (plus keeping all
decoded tiles around) risks large memory spikes and, per the spec's
non-negotiable list, a "giant `<canvas>`" architecture is explicitly
rejected.

## Decision

`screenshot_core::compositor::compose_streaming` assigns each tile a
non-overlapping content-space row band (`[scroll_offset_i,
scroll_offset_{i+1})`, derived from `CapturePlan`) and writes composed
rows directly into a `RowSink` one row at a time. `screenshot-png`'s
`compose_full_page_png` wires this straight into `png::StreamWriter`, so
a full-page PNG is produced without ever materializing the complete
stitched bitmap. The overlap `plan_tile_offsets` (P0) builds into tile
offsets is rounding tolerance only — bands never overlap in the output.

## Alternatives considered

- **Single RGBA bitmap + `image`/`canvas`-style whole-buffer encode:**
  rejected — exactly the "giant canvas" architecture the spec rules out;
  peak memory scales with total page height regardless of how modest each
  individual tile is.
- **Blend overlapping tile regions for seam correction:** rejected as the
  default strategy — banded assignment from a single source tile per
  output row is simpler, fully deterministic, and avoids the need for
  pixel-level seam comparison; overlap exists only so slightly-imprecise
  tile timing/rounding still covers the full content.

## Consequences

- Composing requires the source tiles to be supplied in the same order as
  `CapturePlan.tiles`; order/count/id mismatches are rejected explicitly
  (`compose_streaming`'s validation) rather than silently mis-composited.
- `expected_output_height` must be computable from `plan`+`dpr` alone
  (before any tile data exists) so a streaming PNG encoder can write its
  header up front — enforced by `compose_streaming` itself refusing to
  return success unless it wrote exactly that many rows.
- P3's PDF export composes into an in-memory RGB buffer rather than
  streaming per-page (see `docs/superpowers/specs/2026-09-17-p3-pdf-markdown-design.md`)
  — an accepted, documented exception scoped to PDF only, not a reversal
  of this ADR for PNG.
