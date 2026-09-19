// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * DOM → AST extraction for Markdown export. The JSON shape produced here
 * must match `screenshot_md::ast::Node`'s serde (adjacently-tagged,
 * `{"type": ..., "value": ...}`) representation exactly — verified
 * against the real Rust output (see the P3 design spec) rather than
 * assumed, since unit variants like HorizontalRule serialize as
 * `{"type":"HorizontalRule"}` with no "value" field at all.
 *
 * Like injectable.ts / selection.ts, `extractMarkdownAst` is
 * self-contained for `chrome.scripting.executeScript({ func })`
 * injection: no imports, only its own locals/params and DOM globals.
 * `injectableSelfContainment.test.js` enforces that; the visibility and
 * whitespace rules below are therefore inlined copies of
 * `visibility.ts`'s `isRenderedForExport` / `preservesWhitespace`, which
 * are the unit-tested statements of them and must be kept in step.
 */

export type MarkdownMode = "article" | "full-dom";

/* eslint-disable @typescript-eslint/no-explicit-any -- AST nodes are a
   JSON-shaped union produced for cross-boundary serialization; typing it
   precisely here would duplicate screenshot_md::ast::Node without any
   safety benefit, since the real validation happens in Rust. */
export function extractMarkdownAst(mode: MarkdownMode): { children: unknown[] } {
  const BLOCK_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "CANVAS", "SVG", "VIDEO", "AUDIO", "OBJECT", "EMBED"]);
  const win = window;

  /** Inlined from `visibility.ts`'s `isRenderedForExport` — see this file's header. */
  function isRendered(el: Element): boolean {
    const style = win.getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (style.opacity === "0") return false;
    if (style.contentVisibility === "hidden") return false;
    if ((el as HTMLElement).hidden) return false;
    const clipped =
      style.overflow === "hidden" ||
      (style.clip !== "auto" && style.clip !== "") ||
      (style.clipPath !== "none" && style.clipPath !== "");
    if (clipped && el.clientWidth <= 1 && el.clientHeight <= 1) return false;
    return true;
  }

  /** Inlined from `visibility.ts`'s `preservesWhitespace`. */
  function preformatted(el: Element): boolean {
    const ws = win.getComputedStyle(el).whiteSpace;
    return ws.startsWith("pre") || ws === "break-spaces";
  }

  function textNode(text: string): unknown {
    return { type: "Text", value: text };
  }

  /**
   * A page's HTML source indentation arrives in text nodes verbatim, and in
   * Markdown four leading spaces is a code block — so prose has to be
   * collapsed the way CSS collapses it before it is written out. The single
   * space that a run collapses to is not incidental: it is what keeps
   * "la palabra <strong>información</strong>" from exporting as
   * "la palabra**información**".
   */
  function collapse(text: string): string {
    return text.replace(/\s+/g, " ");
  }

  /**
   * Drops the whitespace at a block's two ends, which is the page's
   * indentation rather than anything the reader sees. Done on the finished
   * child list, so a space *between* two inline children still survives.
   */
  function trimEdges(nodes: unknown[]): unknown[] {
    const isText = (n: unknown): n is { type: string; value: string } =>
      typeof n === "object" && n !== null && (n as { type?: string }).type === "Text";
    const first = nodes[0];
    if (isText(first)) first.value = first.value.replace(/^\s+/, "");
    const last = nodes[nodes.length - 1];
    if (isText(last)) last.value = last.value.replace(/\s+$/, "");
    return nodes.filter((n) => !(isText(n) && n.value.length === 0));
  }

  function inlineChildren(el: Element): unknown[] {
    const keepWhitespace = preformatted(el);
    const out: unknown[] = [];
    el.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const raw = child.textContent ?? "";
        const text = keepWhitespace ? raw : collapse(raw);
        if (raw.trim().length > 0 || out.length > 0) {
          out.push(textNode(text));
        }
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        return;
      }
      const childEl = child as Element;
      const tag = childEl.tagName;
      if (BLOCK_TAGS.has(tag)) {
        return;
      }
      if (!isRendered(childEl)) {
        return;
      }
      switch (tag) {
        case "STRONG":
        case "B":
          out.push({ type: "Strong", value: inlineChildren(childEl) });
          break;
        case "EM":
        case "I":
          out.push({ type: "Emphasis", value: inlineChildren(childEl) });
          break;
        case "A": {
          // The browser's resolved URL, not the raw attribute. An exported
          // .md is read somewhere else, where "/informes/2026" points at
          // nothing; `href` gives the absolute URL the browser itself would
          // follow, without this code ever concatenating a base by hand.
          const href = (childEl as HTMLAnchorElement).href || (childEl.getAttribute("href") ?? "");
          out.push({ type: "Link", value: { href, children: trimEdges(inlineChildren(childEl)) } });
          break;
        }
        case "IMG": {
          const src = (childEl as HTMLImageElement).src || (childEl.getAttribute("src") ?? "");
          const alt = childEl.getAttribute("alt") ?? "";
          out.push({ type: "Image", value: { src, alt } });
          break;
        }
        case "CODE":
          out.push({ type: "Code", value: childEl.textContent ?? "" });
          break;
        case "BR":
          out.push(textNode("\n"));
          break;
        default:
          out.push(...inlineChildren(childEl));
      }
    });
    return out;
  }

  function listItems(el: Element): unknown[] {
    const items: unknown[] = [];
    el.childNodes.forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE || (child as Element).tagName !== "LI") {
        return;
      }
      // A list item reaches the AST through `listItems` rather than through
      // the element branch of `blockChildren`, so it needs the visibility
      // check applied here or a hidden item walks straight past it.
      if (!isRendered(child as Element)) {
        return;
      }
      items.push({ type: "ListItem", value: blockChildren(child as Element) });
    });
    return items;
  }

  function tableRows(el: Element): unknown[] {
    const rows: unknown[] = [];
    el.querySelectorAll(":scope tr").forEach((tr) => {
      // Same reasoning as `listItems`: rows and cells are collected by
      // selector, not walked, so the check belongs on each of them. A
      // `visibility: collapse` row or cell is removed from the rendered
      // table, and must be removed from the exported one.
      if (!isRendered(tr)) {
        return;
      }
      const cells: unknown[] = [];
      tr.querySelectorAll(":scope th, :scope td").forEach((cell) => {
        // An unrendered *cell* still occupies its column in the rendered
        // table, so it is emitted empty rather than dropped — dropping it
        // would shift every cell after it into the wrong column. An
        // unrendered *row* is gone from the table entirely, and is skipped
        // above.
        cells.push({ type: "TableCell", value: isRendered(cell) ? trimEdges(inlineChildren(cell)) : [] });
      });
      rows.push({ type: "TableRow", value: cells });
    });
    return rows;
  }

  function blockChildren(el: Element): unknown[] {
    const keepWhitespace = preformatted(el);
    const out: unknown[] = [];
    el.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const raw = child.textContent ?? "";
        if (raw.trim().length > 0) {
          const text = keepWhitespace ? raw : collapse(raw).trim();
          out.push({ type: "Paragraph", value: [textNode(text)] });
        }
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        return;
      }
      const childEl = child as Element;
      const tag = childEl.tagName;
      if (BLOCK_TAGS.has(tag)) {
        return;
      }
      if (!isRendered(childEl)) {
        return;
      }
      switch (tag) {
        case "H1":
        case "H2":
        case "H3":
        case "H4":
        case "H5":
        case "H6":
          out.push({ type: "Heading", value: { level: Number(tag[1]), children: trimEdges(inlineChildren(childEl)) } });
          break;
        case "P":
          out.push({ type: "Paragraph", value: trimEdges(inlineChildren(childEl)) });
          break;
        case "UL":
          out.push({ type: "UnorderedList", value: listItems(childEl) });
          break;
        case "OL":
          out.push({ type: "OrderedList", value: listItems(childEl) });
          break;
        case "TABLE":
          out.push({ type: "Table", value: { rows: tableRows(childEl) } });
          break;
        case "BLOCKQUOTE":
          out.push({ type: "BlockQuote", value: blockChildren(childEl) });
          break;
        case "PRE": {
          const codeEl = childEl.querySelector("code");
          const lang = codeEl?.className.match(/language-(\S+)/)?.[1] ?? null;
          out.push({ type: "CodeBlock", value: { lang, code: (codeEl ?? childEl).textContent ?? "" } });
          break;
        }
        case "HR":
          out.push({ type: "HorizontalRule" });
          break;
        case "IMG": {
          const src = childEl.getAttribute("src") ?? "";
          const alt = childEl.getAttribute("alt") ?? "";
          out.push({ type: "Paragraph", value: [{ type: "Image", value: { src, alt } }] });
          break;
        }
        default:
          out.push(...blockChildren(childEl));
      }
    });
    return out;
  }

  const root = mode === "article" ? (document.querySelector("article, main") ?? document.body) : document.body;
  return { children: root ? blockChildren(root) : [] };
}
