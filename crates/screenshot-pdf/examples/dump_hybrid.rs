// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
//! Dev-only: builds the acceptance PDF from the browser-captured text layer
//! so it can be opened in a real reader. Not part of the shipped extension.
use screenshot_core::compositor::Band;
use screenshot_pdf::pdf::{generate_hybrid_pdf, PdfMetadata, TextLayerInput};
use screenshot_pdf::text_layer::TextLayer;
use screenshot_pdf::transform::{Orientation, PageSize};

const WIDTH: u32 = 1200;
const HEIGHT: u32 = 2363;
const OFFSETS: [f64; 4] = [0.0, 760.0, 1520.0, 1563.0];

fn main() {
    let json = std::fs::read_to_string(
        "crates/screenshot-pdf/tests/fixtures/pdf-text-acceptance-layer.json",
    )
    .unwrap();
    let layer = TextLayer::from_untrusted_json(&json).unwrap();

    // Horizontal bands, so a reader shows unmistakably that the raster is
    // there and that the text layer adds nothing visible over it.
    let mut rgb = Vec::with_capacity((WIDTH * HEIGHT * 3) as usize);
    for y in 0..HEIGHT {
        let shade: u8 = if (y / 60) % 2 == 0 { 250 } else { 226 };
        for _ in 0..WIDTH {
            rgb.extend_from_slice(&[shade, shade, 240]);
        }
    }

    let mut bands = Vec::new();
    let mut row_start = 0u32;
    for (i, &offset) in OFFSETS.iter().enumerate() {
        let rows = if i + 1 == OFFSETS.len() {
            800
        } else {
            (OFFSETS[i + 1] - offset) as u32
        };
        bands.push(Band {
            source_offset_css: offset,
            device_row_start: row_start,
            device_rows: rows,
        });
        row_start += rows;
    }

    let page_size = match std::env::args().nth(2).as_deref() {
        Some("a4") => PageSize::A4,
        Some("letter") => PageSize::Letter,
        _ => PageSize::Auto,
    };
    let (bytes, report) = generate_hybrid_pdf(
        &rgb,
        WIDTH,
        HEIGHT,
        page_size,
        Orientation::Portrait,
        Some(TextLayerInput {
            layer: &layer,
            bands: &bands,
            dpr: 1.0,
        }),
        PdfMetadata {
            title: Some("Aceptación del PDF con texto buscable"),
        },
    )
    .unwrap();
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "hybrid.pdf".into());
    std::fs::write(&path, &bytes).unwrap();
    eprintln!("{path}: {} bytes, {report:?}", bytes.len());
}
