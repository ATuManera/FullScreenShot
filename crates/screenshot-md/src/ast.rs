// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use serde::{Deserialize, Serialize};

/// Adjacently tagged (`{"type": "...", "value": ...}`) rather than the
/// default internally-tagged representation: several variants here wrap a
/// bare `Vec<Node>` or `String` rather than a struct, and serde's internal
/// tagging only supports map-shaped variant contents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum Node {
    Heading { level: u8, children: Vec<Node> },
    Paragraph(Vec<Node>),
    Text(String),
    Strong(Vec<Node>),
    Emphasis(Vec<Node>),
    Link { href: String, children: Vec<Node> },
    Image { src: String, alt: String },
    OrderedList(Vec<Node>),
    UnorderedList(Vec<Node>),
    ListItem(Vec<Node>),
    Table { rows: Vec<Node> },
    TableRow(Vec<Node>),
    TableCell(Vec<Node>),
    Code(String),
    CodeBlock { lang: Option<String>, code: String },
    BlockQuote(Vec<Node>),
    HorizontalRule,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Document {
    pub children: Vec<Node>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_can_hold_a_mixed_node_tree() {
        let doc = Document {
            children: vec![
                Node::Heading {
                    level: 1,
                    children: vec![Node::Text("Title".into())],
                },
                Node::Paragraph(vec![
                    Node::Text("Hello ".into()),
                    Node::Strong(vec![Node::Text("world".into())]),
                ]),
                Node::HorizontalRule,
            ],
        };
        assert_eq!(doc.children.len(), 3);
    }

    #[test]
    fn node_round_trips_through_json() {
        let node = Node::Link {
            href: "https://example.com".into(),
            children: vec![Node::Text("example".into())],
        };
        let json = serde_json::to_string(&node).unwrap();
        let parsed: Node = serde_json::from_str(&json).unwrap();
        assert_eq!(node, parsed);
    }

    #[test]
    fn document_round_trips_through_json() {
        let doc = Document {
            children: vec![Node::HorizontalRule, Node::Text("hi".into())],
        };
        let json = serde_json::to_string(&doc).unwrap();
        let parsed: Document = serde_json::from_str(&json).unwrap();
        assert_eq!(doc, parsed);
    }
}
