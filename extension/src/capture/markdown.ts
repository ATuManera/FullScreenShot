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
 */

export type MarkdownMode = "article" | "full-dom";

/* eslint-disable @typescript-eslint/no-explicit-any -- AST nodes are a
   JSON-shaped union produced for cross-boundary serialization; typing it
   precisely here would duplicate screenshot_md::ast::Node without any
   safety benefit, since the real validation happens in Rust. */
export function extractMarkdownAst(mode: MarkdownMode): { children: unknown[] } {
  const BLOCK_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "CANVAS", "SVG", "VIDEO", "AUDIO", "OBJECT", "EMBED"]);

  function textNode(text: string): unknown {
    return { type: "Text", value: text };
  }

  function inlineChildren(el: Element): unknown[] {
    const out: unknown[] = [];
    el.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text.trim().length > 0 || out.length > 0) {
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
          const href = childEl.getAttribute("href") ?? "";
          out.push({ type: "Link", value: { href, children: inlineChildren(childEl) } });
          break;
        }
        case "IMG": {
          const src = childEl.getAttribute("src") ?? "";
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
      if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === "LI") {
        items.push({ type: "ListItem", value: blockChildren(child as Element) });
      }
    });
    return items;
  }

  function tableRows(el: Element): unknown[] {
    const rows: unknown[] = [];
    el.querySelectorAll(":scope tr").forEach((tr) => {
      const cells: unknown[] = [];
      tr.querySelectorAll(":scope th, :scope td").forEach((cell) => {
        cells.push({ type: "TableCell", value: inlineChildren(cell) });
      });
      rows.push({ type: "TableRow", value: cells });
    });
    return rows;
  }

  function blockChildren(el: Element): unknown[] {
    const out: unknown[] = [];
    el.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text.trim().length > 0) {
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
      switch (tag) {
        case "H1":
        case "H2":
        case "H3":
        case "H4":
        case "H5":
        case "H6":
          out.push({ type: "Heading", value: { level: Number(tag[1]), children: inlineChildren(childEl) } });
          break;
        case "P":
          out.push({ type: "Paragraph", value: inlineChildren(childEl) });
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
