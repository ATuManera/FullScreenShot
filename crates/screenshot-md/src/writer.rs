// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use crate::ast::{Document, Node};
use crate::sanitizer::sanitize_href;

pub fn write_markdown(doc: &Document) -> String {
    let mut out = String::new();
    for node in &doc.children {
        render_node(node, &mut out);
        out.push('\n');
    }
    out
}

fn render_children(children: &[Node], out: &mut String) {
    for child in children {
        render_node(child, out);
    }
}

fn render_node(node: &Node, out: &mut String) {
    match node {
        Node::Heading { level, children } => {
            out.push_str(&"#".repeat((*level).clamp(1, 6) as usize));
            out.push(' ');
            render_children(children, out);
            out.push('\n');
        }
        Node::Paragraph(children) => {
            render_children(children, out);
            out.push('\n');
        }
        Node::Text(text) => out.push_str(text),
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
        Node::CodeBlock { lang, code } => {
            out.push_str("```");
            out.push_str(lang.as_deref().unwrap_or(""));
            out.push('\n');
            out.push_str(code);
            out.push_str("\n```\n");
        }
        Node::HorizontalRule => out.push_str("---\n"),
        // Image, lists, tables, code spans, block quotes: full rendering
        // lands in P3 with the DOM extractor. Until then, render inner
        // text so nothing panics and nothing silently disappears.
        Node::Image { alt, .. } => out.push_str(alt),
        Node::OrderedList(children)
        | Node::UnorderedList(children)
        | Node::ListItem(children)
        | Node::BlockQuote(children)
        | Node::TableRow(children)
        | Node::TableCell(children) => render_children(children, out),
        Node::Table { rows } => render_children(rows, out),
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
