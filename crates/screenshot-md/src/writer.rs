// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use crate::ast::{Document, Node};
use crate::sanitizer::{sanitize_href, sanitize_image_src};

/// YAML frontmatter fields for the exported Markdown file (spec section 19).
#[derive(Debug, Clone, Default)]
pub struct DocumentMeta {
    pub title: String,
    pub source: String,
    pub captured_at: String,
}

const GENERATOR: &str = "FullScreenShot";
const REPOSITORY: &str = "https://github.com/ATuManera/FullScreenShot";

fn yaml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn write_frontmatter(meta: &DocumentMeta) -> String {
    format!(
        "---\ntitle: \"{}\"\nsource: \"{}\"\ncaptured_at: \"{}\"\ngenerator: \"{GENERATOR}\"\nrepository: \"{REPOSITORY}\"\n---\n\n",
        yaml_escape(&meta.title),
        yaml_escape(&meta.source),
        yaml_escape(&meta.captured_at),
    )
}

/// Renders the document, with exactly one blank line between blocks.
///
/// Separation is applied here rather than left to each renderer, because the
/// renderers disagreed: a paragraph ended with one newline and a list or a
/// table with two, so the same document came out with uneven gaps depending
/// on what it contained. Trimming each block's own trailing newlines and
/// joining with a blank line makes the spacing a property of the document
/// instead of a property of the last node type.
///
/// Only *trailing* newlines are trimmed, so the blank lines inside a fenced
/// code block — where they are content — survive untouched.
pub fn write_markdown(doc: &Document) -> String {
    let mut blocks: Vec<String> = Vec::with_capacity(doc.children.len());
    for node in &doc.children {
        let mut rendered = String::new();
        render_node(node, &mut rendered);
        let trimmed = rendered.trim_end_matches('\n');
        if !trimmed.is_empty() {
            blocks.push(trimmed.to_string());
        }
    }
    let mut out = blocks.join("\n\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out
}

pub fn write_markdown_with_frontmatter(doc: &Document, meta: &DocumentMeta) -> String {
    let mut out = write_frontmatter(meta);
    out.push_str(&write_markdown(doc));
    out
}

fn render_children(children: &[Node], out: &mut String) {
    for child in children {
        render_node(child, out);
    }
}

fn render_children_to_string(children: &[Node]) -> String {
    let mut out = String::new();
    render_children(children, &mut out);
    out
}

/// Makes rendered inline content safe to stand as a Markdown block.
///
/// Four leading spaces on a line is an indented code block in CommonMark, and
/// a page's own HTML source indentation reaches the AST inside text nodes —
/// so without this, an ordinary paragraph written as
///
/// ```html
/// <p>
///     Este párrafo abre el documento
/// </p>
/// ```
///
/// exports as a code block containing prose. The in-page extractor already
/// collapses that whitespace the way CSS does, but this is the structural
/// guarantee: whatever a page manages to put in a text node, a block that is
/// meant to be prose comes out as prose.
///
/// Leading whitespace carries no meaning inside a Markdown block, so it goes.
/// Trailing whitespace does — two spaces is a hard break — which is exactly
/// why page indentation must not be allowed to fabricate one. Blank lines at
/// the block's ends go too; the writer adds its own separation.
///
/// Not applied to code blocks, whose whitespace is the content.
fn tidy_block_text(text: &str) -> String {
    let mut lines: Vec<&str> = text.lines().map(str::trim).collect();
    while lines.first().is_some_and(|l| l.is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    lines.join("\n")
}

/// The same, for a table cell, where a newline would end the row and shear
/// the table in half.
fn tidy_cell_text(text: &str) -> String {
    tidy_block_text(text).replace('\n', " ")
}

/// Escapes characters that would otherwise be misread as Markdown syntax
/// in plain page text (not applied inside code spans/blocks).
fn escape_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(ch, '\\' | '*' | '_' | '`' | '[' | ']') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn render_list(items: &[Node], ordered: bool, out: &mut String) {
    for (i, item) in items.iter().enumerate() {
        let prefix = if ordered {
            format!("{}. ", i + 1)
        } else {
            "- ".to_string()
        };
        out.push_str(&prefix);
        let rendered = match item {
            Node::ListItem(children) => render_children_to_string(children),
            other => {
                let mut s = String::new();
                render_node(other, &mut s);
                s
            }
        };
        out.push_str(&tidy_block_text(&rendered));
        out.push('\n');
    }
    out.push('\n');
}

fn render_table(rows: &[Node], out: &mut String) {
    let row_cells: Vec<Vec<String>> = rows
        .iter()
        .map(|row| match row {
            Node::TableRow(cells) => cells
                .iter()
                .map(|cell| {
                    let rendered = match cell {
                        Node::TableCell(children) => render_children_to_string(children),
                        other => {
                            let mut s = String::new();
                            render_node(other, &mut s);
                            s
                        }
                    };
                    tidy_cell_text(&rendered)
                })
                .collect(),
            _ => Vec::new(),
        })
        .collect();

    let Some(header) = row_cells.first() else {
        return;
    };
    out.push_str("| ");
    out.push_str(&header.join(" | "));
    out.push_str(" |\n|");
    for _ in header {
        out.push_str(" --- |");
    }
    out.push('\n');
    for row in &row_cells[1..] {
        out.push_str("| ");
        out.push_str(&row.join(" | "));
        out.push_str(" |\n");
    }
    out.push('\n');
}

fn render_node(node: &Node, out: &mut String) {
    match node {
        Node::Heading { level, children } => {
            out.push_str(&"#".repeat((*level).clamp(1, 6) as usize));
            out.push(' ');
            // A heading is one line by definition: a newline inside it would
            // silently end the heading and leave the rest as loose prose.
            out.push_str(&tidy_cell_text(&render_children_to_string(children)));
            out.push('\n');
        }
        Node::Paragraph(children) => {
            out.push_str(&tidy_block_text(&render_children_to_string(children)));
            out.push('\n');
        }
        Node::Text(text) => out.push_str(&escape_text(text)),
        Node::Strong(children) => {
            out.push_str("**");
            render_children(children, out);
            out.push_str("**");
        }
        Node::Emphasis(children) => {
            out.push('_');
            render_children(children, out);
            out.push('_');
        }
        Node::Link { href, children } => match sanitize_href(href) {
            Some(safe_href) => {
                out.push('[');
                render_children(children, out);
                out.push_str("](");
                out.push_str(&safe_href);
                out.push(')');
            }
            None => render_children(children, out),
        },
        Node::Image { src, alt } => match sanitize_image_src(src) {
            Some(safe_src) => {
                out.push_str("![");
                out.push_str(&escape_text(alt));
                out.push_str("](");
                out.push_str(&safe_src);
                out.push(')');
            }
            None => {
                out.push_str(&escape_text(alt));
                out.push_str(" _(image could not be represented)_");
            }
        },
        Node::CodeBlock { lang, code } => {
            out.push_str("```");
            out.push_str(lang.as_deref().unwrap_or(""));
            out.push('\n');
            out.push_str(code);
            out.push_str("\n```\n");
        }
        Node::HorizontalRule => out.push_str("---\n"),
        Node::OrderedList(items) => render_list(items, true, out),
        Node::UnorderedList(items) => render_list(items, false, out),
        Node::ListItem(children) => render_children(children, out),
        Node::Table { rows } => render_table(rows, out),
        Node::TableRow(children) | Node::TableCell(children) => render_children(children, out),
        Node::BlockQuote(children) => {
            let inner = tidy_block_text(&render_children_to_string(children));
            for line in inner.lines() {
                out.push_str("> ");
                out.push_str(line);
                out.push('\n');
            }
        }
        Node::Code(text) => {
            out.push('`');
            out.push_str(text);
            out.push('`');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Block hygiene ----------------------------------------------------
    //
    // A page's own HTML source indentation arrives inside text nodes. In
    // Markdown, four leading spaces is a code block — so without these the
    // exported file turns ordinary prose into code, which is what the owner
    // found when they read one.

    #[test]
    fn source_indentation_never_becomes_a_code_block() {
        let doc = Document {
            children: vec![Node::Paragraph(vec![Node::Text(
                "\n    Este párrafo abre el documento\n    y sigue en la línea siguiente.\n  "
                    .to_string(),
            )])],
        };
        let md = write_markdown(&doc);
        for line in md.lines() {
            assert!(
                !line.starts_with("    "),
                "indented line survived: {line:?}"
            );
        }
        assert!(md.contains("Este párrafo abre el documento"));
        assert!(md.contains("y sigue en la línea siguiente."));
    }

    #[test]
    fn a_heading_stays_on_one_line() {
        let doc = Document {
            children: vec![Node::Heading {
                level: 1,
                children: vec![Node::Text("\n  Información\n  de auditoría\n".to_string())],
            }],
        };
        // A newline inside a heading would end it and leave the rest as loose
        // prose under a half-written title.
        assert_eq!(write_markdown(&doc), "# Información de auditoría\n");
    }

    #[test]
    fn a_table_cell_cannot_break_its_row() {
        let doc = Document {
            children: vec![Node::Table {
                rows: vec![
                    Node::TableRow(vec![
                        Node::TableCell(vec![Node::Text("Name".to_string())]),
                        Node::TableCell(vec![Node::Text("Value".to_string())]),
                    ]),
                    Node::TableRow(vec![
                        Node::TableCell(vec![Node::Text("Alpha\n  second line".to_string())]),
                        Node::TableCell(vec![Node::Text("  1  ".to_string())]),
                    ]),
                ],
            }],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("| Alpha second line | 1 |"), "{md}");
        assert_eq!(md.lines().filter(|l| l.starts_with('|')).count(), 3);
    }

    #[test]
    fn an_unrendered_cell_keeps_its_column() {
        // The extractor emits an empty cell rather than dropping one, so the
        // columns after it do not shift left by one.
        let doc = Document {
            children: vec![Node::Table {
                rows: vec![
                    Node::TableRow(vec![
                        Node::TableCell(vec![Node::Text("Visible".to_string())]),
                        Node::TableCell(vec![Node::Text("Hidden".to_string())]),
                    ]),
                    Node::TableRow(vec![
                        Node::TableCell(vec![Node::Text("kept".to_string())]),
                        Node::TableCell(vec![]),
                    ]),
                ],
            }],
        };
        assert!(write_markdown(&doc).contains("| kept |  |"));
    }

    #[test]
    fn a_list_item_is_not_indented_by_the_pages_source() {
        let doc = Document {
            children: vec![Node::UnorderedList(vec![Node::ListItem(vec![
                Node::Paragraph(vec![Node::Text("\n      First item\n    ".to_string())]),
            ])])],
        };
        assert_eq!(write_markdown(&doc), "- First item\n");
    }

    #[test]
    fn code_block_whitespace_is_content_and_survives_untouched() {
        let doc = Document {
            children: vec![Node::CodeBlock {
                lang: Some("rust".to_string()),
                code: "fn outer() {\n    let indented = 1;\n\n        let deeper = 2;\n}"
                    .to_string(),
            }],
        };
        let md = write_markdown(&doc);
        assert!(
            md.contains("fn outer() {\n    let indented = 1;\n\n        let deeper = 2;\n}"),
            "a code block's own indentation and blank lines are its content: {md}"
        );
    }

    #[test]
    fn blocks_are_separated_by_exactly_one_blank_line_whatever_they_are() {
        // The renderers used to disagree — a paragraph ended with one newline
        // and a list or table with two — so the gaps depended on what the
        // page happened to contain.
        let doc = Document {
            children: vec![
                Node::Paragraph(vec![Node::Text("first".to_string())]),
                Node::UnorderedList(vec![Node::ListItem(vec![Node::Paragraph(vec![
                    Node::Text("item".to_string()),
                ])])]),
                Node::Paragraph(vec![Node::Text("after the list".to_string())]),
                Node::Table {
                    rows: vec![Node::TableRow(vec![Node::TableCell(vec![Node::Text(
                        "cell".to_string(),
                    )])])],
                },
                Node::Paragraph(vec![Node::Text("last".to_string())]),
            ],
        };
        let md = write_markdown(&doc);
        assert!(!md.contains("\n\n\n"), "excessive blank lines:\n{md}");
        assert!(
            md.ends_with("last\n"),
            "the file must not end in blank lines: {md:?}"
        );
    }

    #[test]
    fn an_empty_block_contributes_nothing() {
        let doc = Document {
            children: vec![
                Node::Paragraph(vec![Node::Text("kept".to_string())]),
                Node::Paragraph(vec![]),
                Node::Paragraph(vec![Node::Text("also kept".to_string())]),
            ],
        };
        assert_eq!(write_markdown(&doc), "kept\n\nalso kept\n");
    }

    #[test]
    fn no_rendered_line_carries_trailing_whitespace() {
        let doc = Document {
            children: vec![Node::Paragraph(vec![Node::Text(
                "trailing spaces follow   \nand here too  ".to_string(),
            )])],
        };
        for line in write_markdown(&doc).lines() {
            assert_eq!(line, line.trim_end(), "trailing whitespace: {line:?}");
        }
    }

    #[test]
    fn a_blockquote_is_not_indented_into_code() {
        let doc = Document {
            children: vec![Node::BlockQuote(vec![Node::Paragraph(vec![Node::Text(
                "\n    A quoted paragraph.\n  ".to_string(),
            )])])],
        };
        assert_eq!(write_markdown(&doc), "> A quoted paragraph.\n");
    }

    #[test]
    fn renders_heading_and_paragraph() {
        let doc = Document {
            children: vec![
                Node::Heading {
                    level: 1,
                    children: vec![Node::Text("Title".into())],
                },
                Node::Paragraph(vec![Node::Text("Body text".into())]),
            ],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("# Title"));
        assert!(md.contains("Body text"));
    }

    #[test]
    fn renders_safe_link_as_markdown_link() {
        let doc = Document {
            children: vec![Node::Paragraph(vec![Node::Link {
                href: "https://example.com".into(),
                children: vec![Node::Text("example".into())],
            }])],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("[example](https://example.com)"));
    }

    #[test]
    fn drops_javascript_link_href_but_keeps_text() {
        let doc = Document {
            children: vec![Node::Paragraph(vec![Node::Link {
                href: "javascript:alert(1)".into(),
                children: vec![Node::Text("click me".into())],
            }])],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("click me"));
        assert!(!md.contains("javascript:"));
    }

    #[test]
    fn renders_code_block_with_language() {
        let doc = Document {
            children: vec![Node::CodeBlock {
                lang: Some("rust".into()),
                code: "fn main() {}".into(),
            }],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("```rust"));
        assert!(md.contains("fn main() {}"));
    }

    #[test]
    fn renders_image_with_safe_src() {
        let doc = Document {
            children: vec![Node::Image {
                src: "https://example.com/x.png".into(),
                alt: "a photo".into(),
            }],
        };
        let md = write_markdown(&doc);
        assert_eq!(md.trim(), "![a photo](https://example.com/x.png)");
    }

    #[test]
    fn falls_back_to_alt_text_for_unsafe_image_src() {
        let doc = Document {
            children: vec![Node::Image {
                src: "javascript:alert(1)".into(),
                alt: "a photo".into(),
            }],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("a photo"));
        assert!(!md.contains("javascript:"));
    }

    #[test]
    fn renders_unordered_and_ordered_lists() {
        let doc = Document {
            children: vec![
                Node::UnorderedList(vec![
                    Node::ListItem(vec![Node::Text("first".into())]),
                    Node::ListItem(vec![Node::Text("second".into())]),
                ]),
                Node::OrderedList(vec![
                    Node::ListItem(vec![Node::Text("a".into())]),
                    Node::ListItem(vec![Node::Text("b".into())]),
                ]),
            ],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("- first"));
        assert!(md.contains("- second"));
        assert!(md.contains("1. a"));
        assert!(md.contains("2. b"));
    }

    #[test]
    fn renders_table_with_header_separator() {
        let doc = Document {
            children: vec![Node::Table {
                rows: vec![
                    Node::TableRow(vec![
                        Node::TableCell(vec![Node::Text("Name".into())]),
                        Node::TableCell(vec![Node::Text("Value".into())]),
                    ]),
                    Node::TableRow(vec![
                        Node::TableCell(vec![Node::Text("Alpha".into())]),
                        Node::TableCell(vec![Node::Text("1".into())]),
                    ]),
                ],
            }],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("| Name | Value |"));
        assert!(md.contains("| --- | --- |"));
        assert!(md.contains("| Alpha | 1 |"));
    }

    #[test]
    fn renders_blockquote_with_prefix() {
        let doc = Document {
            children: vec![Node::BlockQuote(vec![Node::Text("quoted line".into())])],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("> quoted line"));
    }

    #[test]
    fn escapes_markdown_special_characters_in_plain_text() {
        let doc = Document {
            children: vec![Node::Paragraph(vec![Node::Text(
                "1 * 2 = 2, use _this_ or [that]".into(),
            )])],
        };
        let md = write_markdown(&doc);
        assert!(md.contains(r"1 \* 2 = 2, use \_this\_ or \[that\]"));
    }

    #[test]
    fn frontmatter_contains_required_fields() {
        let meta = DocumentMeta {
            title: "My Page".into(),
            source: "https://example.com/page".into(),
            captured_at: "2026-09-17T00:00:00Z".into(),
        };
        let doc = Document {
            children: vec![Node::Text("hi".into())],
        };
        let md = write_markdown_with_frontmatter(&doc, &meta);
        assert!(md.starts_with("---\n"));
        assert!(md.contains("title: \"My Page\""));
        assert!(md.contains("source: \"https://example.com/page\""));
        assert!(md.contains("captured_at: \"2026-09-17T00:00:00Z\""));
        assert!(md.contains("generator: \"FullScreenShot\""));
        assert!(md.contains("repository: \"https://github.com/ATuManera/FullScreenShot\""));
    }

    #[test]
    fn frontmatter_escapes_quotes_in_title() {
        let meta = DocumentMeta {
            title: "A \"quoted\" title".into(),
            source: "https://example.com".into(),
            captured_at: "2026-09-17T00:00:00Z".into(),
        };
        let doc = Document { children: vec![] };
        let md = write_markdown_with_frontmatter(&doc, &meta);
        assert!(md.contains(r#"title: "A \"quoted\" title""#));
    }

    #[test]
    fn writer_never_panics_on_any_node_variant() {
        let doc = Document {
            children: vec![
                Node::Image {
                    src: "x.png".into(),
                    alt: "alt text".into(),
                },
                Node::UnorderedList(vec![Node::ListItem(vec![Node::Text("item".into())])]),
                Node::Table {
                    rows: vec![Node::TableRow(vec![Node::TableCell(vec![Node::Text(
                        "cell".into(),
                    )])])],
                },
                Node::BlockQuote(vec![Node::Text("quoted".into())]),
                Node::Code("inline".into()),
            ],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("alt text"));
        assert!(md.contains("item"));
        assert!(md.contains("cell"));
        assert!(md.contains("quoted"));
        assert!(md.contains("inline"));
    }
}
