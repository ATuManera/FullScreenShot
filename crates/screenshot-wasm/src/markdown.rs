// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use wasm_bindgen::prelude::*;

use screenshot_md::writer::{write_markdown_with_frontmatter, DocumentMeta};
use screenshot_md::Document;

/// Parses the content script's JSON AST (untrusted — see
/// `screenshot_md::untrusted`) and renders it to Markdown with a YAML
/// frontmatter header. Throws a JS error (never panics) on malformed or
/// hostile input.
#[wasm_bindgen(js_name = "markdownFromJson")]
pub fn markdown_from_json(
    json: &str,
    title: &str,
    source: &str,
    captured_at: &str,
) -> Result<String, JsValue> {
    let doc = Document::from_untrusted_json(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let meta = DocumentMeta {
        title: title.to_string(),
        source: source.to_string(),
        captured_at: captured_at.to_string(),
    };
    Ok(write_markdown_with_frontmatter(&doc, &meta))
}
