// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

//! Parses the JSON AST sent from the content script. Per the extension's
//! threat model (SECURITY.md: "untrusted serialized AST"), this is the
//! single point where that boundary is crossed: everything here is
//! adversarial by default. `serde_json` itself already bounds parse-time
//! recursion (it errors rather than overflowing the stack on deeply
//! nested input), but we still cap total node count and tree depth after
//! a successful parse so a technically-valid-but-absurd document (e.g. a
//! few thousand nested `Paragraph`s just under serde_json's limit, or an
//! enormous flat list) can't blow up memory or later render passes.

use screenshot_core::CoreError;

use crate::ast::{Document, Node};

pub const MAX_NODE_COUNT: usize = 200_000;
/// `serde_json` itself already refuses to parse JSON nested deeper than
/// its own internal limit (128 levels), but each AST `Node` level costs
/// roughly two of those (one for the `{"type":...}` object, one for the
/// `"value"` array wrapping child nodes) — so this must stay well under
/// half of that to actually apply before `serde_json` errors out first
/// with a less specific message. 32 is comfortably deep for any
/// real page's DOM structure.
pub const MAX_TREE_DEPTH: usize = 32;

impl Document {
    /// Parses and validates a JSON-encoded AST from an untrusted source
    /// (the content script, which itself only reflects untrusted page
    /// content). Rejects malformed JSON, structurally invalid node
    /// shapes, excessive node counts, and excessive nesting depth.
    pub fn from_untrusted_json(json: &str) -> Result<Document, CoreError> {
        let doc: Document = serde_json::from_str(json)
            .map_err(|e| CoreError::Overflow(format!("invalid markdown AST JSON: {e}")))?;

        let mut node_count = 0usize;
        for node in &doc.children {
            validate_node(node, 1, &mut node_count)?;
        }

        Ok(doc)
    }
}

fn validate_node(node: &Node, depth: usize, node_count: &mut usize) -> Result<(), CoreError> {
    if depth > MAX_TREE_DEPTH {
        return Err(CoreError::Overflow(format!(
            "markdown AST exceeds max depth of {MAX_TREE_DEPTH}"
        )));
    }
    *node_count += 1;
    if *node_count > MAX_NODE_COUNT {
        return Err(CoreError::Overflow(format!(
            "markdown AST exceeds max node count of {MAX_NODE_COUNT}"
        )));
    }

    let children: &[Node] = match node {
        Node::Heading { children, .. } => children,
        Node::Paragraph(children) => children,
        Node::Strong(children) => children,
        Node::Emphasis(children) => children,
        Node::Link { children, .. } => children,
        Node::OrderedList(children) => children,
        Node::UnorderedList(children) => children,
        Node::ListItem(children) => children,
        Node::Table { rows } => rows,
        Node::TableRow(children) => children,
        Node::TableCell(children) => children,
        Node::BlockQuote(children) => children,
        Node::Text(_)
        | Node::Image { .. }
        | Node::Code(_)
        | Node::CodeBlock { .. }
        | Node::HorizontalRule => &[],
    };

    for child in children {
        validate_node(child, depth + 1, node_count)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_well_formed_document() {
        let json = r#"{"children":[{"type":"Heading","value":{"level":1,"children":[{"type":"Text","value":"Hi"}]}}]}"#;
        let doc = Document::from_untrusted_json(json).unwrap();
        assert_eq!(doc.children.len(), 1);
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(Document::from_untrusted_json("{not valid json").is_err());
    }

    #[test]
    fn rejects_unknown_node_type() {
        let json = r#"{"children":[{"type":"ScriptInjection","value":"alert(1)"}]}"#;
        assert!(Document::from_untrusted_json(json).is_err());
    }

    #[test]
    fn rejects_excessive_nesting_depth() {
        // Build a Paragraph nested `MAX_TREE_DEPTH + 5` levels deep.
        let mut json = r#"{"type":"Text","value":"leaf"}"#.to_string();
        for _ in 0..(MAX_TREE_DEPTH + 5) {
            json = format!(r#"{{"type":"Paragraph","value":[{json}]}}"#);
        }
        let doc_json = format!(r#"{{"children":[{json}]}}"#);
        let result = Document::from_untrusted_json(&doc_json);
        assert!(result.is_err());
    }

    #[test]
    fn accepts_nesting_at_exactly_the_depth_limit() {
        let mut json = r#"{"type":"Text","value":"leaf"}"#.to_string();
        for _ in 0..(MAX_TREE_DEPTH - 1) {
            json = format!(r#"{{"type":"Paragraph","value":[{json}]}}"#);
        }
        let doc_json = format!(r#"{{"children":[{json}]}}"#);
        assert!(Document::from_untrusted_json(&doc_json).is_ok());
    }

    #[test]
    fn rejects_excessive_node_count() {
        let mut children = String::new();
        for i in 0..(MAX_NODE_COUNT + 10) {
            if i > 0 {
                children.push(',');
            }
            children.push_str(r#"{"type":"Text","value":"x"}"#);
        }
        let doc_json = format!(r#"{{"children":[{children}]}}"#);
        assert!(Document::from_untrusted_json(&doc_json).is_err());
    }
}
