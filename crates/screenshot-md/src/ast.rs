// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

#[derive(Debug, Clone, PartialEq)]
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

#[derive(Debug, Clone, PartialEq)]
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
}
