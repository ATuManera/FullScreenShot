# ADR-0007: A hybrid PDF — the screenshot for the eye, the DOM for everything else

## Status

Accepted (P7)

## Context

Until P7 a FullScreenShot PDF was a picture of a page. Nothing in it could
be searched, selected, copied or clicked, because nothing in it was text:
each page held one raster band and no more. That is fine as an archive and
poor as a document, and it is the single largest gap between the export and
what people expect a PDF to be.

Three ways out were on the table.

**Render the page to PDF instead of screenshotting it** — the print-to-PDF
or HTML-to-PDF route. It produces real text for free, and it gives up the
thing this product exists for: the output stops being what the user saw.
Layout diverges, print stylesheets take over, fixed elements move, and the
capture modes (Visible, Scroll Area) have no meaning at all.

**OCR the screenshot.** Rejected on sight: the text is already available,
exactly, from the DOM. Reading it back out of pixels would add a large
dependency to guess at something we can simply be told, and would guess
wrong on every logo, every small caption and every accent.

**Keep the screenshot and add a text layer over it.** The page's own
rectangles for its rendered text, drawn in a PDF text-rendering mode that
never paints, plus `/Link` annotations over its hyperlinks.

## Decision

The third. The raster stays byte-for-byte what the PNG export would have
produced, and over it go:

- invisible text, in **text rendering mode 3**, positioned from
  `Range.getClientRects()`;
- `/Link` annotations over `a[href]` rectangles, **http and https only**.

Three decisions inside that are worth recording.

**One transform, shared with the compositor.** Text is placed through the
compositor's band map — the same numbers `compose_streaming` writes pixels
from — rather than through `y * dpr`. The band map is where the browser's
rounding at each scroll seam is already accounted for. Re-deriving positions
from CSS arithmetic is precisely the class of bug this project has already
paid for once at fractional DPR, and it would have surfaced here as text
that drifts off its own words on exactly the displays that are hardest to
test on.

**A glyphless font, generated in this repository.** Because the glyphs are
never painted, their shapes are worthless and their metrics are everything.
So the font is a ~490-byte TrueType with one blank glyph, addressed through
`Identity-H` with a `/ToUnicode` map, every glyph half an em wide, and each
run stretched with `Tz` to the width the DOM measured. The alternative — a
base-14 font such as Helvetica — needs no bytes at all but silently
truncates the text layer to Windows-1252, which would have made the feature
work for Spanish and fail for most of the world. Embedding a real Unicode
font instead would have cost hundreds of kilobytes and a font licence, for
shapes nobody will ever see.

**The visual semantics win, not the DOM's.** The text layer describes the
*composite*, not the document. A `position: fixed` footer that the
compositor keeps exactly once, in the final band, has its words moved there
too; text that falls outside the captured region is dropped rather than
clamped onto the nearest row. A text layer that disagreed with the picture
would be worse than none, because search would find words at positions the
page never showed them.

## Consequences

- The PDF is genuinely a document: searchable, selectable, copyable, with
  working links, and still pixel-identical to the screenshot.
- Text inside images, `<canvas>`, WebGL and cross-origin iframes stays
  raster-only. There is no DOM to read it from, and OCR is out of scope.
- This is **not** a tagged PDF. There is no structure tree, so it is not
  PDF/UA and must not be described as an accessible PDF — only as one whose
  text can be found, read and copied.
- Bidirectional text is emitted in DOM order, which is logical order; no
  visual reordering is attempted.
- The WASM binary grew by about 49 KB (305 KB → 354 KB), almost entirely
  the text-layer and font code; no new third-party dependency was added
  beyond `serde`/`serde_json`, which the Markdown export already pulled in.
- `pdf-writer` was kept. It already supported everything needed — text
  objects, rendering modes, `Type0`/CID fonts with embedded font files,
  `/ToUnicode` CMaps, URI annotations and multiple pages — so no PDF-stack
  migration was required or attempted.
