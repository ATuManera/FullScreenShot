// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday
//
// Integration test using a JSON AST captured verbatim from a real
// Chromium browser (via Playwright) running the compiled
// `extractMarkdownAst` from extension/src/capture/markdown.ts against
// tests/pages/markdown-content.html in "article" mode — see the P3
// design spec's verification section. This is not hand-written JSON: it
// is the actual cross-boundary payload the extension will send, so this
// test exercises the untrusted-JSON parser and the writer together
// against real browser output, not just synthetic Rust-constructed ASTs.

use screenshot_md::writer::{write_markdown_with_frontmatter, DocumentMeta};
use screenshot_md::Document;

const BROWSER_EXTRACTED_JSON: &str = r#"{"children":[{"type":"Heading","value":{"level":1,"children":[{"type":"Text","value":"Markdown export fixture"}]}},{"type":"Paragraph","value":[{"type":"Text","value":"This page exercises the "},{"type":"Strong","value":[{"type":"Text","value":"DOM-to-Markdown"}]},{"type":"Text","value":" AST\n    extraction and writer: "},{"type":"Emphasis","value":[{"type":"Text","value":"emphasis"}]},{"type":"Text","value":", a\n    "},{"type":"Link","value":{"href":"https://example.com","children":[{"type":"Text","value":"safe link"}]}},{"type":"Text","value":", and a\n    "},{"type":"Link","value":{"href":"javascript:alert(1)","children":[{"type":"Text","value":"dangerous link"}]}},{"type":"Text","value":" that must be\n    sanitized."}]},{"type":"Heading","value":{"level":2,"children":[{"type":"Text","value":"A list"}]}},{"type":"UnorderedList","value":[{"type":"ListItem","value":[{"type":"Paragraph","value":[{"type":"Text","value":"First item"}]}]},{"type":"ListItem","value":[{"type":"Paragraph","value":[{"type":"Text","value":"Second item"}]}]}]},{"type":"Heading","value":{"level":2,"children":[{"type":"Text","value":"A table"}]}},{"type":"Table","value":{"rows":[{"type":"TableRow","value":[{"type":"TableCell","value":[{"type":"Text","value":"Name"}]},{"type":"TableCell","value":[{"type":"Text","value":"Value"}]}]},{"type":"TableRow","value":[{"type":"TableCell","value":[{"type":"Text","value":"Alpha"}]},{"type":"TableCell","value":[{"type":"Text","value":"1"}]}]},{"type":"TableRow","value":[{"type":"TableCell","value":[{"type":"Text","value":"Beta"}]},{"type":"TableCell","value":[{"type":"Text","value":"2"}]}]}]}},{"type":"Heading","value":{"level":2,"children":[{"type":"Text","value":"Code"}]}},{"type":"CodeBlock","value":{"lang":"rust","code":"fn main() { println!(\"hi\"); }"}},{"type":"BlockQuote","value":[{"type":"Paragraph","value":[{"type":"Text","value":"A quoted paragraph."}]}]}]}"#;

#[test]
fn parses_real_browser_extracted_ast_without_error() {
    let doc =
        Document::from_untrusted_json(BROWSER_EXTRACTED_JSON).expect("real browser AST must parse");
    assert_eq!(doc.children.len(), 9);
}

#[test]
fn renders_real_browser_extracted_ast_correctly() {
    let doc = Document::from_untrusted_json(BROWSER_EXTRACTED_JSON).unwrap();
    let meta = DocumentMeta {
        title: "Markdown export fixture".to_string(),
        source: "https://example.com/markdown-content.html".to_string(),
        captured_at: "2026-09-17T00:00:00Z".to_string(),
    };
    let md = write_markdown_with_frontmatter(&doc, &meta);

    assert!(md.starts_with("---\n"), "must start with YAML frontmatter");
    assert!(md.contains("# Markdown export fixture"));
    assert!(md.contains("**DOM-to-Markdown**"));
    assert!(md.contains("_emphasis_"));
    assert!(md.contains("[safe link](https://example.com)"));
    assert!(
        !md.contains("javascript:"),
        "the javascript: link must be stripped"
    );
    assert!(md.contains("dangerous link"), "but its text must survive");
    assert!(md.contains("- First item"));
    assert!(md.contains("- Second item"));
    assert!(md.contains("| Name | Value |"));
    assert!(md.contains("| --- | --- |"));
    assert!(md.contains("| Alpha | 1 |"));
    assert!(md.contains("| Beta | 2 |"));
    assert!(md.contains("```rust"));
    assert!(md.contains("fn main() { println!(\"hi\"); }"));
    assert!(md.contains("> A quoted paragraph."));
}
