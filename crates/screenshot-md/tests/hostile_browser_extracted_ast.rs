// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday
//
// Same approach as browser_extracted_ast.rs, but against
// tests/pages/hostile-content.html: deliberately adversarial markup
// (javascript: and data: links/image srcs, whitespace-obfuscated
// javascript:, an onclick handler, script/style/iframe/canvas tags).
// Captured verbatim from a real Chromium run of the compiled
// extractMarkdownAst (see the P5 design spec). In that same browser
// session, window.__fss_hostile_onclick_ran was confirmed still `false`
// after extraction (the extractor never triggers attribute-based
// handlers — it only reads getAttribute("href"/"src"), never invokes
// anything), and the extracted AST contains no Script/Style/Iframe/
// Canvas node at all (BLOCK_TAGS filtering, verified structurally here
// as a byte-for-byte absence check on the raw JSON too).

use screenshot_md::writer::{write_markdown_with_frontmatter, DocumentMeta};
use screenshot_md::Document;

const HOSTILE_JSON: &str = "{\"children\":[{\"type\":\"Heading\",\"value\":{\"level\":1,\"children\":[{\"type\":\"Text\",\"value\":\"Hostile content fixture\"}]}},{\"type\":\"Paragraph\",\"value\":[{\"type\":\"Text\",\"value\":\"Exercises the Markdown extractor and sanitizer against\\n    deliberately adversarial markup — none of this should ever execute,\\n    and dangerous URLs must be stripped while surrounding text survives.\"}]},{\"type\":\"Paragraph\",\"value\":[{\"type\":\"Text\",\"value\":\"\\n      A \"},{\"type\":\"Link\",\"value\":{\"href\":\"javascript:alert(document.cookie)\",\"children\":[{\"type\":\"Text\",\"value\":\"javascript: link\"}]}},{\"type\":\"Text\",\"value\":\",\\n      a \"},{\"type\":\"Link\",\"value\":{\"href\":\"data:text/html,<script>alert(1)</script>\",\"children\":[{\"type\":\"Text\",\"value\":\"data: HTML link\"}]}},{\"type\":\"Text\",\"value\":\",\\n      a \"},{\"type\":\"Link\",\"value\":{\"href\":\"  \\tjava\\nscript:alert(1)\",\"children\":[{\"type\":\"Text\",\"value\":\"whitespace-obfuscated javascript: link\"}]}},{\"type\":\"Text\",\"value\":\",\\n      and a \"},{\"type\":\"Link\",\"value\":{\"href\":\"https://example.com/safe\",\"children\":[{\"type\":\"Text\",\"value\":\"perfectly safe link\"}]}},{\"type\":\"Text\",\"value\":\".\\n    \"}]},{\"type\":\"Paragraph\",\"value\":[{\"type\":\"Text\",\"value\":\"\\n      An image with a hostile src:\\n      \"},{\"type\":\"Image\",\"value\":{\"src\":\"javascript:alert(1)\",\"alt\":\"hostile image alt text\"}},{\"type\":\"Text\",\"value\":\"\\n      and one with a hostile data URL:\\n      \"},{\"type\":\"Image\",\"value\":{\"src\":\"data:text/html,<script>alert(1)</script>\",\"alt\":\"hostile data url alt text\"}},{\"type\":\"Text\",\"value\":\"\\n      and one that is legitimately fine:\\n      \"},{\"type\":\"Image\",\"value\":{\"src\":\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E\",\"alt\":\"legit inline svg\"}},{\"type\":\"Text\",\"value\":\"\\n    \"}]},{\"type\":\"Paragraph\",\"value\":[{\"type\":\"Text\",\"value\":\"Attribute-based event handler that must never fire from static extraction:\\n      \"},{\"type\":\"Text\",\"value\":\"click me (should stay inert)\"},{\"type\":\"Text\",\"value\":\"\\n    \"}]},{\"type\":\"BlockQuote\",\"value\":[{\"type\":\"Paragraph\",\"value\":[{\"type\":\"Text\",\"value\":\"Nested \"},{\"type\":\"Strong\",\"value\":[{\"type\":\"Text\",\"value\":\"formatting \"},{\"type\":\"Emphasis\",\"value\":[{\"type\":\"Text\",\"value\":\"inside\"}]},{\"type\":\"Text\",\"value\":\" a blockquote\"}]},{\"type\":\"Text\",\"value\":\" with a\\n      \"},{\"type\":\"Link\",\"value\":{\"href\":\"javascript:void(0)\",\"children\":[{\"type\":\"Text\",\"value\":\"dangerous link inside a blockquote\"}]}},{\"type\":\"Text\",\"value\":\".\"}]}]}]}";

#[test]
fn hostile_json_contains_no_script_style_iframe_or_canvas_node() {
    // The extractor's BLOCK_TAGS filtering already excludes these at the
    // DOM-walk stage — this asserts that exclusion actually reached the
    // wire payload, not just the in-page object.
    assert!(!HOSTILE_JSON.contains("\"Script\""));
    assert!(!HOSTILE_JSON.contains("\"Style\""));
    assert!(!HOSTILE_JSON.contains("\"Iframe\""));
    assert!(!HOSTILE_JSON.contains("\"Canvas\""));
    assert!(!HOSTILE_JSON.contains("onclick"));
}

#[test]
fn parses_hostile_ast_without_error() {
    Document::from_untrusted_json(HOSTILE_JSON)
        .expect("hostile but structurally valid AST must still parse");
}

#[test]
fn final_markdown_strips_every_dangerous_url_but_keeps_all_safe_content() {
    let doc = Document::from_untrusted_json(HOSTILE_JSON).unwrap();
    let meta = DocumentMeta {
        title: "Hostile content fixture".to_string(),
        source: "https://example.com/hostile-content.html".to_string(),
        captured_at: "2026-09-17T00:00:00Z".to_string(),
    };
    let md = write_markdown_with_frontmatter(&doc, &meta);

    // No dangerous scheme survives as an actual clickable Markdown link
    // or image target — as opposed to the harmless, literal descriptive
    // *label* text "javascript: link" the fixture also has, which is
    // expected to survive since only the href/src is dangerous, not the
    // visible text naming it.
    assert!(
        !md.contains("](javascript:"),
        "javascript: scheme leaked into a Markdown link/image target:\n{md}"
    );
    assert!(
        !md.contains("](data:text/html"),
        "data:text/html scheme leaked into a Markdown link/image target:\n{md}"
    );
    assert!(
        !md.contains("<script>"),
        "raw <script> tag content leaked into output:\n{md}"
    );
    assert!(
        !md.contains("document.cookie"),
        "javascript: payload leaked into output:\n{md}"
    );

    // The safe link is preserved as a real Markdown link.
    assert!(md.contains("[perfectly safe link](https://example.com/safe)"));

    // Dangerous link/image text content survives (only the danger is stripped).
    assert!(md.contains("javascript: link"));
    assert!(md.contains("data: HTML link"));
    assert!(md.contains("whitespace-obfuscated javascript: link"));
    assert!(md.contains("hostile image alt text"));
    assert!(md.contains("hostile data url alt text"));
    assert!(md.contains("dangerous link inside a blockquote"));

    // The legitimate inline SVG data: image URL is preserved as a real image.
    assert!(md.contains("![legit inline svg](data:image/svg+xml"));

    // The onclick handler's attribute value never appears — only its
    // element's inert text content does.
    assert!(!md.contains("__fss_hostile_onclick_ran"));
    assert!(md.contains("click me (should stay inert)"));

    // Nested formatting inside the blockquote still renders correctly.
    assert!(md.contains("> Nested **formatting _inside_ a blockquote** with a"));
}
