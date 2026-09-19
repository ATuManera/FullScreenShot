// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * What "visible" means for an export.
 *
 * Both exports that read the DOM — the PDF's text layer and Markdown — must
 * agree about this, because both answer the same question: is this text
 * something the user can actually see? A PDF whose search finds words the
 * page never showed, and a Markdown file carrying screen-reader-only prose,
 * are the same defect wearing different clothes.
 *
 * This module is the unit-tested statement of that rule. It is deliberately
 * pure — it takes the handful of computed-style values and box measurements
 * the rule needs, not an `Element` — so it can be exercised without a
 * browser, and so the two injectables can carry an identical copy of it.
 *
 * They must carry a copy rather than call it: `chrome.scripting
 * .executeScript({ func })` serializes a function with
 * `Function.prototype.toString()` and re-evaluates that source in the page,
 * where this module does not exist. That is not a theoretical hazard — it is
 * the defect that silently disabled the PDF's link annotations (see
 * `injectableSelfContainment.test.js`). `sticky.ts` and `injectable.ts` have
 * the same relationship for anchor classification.
 */

/** The computed-style values the rule reads, and nothing else. */
export interface ExportVisibilityStyle {
  display: string;
  visibility: string;
  opacity: string;
  contentVisibility: string;
  overflow: string;
  clip: string;
  clipPath: string;
}

/** The measured box the rule reads, in CSS px. */
export interface ExportVisibilityBox {
  clientWidth: number;
  clientHeight: number;
}

/**
 * Whether an element renders, and therefore whether its text belongs in an
 * export.
 *
 * `aria-hidden` is deliberately **not** consulted. Content hidden from
 * assistive technology is still painted on the screen and still in the
 * screenshot, so excluding it would drop text the user can plainly read.
 *
 * The last clause is the "visually hidden" pattern that screen-reader-only
 * text uses: a one-pixel box with its overflow clipped away. Its text is
 * genuinely not in the picture. The test is deliberately conservative —
 * clipping *and* a degenerate box — so an ordinary small visible label, which
 * is clipped but not one pixel square, is kept.
 */
export function isRenderedForExport(
  style: ExportVisibilityStyle,
  box: ExportVisibilityBox,
  hiddenAttribute: boolean,
): boolean {
  if (style.display === "none") return false;
  if (style.visibility === "hidden" || style.visibility === "collapse") return false;
  if (style.opacity === "0") return false;
  if (style.contentVisibility === "hidden") return false;
  if (hiddenAttribute) return false;
  const clipped =
    style.overflow === "hidden" ||
    (style.clip !== "auto" && style.clip !== "") ||
    (style.clipPath !== "none" && style.clipPath !== "");
  if (clipped && box.clientWidth <= 1 && box.clientHeight <= 1) return false;
  return true;
}

/**
 * Whether an element's `white-space` means its text is preformatted, and so
 * must reach the export byte for byte.
 *
 * This is what separates a page's own HTML source indentation — which carries
 * no meaning and must be collapsed — from indentation the user can see.
 * Keying off the computed value rather than the tag name is what makes a
 * `<div style="white-space: pre">` behave like a `<pre>`, which is what the
 * reader sees.
 */
export function preservesWhitespace(whiteSpace: string): boolean {
  return whiteSpace.startsWith("pre") || whiteSpace === "break-spaces";
}
