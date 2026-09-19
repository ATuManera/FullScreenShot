// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * DOM → text/link geometry extraction for the hybrid PDF.
 *
 * The screenshot is the visual truth; this is where the semantic truth comes
 * from. It reads the rectangles the browser itself reports for rendered text
 * and hyperlinks, so the PDF's invisible text layer describes what the
 * capture actually shows — no OCR, no re-rendering, no guessing.
 *
 * Like `injectable.ts` and `selection.ts`, `extractTextLayer` is self-
 * contained for `chrome.scripting.executeScript({ func })`: it may reference
 * only its own parameters, its own locals and web-platform globals, because
 * the function is serialized with `Function.prototype.toString()` and
 * re-evaluated in the page with no module scope. The fixed/sticky anchor
 * classification it inlines mirrors `sticky.ts`'s `classifyFixedAnchor` and
 * must be kept in step with it, exactly as `injectable.ts`'s copy is.
 *
 * It is **read-only**: it never sets a style, never scrolls and never writes
 * to the DOM, so it cannot thrash layout — every measurement it takes is
 * against the layout that was already there.
 */

/** One visual line of text, in the capture's own source coordinates. */
export interface TextLayerFragment {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Computed `font-size` in CSS px — the PDF's text metrics need it. */
  size: number;
}

/** One rendered rectangle of one hyperlink. */
export interface TextLayerLink {
  uri: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextLayerStats {
  elapsedMs: number;
  elementsVisited: number;
  /** True when a limit stopped the walk before the document ended. */
  truncated: boolean;
}

export interface ExtractedTextLayer {
  fragments: TextLayerFragment[];
  links: TextLayerLink[];
  stats: TextLayerStats;
}

/**
 * Which capture the text is being extracted for, and therefore which
 * coordinate space the rectangles come back in.
 *
 * `page` reports **document** coordinates, matching the full-page
 * compositor's band offsets. `container` reports the chosen scroll
 * container's own **content** coordinates, matching the scroll-area
 * compositor's band offsets, and walks only inside that container.
 */
export type TextLayerMode = "page" | "container";

/** Only these ever become clickable annotations; see the Rust side, which re-checks. */
export function isSupportedLinkUri(uri: string): boolean {
  const trimmed = uri.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;
  const lower = trimmed.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

/**
 * Groups measured word boxes into one run per visual line.
 *
 * A wrapped paragraph is a single text node with several client rectangles,
 * and putting the whole string in the first of them would place three lines
 * of text on one line and make every selection wrong. Words on the same line
 * share a `top`, so grouping by it — with a tolerance, because a superscript
 * or a taller inline sibling shifts a box by a fraction of a pixel —
 * reconstructs the lines without asking the DOM what they are.
 *
 * Exported for its own tests; the injectable inlines an identical copy.
 */
export function groupWordsIntoLines(
  words: Array<{ text: string; left: number; top: number; right: number; bottom: number }>,
  tolerance = 2,
): Array<{ text: string; left: number; top: number; right: number; bottom: number }> {
  const lines: Array<{ text: string; left: number; top: number; right: number; bottom: number }> = [];
  for (const word of words) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(word.top - current.top) <= tolerance) {
      current.text += " " + word.text;
      current.left = Math.min(current.left, word.left);
      current.right = Math.max(current.right, word.right);
      current.top = Math.min(current.top, word.top);
      current.bottom = Math.max(current.bottom, word.bottom);
      continue;
    }
    lines.push({ ...word });
  }
  return lines;
}

/**
 * Extracts the text and link geometry for one capture.
 *
 * `bottomAnchorShift` is how far down the composite a bottom-anchored
 * `position: fixed` bar ended up — the last band's origin. The full-page
 * compositor keeps such a bar exactly once, in the final band, so its text
 * has to be moved there too; leaving it where it sits on screen would put a
 * footer's words in the middle of the document, and emitting it per band
 * would repeat them down the whole PDF. Pass 0 for a single-viewport capture,
 * where the bar is already where it belongs.
 *
 * The caller must have the window scrolled to the top: viewport-anchored
 * elements are placed from where they render *now*, and that is only the
 * first band's picture of them when the page is at its origin.
 */
export function extractTextLayer(
  mode: TextLayerMode,
  attr: string,
  value: string,
  bottomAnchorShift: number,
): ExtractedTextLayer {
  const startedAt = Date.now();
  const doc = document;
  const win = window;

  const MAX_FRAGMENTS = 60000;
  const MAX_LINKS = 20000;
  /** Above this, a single text node is split by line rather than by word. */
  const WORD_SPLIT_CHAR_LIMIT = 20000;
  const LINE_TOLERANCE_PX = 2;
  /** Anything bigger is a measurement gone wrong, not a line or a link. */
  const MAX_RECT_PX = 100000;

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "HEAD",
    "TITLE",
    "IFRAME",
    "FRAME",
    "OBJECT",
    "EMBED",
    "CANVAS",
    "SVG",
    "VIDEO",
    "AUDIO",
    "SELECT",
    "OPTION",
    "DATALIST",
  ]);

  const fragments: TextLayerFragment[] = [];
  const links: TextLayerLink[] = [];
  let elementsVisited = 0;
  let truncated = false;

  // --- Coordinate origins -------------------------------------------------
  //
  // Subtracting these from a viewport rectangle yields the capture's own
  // source coordinates. The asymmetry between the two axes in container mode
  // is not an oversight: the scroll-area capture moves the container's
  // `scrollTop` between bands, so vertical positions must be content-
  // relative, while it never touches `scrollLeft` and crops each band at the
  // container's on-screen left edge, so horizontal positions must stay
  // relative to what is on screen.
  let root: Element | null;
  let originX: number;
  let originY: number;

  if (mode === "container") {
    const container = doc.querySelector(`[${attr}="${value}"]`) as HTMLElement | null;
    if (!container) {
      return { fragments, links, stats: { elapsedMs: 0, elementsVisited: 0, truncated: false } };
    }
    const box = container.getBoundingClientRect();
    root = container;
    originX = box.left + container.clientLeft;
    originY = box.top + container.clientTop - container.scrollTop;
  } else {
    root = doc.body;
    originX = -win.scrollX;
    originY = -win.scrollY;
  }
  if (!root) {
    return { fragments, links, stats: { elapsedMs: 0, elementsVisited: 0, truncated: false } };
  }

  // --- Viewport-anchored elements (mirrors sticky.ts) ----------------------
  const viewportHeight = win.innerHeight;
  const viewportWidth = win.innerWidth;
  const ANCHOR_SLACK_RATIO = 0.1;
  const BAR_WIDTH_RATIO = 0.6;
  const OVERLAY_HEIGHT_RATIO = 0.9;

  const classifyAnchor = (top: number, bottom: number, width: number): "top" | "bottom" | "other" => {
    const height = bottom - top;
    if (height <= 0 || bottom <= 0 || top >= viewportHeight) return "other";
    if (width < viewportWidth * BAR_WIDTH_RATIO) return "other";
    if (height >= viewportHeight * OVERLAY_HEIGHT_RATIO) return "other";
    const slack = viewportHeight * ANCHOR_SLACK_RATIO;
    const gapTop = top;
    const gapBottom = viewportHeight - bottom;
    if (gapTop <= slack && gapTop < gapBottom) return "top";
    if (gapBottom <= slack && gapBottom < gapTop) return "bottom";
    return "other";
  };

  /** Whether an element renders at all, and therefore whether the screenshot can show its text. */
  const isRendered = (el: HTMLElement, style: CSSStyleDeclaration): boolean => {
    if (style.display === "none") return false;
    if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (style.opacity === "0") return false;
    if (style.contentVisibility === "hidden") return false;
    if (el.hidden) return false;
    // The "visually hidden" pattern screen-reader-only text uses: a 1px box
    // with its overflow clipped away. Its text is genuinely not in the
    // picture, so putting it in the text layer would make a PDF whose search
    // finds words the page never showed.
    const clipped =
      style.overflow === "hidden" ||
      (style.clip !== "auto" && style.clip !== "") ||
      (style.clipPath !== "none" && style.clipPath !== "");
    if (clipped && el.clientWidth <= 1 && el.clientHeight <= 1) return false;
    return true;
  };

  const plausible = (width: number, height: number): boolean =>
    width > 0 && height > 0 && width < MAX_RECT_PX && height < MAX_RECT_PX;

  const pushFragment = (
    text: string,
    left: number,
    top: number,
    right: number,
    bottom: number,
    size: number,
    shiftY: number,
  ): void => {
    if (fragments.length >= MAX_FRAGMENTS) {
      truncated = true;
      return;
    }
    const w = right - left;
    const h = bottom - top;
    if (!plausible(w, h)) return;
    // Whitespace is collapsed the way CSS collapses it, but a leading or
    // trailing space is *kept*. Two adjacent inline runs — "la palabra" and
    // a bold "información" — have no gap between their boxes, so a reader
    // copying them back out has nothing to insert a space from, and the
    // source's own space is the only thing that keeps "la palabra
    // información" from being copied as "la palabrainformación".
    const collapsed = text.replace(/\s+/g, " ");
    if (collapsed.trim().length === 0) return;
    fragments.push({
      text: collapsed,
      x: left - originX,
      y: top - originY + shiftY,
      w,
      h,
      size,
    });
  };

  // --- The walk -----------------------------------------------------------
  //
  // An explicit stack rather than a TreeWalker, because each frame has to
  // carry the vertical shift its subtree inherits from a viewport-anchored
  // ancestor, and a TreeWalker has no way to say "leaving this element".
  // Children are pushed in reverse so they come back off in document order,
  // which is the reading order the PDF gets.
  const fontSizes = new WeakMap<Element, number>();
  const stack: Array<{ node: Node; shiftY: number; fixed: boolean }> = [
    { node: root, shiftY: 0, fixed: false },
  ];
  const range = doc.createRange();

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    const node = frame.node;

    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.nodeValue ?? "";
      if (raw.trim().length === 0) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const size = fontSizes.get(parent) ?? 16;

      range.selectNodeContents(node);
      const rects = range.getClientRects();
      if (rects.length === 0) continue;

      if (rects.length === 1) {
        const r = rects[0];
        if (r) pushFragment(raw, r.left, r.top, r.right, r.bottom, size, frame.shiftY);
        continue;
      }

      // Wrapped. Measuring each word and regrouping is what keeps a
      // three-line paragraph three selectable lines instead of one
      // rectangle holding the whole string.
      if (raw.length > WORD_SPLIT_CHAR_LIMIT) {
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r) pushFragment(raw, r.left, r.top, r.right, r.bottom, size, frame.shiftY);
        }
        truncated = true;
        continue;
      }

      const words: Array<{ text: string; left: number; top: number; right: number; bottom: number }> = [];
      const pattern = /\S+/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(raw)) !== null) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const wordRects = range.getClientRects();
        const first = wordRects[0];
        if (!first) continue;
        words.push({
          text: match[0],
          left: first.left,
          top: first.top,
          right: first.right,
          bottom: first.bottom,
        });
      }

      const lines: Array<{ text: string; left: number; top: number; right: number; bottom: number }> = [];
      for (const word of words) {
        const current = lines[lines.length - 1];
        if (current && Math.abs(word.top - current.top) <= LINE_TOLERANCE_PX) {
          current.text += " " + word.text;
          current.left = Math.min(current.left, word.left);
          current.right = Math.max(current.right, word.right);
          current.top = Math.min(current.top, word.top);
          current.bottom = Math.max(current.bottom, word.bottom);
          continue;
        }
        lines.push({ ...word });
      }
      // The same reasoning as above, at the ends of a wrapped node.
      const firstLine = lines[0];
      const lastLine = lines[lines.length - 1];
      if (firstLine && /^\s/.test(raw)) firstLine.text = " " + firstLine.text;
      if (lastLine && /\s$/.test(raw)) lastLine.text += " ";
      for (const line of lines) {
        pushFragment(line.text, line.left, line.top, line.right, line.bottom, size, frame.shiftY);
      }
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    if (SKIP_TAGS.has(el.tagName)) continue;
    elementsVisited += 1;

    const style = win.getComputedStyle(el);
    if (!isRendered(el, style)) continue;

    fontSizes.set(el, parseFloat(style.fontSize) || 16);

    // A `position: fixed` subtree is placed from where it renders rather than
    // from where the document would put it, because that is what the
    // compositor kept. `sticky` is deliberately not treated this way: at the
    // top of the page a sticky element is still in its flow position, which
    // is exactly where the first band shows it.
    let shiftY = frame.shiftY;
    let fixed = frame.fixed;
    if (mode === "page" && style.position === "fixed" && !fixed) {
      const box = el.getBoundingClientRect();
      const anchor = classifyAnchor(box.top, box.bottom, box.width);
      // `+ win.scrollY` cancels the document origin folded into `originY`,
      // leaving a viewport-relative position; the bottom-anchored case then
      // moves it down to the band the compositor put it in.
      shiftY = win.scrollY + (anchor === "bottom" ? bottomAnchorShift : 0);
      fixed = true;
    }

    if (el.tagName === "A") {
      const href = (el as HTMLAnchorElement).href;
      if (isSupportedLinkUri(href)) {
        const boxes = el.getClientRects();
        for (let i = 0; i < boxes.length; i++) {
          const box = boxes[i];
          if (!box) continue;
          if (links.length >= MAX_LINKS) {
            truncated = true;
            break;
          }
          if (!plausible(box.width, box.height)) continue;
          links.push({
            uri: href,
            x: box.left - originX,
            y: box.top - originY + shiftY,
            w: box.width,
            h: box.height,
          });
        }
      }
    }

    const children = el.childNodes;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push({ node: child, shiftY, fixed });
    }

    // An open shadow root renders into the page, so its text is in the
    // screenshot and belongs in the layer. A closed one is not reachable
    // without breaking the guarantee the page asked for, and is documented as
    // a limitation instead.
    const shadow = el.shadowRoot;
    if (shadow) {
      const shadowChildren = shadow.childNodes;
      for (let i = shadowChildren.length - 1; i >= 0; i--) {
        const child = shadowChildren[i];
        if (child) stack.push({ node: child, shiftY, fixed });
      }
    }
  }

  return {
    fragments,
    links,
    stats: { elapsedMs: Date.now() - startedAt, elementsVisited, truncated },
  };
}
