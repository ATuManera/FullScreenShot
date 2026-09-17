# ADR-0005: Markdown from a semantic DOM AST, not OCR or raw innerHTML

## Status

Accepted (P3)

## Context

Section 19 of the project brief is explicit that Markdown must come from
the DOM, not from running OCR against the rendered PNG, and that raw
`innerHTML` must never be handed to the Rust core (untrusted-input
boundary, section 22).

## Decision

The content script walks the live DOM and builds a JSON tree matching
`screenshot_md::ast::Node`/`Document` (P0), then sends that JSON across
the WASM boundary. `screenshot-md` gains a JSON→AST parser
(`Document::from_untrusted_json`) that validates structure explicitly and
returns a `CoreError` rather than panicking on anything unexpected —
every field is treated as attacker-controlled, consistent with the
extension's threat model (`SECURITY.md`: "untrusted serialized AST").
`sanitize_href` (P0) continues to run inside Rust on every link, not in
the content script, so sanitization can't be bypassed by a malformed AST
that skips the content script's own logic.

## Alternatives considered

- **OCR the composed PNG:** rejected outright per the project brief —
  lossy, slow, and produces unstructured text instead of semantic
  Markdown (headings, lists, tables, links).
- **Send raw `innerHTML` to Rust and parse HTML there:** rejected — pulls
  in an HTML parser dependency into the trusted core for no benefit (the
  browser has already parsed the DOM; re-parsing serialized HTML is
  redundant work and a larger attack surface) and violates the "don't
  hand untrusted HTML to internal pages" spirit of section 22.
- **Pass the AST as structured wasm-bindgen objects instead of JSON:**
  rejected for P3 — `wasm-bindgen`'s object marshalling for deeply nested
  recursive enums is significantly more complex than validating one JSON
  payload at a single entry point, for no correctness benefit here.

## Consequences

- The content script owns DOM traversal and the Article/Full-DOM content
  heuristic; Rust owns validation, sanitization, and deterministic
  Markdown rendering — the same "browser glue vs. core logic" split as
  ADR-0001.
- Any DOM node type without an AST equivalent (canvas, WebGL, video) is
  represented as a textual placeholder rather than silently dropped or
  causing a parse failure.
