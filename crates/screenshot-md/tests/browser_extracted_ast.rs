// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

//! Markdown export, end to end, from ASTs a real browser produced.
//!
//! The fixtures under `tests/fixtures/` are not hand-written. They are the
//! exact JSON the compiled `extractMarkdownAst` produced in a real Chromium
//! against `tests/pages/markdown-content.html` and
//! `tests/pages/pdf-text-acceptance.html` — and produced the way Chrome runs
//! it, by re-evaluating the function's own source with no module scope, so
//! what is captured is the payload the extension actually sends.
//!
//! These tests then check the half that runs in Rust: that the payload
//! becomes Markdown a person would keep. The three defects they exist for
//! were all found by exporting that second page and reading the result —
//! hidden text in the file, prose indented into code blocks, and links that
//! only worked on the site they came from.

use screenshot_md::writer::{write_markdown_with_frontmatter, DocumentMeta};
use screenshot_md::Document;

const MARKDOWN_CONTENT_AST: &str = include_str!("fixtures/markdown-content-ast.json");
const ACCEPTANCE_AST: &str = include_str!("fixtures/pdf-text-acceptance-ast.json");

const CONTENT_SOURCE: &str = "http://127.0.0.1:8899/tests/pages/markdown-content.html";
const ACCEPTANCE_SOURCE: &str = "http://127.0.0.1:8899/tests/pages/pdf-text-acceptance.html";

fn render(json: &str, title: &str, source: &str) -> String {
    let doc = Document::from_untrusted_json(json).expect("real browser AST must parse");
    write_markdown_with_frontmatter(
        &doc,
        &DocumentMeta {
            title: title.to_string(),
            source: source.to_string(),
            captured_at: "2026-09-19T00:00:00Z".to_string(),
        },
    )
}

fn content_markdown() -> String {
    render(
        MARKDOWN_CONTENT_AST,
        "Markdown export fixture",
        CONTENT_SOURCE,
    )
}

fn acceptance_markdown() -> String {
    render(
        ACCEPTANCE_AST,
        "Aceptación del PDF con texto buscable",
        ACCEPTANCE_SOURCE,
    )
}

/// The document after its YAML frontmatter — what Markdown's block rules
/// actually apply to.
fn body(markdown: &str) -> String {
    markdown
        .splitn(3, "---\n")
        .nth(2)
        .expect("frontmatter must be present")
        .to_string()
}

// --- Structure that already worked, and must keep working -----------------

#[test]
fn the_document_keeps_its_frontmatter_and_structure() {
    let md = content_markdown();
    assert!(md.starts_with("---\n"), "must start with YAML frontmatter");
    for field in [
        "title:",
        "source:",
        "captured_at:",
        "generator:",
        "repository:",
    ] {
        assert!(md.contains(field), "frontmatter lost {field}");
    }
    assert!(md.contains("# Markdown export fixture"));
    assert!(md.contains("**DOM-to-Markdown**"));
    assert!(md.contains("_emphasis_"));
    assert!(md.contains("- First item"));
    assert!(md.contains("- Second item"));
    assert!(md.contains("| Name | Value |"));
    assert!(md.contains("| --- | --- |"));
    assert!(md.contains("| Alpha | 1 |"));
    assert!(md.contains("> A quoted paragraph."));
}

#[test]
fn unsafe_schemes_keep_their_text_and_lose_their_link() {
    let md = content_markdown();
    assert!(
        !md.contains("javascript:"),
        "the javascript: link must be stripped"
    );
    assert!(md.contains("dangerous link"), "but its text must survive");

    let acceptance = acceptance_markdown();
    assert!(!acceptance.contains("javascript:"));
    assert!(!acceptance.contains("](data:"));
    // Their visible text is still part of the page, so it is still exported.
    assert!(acceptance.contains("acción de página"));
    assert!(acceptance.contains("recurso incrustado"));
    // mailto: is portable in a Markdown file and is kept, deliberately —
    // unlike in a PDF annotation, where V1 does not offer it.
    assert!(acceptance.contains("[correo](mailto:nadie@example.com)"));
}

// --- M1: hidden content ---------------------------------------------------

#[test]
fn text_the_page_never_showed_is_not_in_the_markdown() {
    let md = acceptance_markdown();
    // The fixture hides these five ways: a screen-reader-only clipped box,
    // display:none, visibility:hidden, opacity:0 and the hidden attribute.
    assert!(
        !md.contains("no debe aparecer"),
        "hidden text leaked into the export:\n{md}"
    );
    assert_eq!(md.matches("no debe aparecer").count(), 0);
}

#[test]
fn every_way_of_hiding_an_element_is_honoured() {
    let md = content_markdown();
    for hidden in [
        "Hidden by display none.",
        "Hidden by visibility hidden.",
        "Hidden by zero opacity.",
        "Hidden by the hidden attribute.",
        "Hidden by content-visibility.",
        "Hidden for screen readers only.",
        "collapsed away",
    ] {
        assert!(!md.contains(hidden), "{hidden:?} should not be exported");
    }
    // …and the visible sibling in the same table is still there, so the
    // filter is not simply dropping everything it touches.
    assert!(md.contains("| kept |"));
    assert!(md.contains("Content the reader cannot see"));
}

// --- M2: whitespace -------------------------------------------------------

/// CommonMark starts an indented code block at a line indented four spaces.
/// A page's HTML source indentation reaches the text nodes verbatim, so
/// without normalisation an ordinary paragraph becomes a code block — which
/// is exactly what the owner found in the exported file.
#[test]
fn no_prose_line_is_indented_enough_to_become_a_code_block() {
    for md in [content_markdown(), acceptance_markdown()] {
        let mut inside_fence = false;
        for (number, line) in body(&md).lines().enumerate() {
            if line.trim_start().starts_with("```") {
                inside_fence = !inside_fence;
                continue;
            }
            if inside_fence {
                continue;
            }
            assert!(
                !line.starts_with("    "),
                "line {} would be read as a code block: {line:?}",
                number + 1
            );
        }
    }
}

#[test]
fn a_paragraph_is_one_line_with_its_inline_spacing_intact() {
    let md = acceptance_markdown();
    assert!(
        md.contains(
            "Este párrafo abre el documento y contiene la palabra **información** en negrita, \
             la palabra _auditoría_ en cursiva y el término técnico `señal`."
        ),
        "the opening paragraph did not survive as one clean line:\n{md}"
    );
    // The space either side of an inline boundary is the difference between
    // "la palabra **información** en" and "la palabra**información**en".
    assert!(!md.contains("palabra**"));
    assert!(!md.contains("**en negrita"));
}

#[test]
fn no_line_carries_trailing_whitespace() {
    for md in [content_markdown(), acceptance_markdown()] {
        for (number, line) in md.lines().enumerate() {
            assert_eq!(
                line,
                line.trim_end(),
                "line {} has trailing whitespace: {line:?}",
                number + 1
            );
        }
    }
}

#[test]
fn blocks_are_separated_by_exactly_one_blank_line() {
    for md in [content_markdown(), acceptance_markdown()] {
        assert!(
            !body(&md).contains("\n\n\n"),
            "more than one blank line between blocks:\n{md}"
        );
    }
}

// --- M2: preformatted content is not prose --------------------------------

#[test]
fn preformatted_indentation_is_preserved_exactly() {
    let md = content_markdown();
    // A code block whose own indentation the reader can see. Collapsing
    // prose must not reach inside it.
    assert!(md.contains("fn outer() {\n    let indented = 1;\n        let deeper = 2;\n}"));
    // …including a <pre> with no <code> inside it.
    assert!(md.contains("  two leading spaces\n      six leading spaces"));
    // And the single-line code block still round-trips.
    assert!(md.contains("```rust\nfn main() { println!(\"hi\"); }\n```"));
}

#[test]
fn inline_code_keeps_its_text() {
    assert!(acceptance_markdown().contains("`señal`"));
}

// --- M3: portable links ---------------------------------------------------

#[test]
fn every_link_in_the_export_is_absolute() {
    for md in [content_markdown(), acceptance_markdown()] {
        for target in link_targets(&md) {
            assert!(
                target.contains(':'),
                "a link with no scheme cannot be followed from a saved file: {target:?}"
            );
        }
    }
}

#[test]
fn relative_hrefs_are_resolved_against_the_document() {
    let md = content_markdown();
    // Site-relative.
    assert!(
        md.contains("[site-relative link](http://127.0.0.1:8899/informes/2026)"),
        "{md}"
    );
    // Parent-relative: resolved by the browser, never concatenated here.
    assert!(
        md.contains("[parent-relative link](http://127.0.0.1:8899/tests/sibling/page.html)"),
        "{md}"
    );
    // A bare fragment becomes the document's own URL plus the fragment, which
    // is what makes it mean anything once the file has moved.
    assert!(
        md.contains(
            "[fragment link](http://127.0.0.1:8899/tests/pages/markdown-content.html#a-list)"
        ),
        "{md}"
    );

    // The link the owner reported, in the page they reported it from.
    assert!(
        acceptance_markdown().contains("[informes de 2026](http://127.0.0.1:8899/informes/2026)"),
        "the relative link is still site-relative"
    );
}

#[test]
fn absolute_urls_are_left_alone() {
    let md = acceptance_markdown();
    assert!(md.contains("[documento de origen](https://example.com/principio)"));
    assert!(md.contains("[referencia final](https://example.com/final)"));
    assert!(md.contains(
        "[referencia extensa que ocupa más de una línea completa](https://example.com/una/ruta/bastante/larga/para/partirse)"
    ));
}

/// Every `](target)` in the document.
fn link_targets(markdown: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = markdown;
    while let Some(at) = rest.find("](") {
        rest = &rest[at + 2..];
        if let Some(end) = rest.find(')') {
            out.push(rest[..end].to_string());
            rest = &rest[end..];
        } else {
            break;
        }
    }
    out
}

// --- The whole file, as a person would read it ----------------------------

#[test]
fn the_acceptance_page_exports_the_document_it_shows() {
    let md = acceptance_markdown();
    assert!(md.contains("# Información de auditoría del Perú"));
    assert!(md.contains("## Texto que se parte en varias líneas"));
    assert!(md.contains("## Acentos, eñes y diéresis"));
    assert!(md.contains("información · auditoría · Perú · señal · ñandú · Ñuñoa · pingüino · Über"));
    assert!(md.contains("Marcador intermedio"));
    assert!(md.contains("Marcador inferior"));
    assert!(md.contains("Última línea del documento de aceptación."));
    // Document order, as the page has it.
    let position = |needle: &str| {
        md.find(needle)
            .unwrap_or_else(|| panic!("{needle} missing"))
    };
    assert!(position("# Información de auditoría del Perú") < position("Marcador intermedio"));
    assert!(position("Marcador intermedio") < position("Marcador inferior"));
    assert!(position("Marcador inferior") < position("Última línea del documento"));
}

#[test]
fn nothing_in_the_export_looks_like_a_dom_artefact() {
    for md in [content_markdown(), acceptance_markdown()] {
        for artefact in [
            "[object Object]",
            "undefined",
            "null",
            "NaN",
            "<div",
            "</p>",
        ] {
            assert!(
                !md.contains(artefact),
                "{artefact:?} leaked into the export"
            );
        }
    }
}
