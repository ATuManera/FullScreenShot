// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
//! Dev-only: the acceptance capture with every link's mapped rectangle
//! painted into the raster, so a reader shows exactly where the clickable
//! hotspots are and a click can be aimed at one.
use screenshot_core::compositor::Band;
use screenshot_pdf::pdf::{generate_hybrid_pdf, PdfMetadata, TextLayerInput};
use screenshot_pdf::text_layer::TextLayer;
use screenshot_pdf::transform::{Orientation, PageLayout, PageSize, SourceMapping, SourceRect};

const WIDTH: u32 = 1200;
const OFFSETS: [f64; 4] = [0.0, 760.0, 1520.0, 1563.0];

fn main() {
    let json = std::fs::read_to_string(
        "crates/screenshot-pdf/tests/fixtures/pdf-text-acceptance-layer.json",
    )
    .unwrap();
    let layer = TextLayer::from_untrusted_json(&json).unwrap();

    let dpr: f64 = std::env::args()
        .nth(3)
        .and_then(|s| s.parse().ok())
        .unwrap_or(1.0);
    let width = (WIDTH as f64 * dpr).round() as u32;

    let mut bands = Vec::new();
    let mut row_start = 0u32;
    for (i, &offset) in OFFSETS.iter().enumerate() {
        let rows = if i + 1 == OFFSETS.len() {
            (800.0 * dpr).round() as u32
        } else {
            ((OFFSETS[i + 1] * dpr).round() - (offset * dpr).round()) as u32
        };
        bands.push(Band {
            source_offset_css: offset,
            device_row_start: row_start,
            device_rows: rows,
        });
        row_start += rows;
    }
    let height = row_start;

    let mut rgb = vec![248u8; (width as usize) * (height as usize) * 3];
    // Paint every link's rectangle, in composite device space, so what the
    // eye sees is exactly what the annotation covers.
    for link in &layer.links {
        let x0 = (link.x * dpr).round().max(0.0) as u32;
        let y0 = (bands
            .iter()
            .find(|b| b.contains_source_css(link.y, dpr))
            .map(|b| b.device_row_of_source_css(link.y, dpr))
            .unwrap_or(0.0))
        .round()
        .max(0.0) as u32;
        let x1 = ((link.x + link.width) * dpr).round().min(width as f64) as u32;
        let y1 = (y0 as f64 + link.height * dpr).round().min(height as f64) as u32;
        for y in y0..y1 {
            for x in x0..x1 {
                let i = ((y as usize) * width as usize + x as usize) * 3;
                rgb[i] = 255;
                rgb[i + 1] = 90;
                rgb[i + 2] = 90;
            }
        }
    }

    let page_size = match std::env::args().nth(2).as_deref() {
        Some("a4") => PageSize::A4,
        Some("letter") => PageSize::Letter,
        _ => PageSize::Auto,
    };
    let layout = PageLayout::new(page_size, Orientation::Portrait, width, height).unwrap();
    let mapping = SourceMapping::new(&layout, &bands, dpr);
    eprintln!(
        "dpr={dpr} composite={width}x{height} pages={} page_pt={}x{}",
        layout.pages.len(),
        layout.page_width_pt,
        layout.page_height_pt
    );
    for link in &layer.links {
        if let Some(p) = mapping.place(SourceRect {
            x: link.x,
            y: link.y,
            width: link.width,
            height: link.height,
        }) {
            eprintln!(
                "  page {} rect [{:.2} {:.2} {:.2} {:.2}]  {}",
                p.page,
                p.x,
                p.y,
                p.x + p.width,
                p.y + p.height,
                link.uri
            );
        } else {
            eprintln!("  DROPPED {}", link.uri);
        }
    }

    let (bytes, report) = generate_hybrid_pdf(
        &rgb,
        width,
        height,
        page_size,
        Orientation::Portrait,
        Some(TextLayerInput {
            layer: &layer,
            bands: &bands,
            dpr,
        }),
        PdfMetadata {
            title: Some("link map"),
        },
    )
    .unwrap();
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "linkmap.pdf".into());
    std::fs::write(&path, &bytes).unwrap();
    eprintln!("{path}: {} bytes, {report:?}", bytes.len());
}
