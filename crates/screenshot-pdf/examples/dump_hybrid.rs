// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
//! Dev-only: writes a small hybrid PDF so it can be opened in a real reader.
use screenshot_core::compositor::Band;
use screenshot_pdf::pdf::{generate_hybrid_pdf, PdfMetadata, TextLayerInput};
use screenshot_pdf::text_layer::TextLayer;
use screenshot_pdf::transform::{Orientation, PageSize};

fn main() {
    let (w, h) = (600u32, 800u32);
    let rgb = vec![250u8; (w * h * 3) as usize];
    let layer = TextLayer::from_untrusted_json(
        r#"{"fragments":[
            {"text":"Información de auditoría — Perú","x":40,"y":40,"w":260,"h":22,"size":19},
            {"text":"información auditoría Perú señal","x":40,"y":120,"w":300,"h":18,"size":16},
            {"text":"señal ñÑüÜ «comillas» 中文 🙂","x":40,"y":400,"w":380,"h":18,"size":16},
            {"text":"Última línea del documento","x":40,"y":760,"w":240,"h":18,"size":16}],
          "links":[{"uri":"https://example.com/destino","x":40,"y":200,"w":180,"h":18}]}"#,
    )
    .unwrap();
    let bands = [Band {
        source_offset_css: 0.0,
        device_row_start: 0,
        device_rows: h,
    }];
    let (bytes, report) = generate_hybrid_pdf(
        &rgb,
        w,
        h,
        PageSize::Auto,
        Orientation::Portrait,
        Some(TextLayerInput {
            layer: &layer,
            bands: &bands,
            dpr: 1.0,
        }),
        PdfMetadata {
            title: Some("Página de aceptación"),
        },
    )
    .unwrap();
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "hybrid.pdf".into());
    std::fs::write(&path, &bytes).unwrap();
    eprintln!("{path}: {} bytes, {report:?}", bytes.len());
}
