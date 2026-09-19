// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
//! Dev-only: renders a captured AST through the real writer, so the exported
//! Markdown can be inspected as a file rather than assumed.
use screenshot_md::ast::Document;
use screenshot_md::writer::{write_markdown_with_frontmatter, DocumentMeta};

fn main() {
    let mut args = std::env::args().skip(1);
    let input = args
        .next()
        .expect("usage: render_ast <ast.json> <out.md> [source-url]");
    let output = args
        .next()
        .expect("usage: render_ast <ast.json> <out.md> [source-url]");
    let source = args
        .next()
        .unwrap_or_else(|| "http://127.0.0.1:8899/tests/pages/pdf-text-acceptance.html".into());

    let json = std::fs::read_to_string(&input).unwrap();
    let doc = Document::from_untrusted_json(&json).expect("the extractor's own output must parse");
    let meta = DocumentMeta {
        title: "Aceptación del PDF con texto buscable".into(),
        source,
        captured_at: "2026-09-19T00:00:00Z".into(),
    };
    let md = write_markdown_with_frontmatter(&doc, &meta);
    std::fs::write(&output, &md).unwrap();
    eprintln!("{output}: {} bytes", md.len());
}
