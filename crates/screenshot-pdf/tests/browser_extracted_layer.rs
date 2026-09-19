// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

//! The hybrid PDF, end to end, from geometry a real browser measured.
//!
//! The fixtures under `tests/fixtures/` are not hand-written. They are the
//! exact JSON that the compiled `extractTextLayer` produced in a real
//! Chromium against `tests/pages/pdf-text-acceptance.html` and
//! `tests/pages/scrollarea-single.html` at a 1200×800 viewport — the same
//! approach the Markdown extractor was proved with, and for the same reason:
//! a hand-written fixture would only test this crate against someone's idea
//! of what a browser reports, and layout is exactly the thing not to guess
//! about.
//!
//! What these tests then check is the half that runs in Rust: that the
//! geometry the browser gave becomes a PDF whose text a reader can find,
//! read in order and copy, on the page where the picture shows it.

use screenshot_core::compositor::Band;
use screenshot_pdf::pdf::{generate_hybrid_pdf, PdfMetadata, TextLayerInput};
use screenshot_pdf::text_layer::TextLayer;
use screenshot_pdf::transform::{Orientation, PageLayout, PageSize, SourceMapping, SourceRect};

/// The acceptance page as the browser reported it: a 1200×800 viewport, a
/// 2363px document, `devicePixelRatio` 1, and the tile plan
/// `plan_tile_offsets(800, 2363, 40)` produces for it.
const VIEWPORT_WIDTH: u32 = 1200;
const VIEWPORT_HEIGHT: f64 = 800.0;
const DOCUMENT_HEIGHT: u32 = 2363;
const TILE_OFFSETS: [f64; 4] = [0.0, 760.0, 1520.0, 1563.0];

fn acceptance_layer() -> TextLayer {
    TextLayer::from_untrusted_json(include_str!("fixtures/pdf-text-acceptance-layer.json"))
        .expect("the browser's own output must parse")
}

fn scroll_area_layer() -> TextLayer {
    TextLayer::from_untrusted_json(include_str!("fixtures/scrollarea-single-layer.json"))
        .expect("the browser's own output must parse")
}

/// The band map the compositor builds for a plan of `offsets` whose tiles are
/// each `viewport` CSS px tall.
fn bands(offsets: &[f64], viewport: f64, dpr: f64) -> Vec<Band> {
    let mut bands = Vec::new();
    let mut row_start = 0u32;
    for (i, &offset) in offsets.iter().enumerate() {
        let rows = if i + 1 == offsets.len() {
            (viewport * dpr).round() as u32
        } else {
            ((offsets[i + 1] * dpr).round() - (offset * dpr).round()) as u32
        };
        bands.push(Band {
            source_offset_css: offset,
            device_row_start: row_start,
            device_rows: rows,
        });
        row_start += rows;
    }
    bands
}

fn white(width: u32, height: u32) -> Vec<u8> {
    vec![255u8; width as usize * height as usize * 3]
}

fn acceptance_pdf(page_size: PageSize) -> (Vec<u8>, screenshot_pdf::pdf::TextLayerReport) {
    let layer = acceptance_layer();
    let bands = bands(&TILE_OFFSETS, VIEWPORT_HEIGHT, 1.0);
    generate_hybrid_pdf(
        &white(VIEWPORT_WIDTH, DOCUMENT_HEIGHT),
        VIEWPORT_WIDTH,
        DOCUMENT_HEIGHT,
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
    .expect("a capture of the acceptance page must export")
}

// --- Minimal PDF reading, enough to answer "can this be searched?" ---------

mod reader;
use reader::{
    annotation_uris, extracted_text, link_annotations, media_boxes, page_count, LinkAnnotation,
};

#[test]
fn the_acceptance_page_is_searchable_from_top_to_bottom() {
    let (pdf, report) = acceptance_pdf(PageSize::A4);
    assert_eq!(
        report.fragments_placed, 49,
        "every measured line must be placed"
    );
    assert_eq!(report.fragments_dropped, 0);

    let text = extracted_text(&pdf);
    // Top, middle and bottom of the document, each in its own PDF page.
    assert!(text.contains("Información de auditoría del Perú"), "top");
    assert!(text.contains("Marcador intermedio"), "middle");
    assert!(text.contains("Marcador inferior"), "bottom");
    assert!(
        text.contains("Última línea del documento de aceptación."),
        "last line"
    );
}

#[test]
fn spanish_text_survives_the_round_trip_to_the_pdf() {
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let text = extracted_text(&pdf);
    for needle in [
        "información",
        "auditoría",
        "Perú",
        "señal",
        "ñandú",
        "Ñuñoa",
        "pingüino",
        "Über",
        "¿de?",
        "¡interrogación!",
    ] {
        assert!(text.contains(needle), "{needle:?} is missing from {text:?}");
    }
    // The browser wrapped this phrase across two lines, so it is two runs in
    // the PDF — as it would be in any PDF of a wrapped paragraph. Both halves
    // must be there, in order, with nothing lost at the break.
    let joined = text.replace('\n', " ");
    assert!(
        joined.contains("«comillas angulares»"),
        "a phrase lost words at its line break: {joined:?}"
    );
    assert!(
        !text.contains('\u{FFFD}'),
        "a character reached the PDF with no /ToUnicode entry"
    );
}

#[test]
fn text_the_page_never_showed_is_not_in_the_pdf() {
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let text = extracted_text(&pdf);
    // display:none, visibility:hidden, opacity:0, [hidden] and the
    // 1px-clipped screen-reader box all say the same thing in the fixture.
    assert!(
        !text.contains("no debe aparecer"),
        "unrendered text leaked into the text layer: {text:?}"
    );
}

#[test]
fn reading_order_is_the_documents_order() {
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let text = extracted_text(&pdf);
    let position = |needle: &str| {
        text.find(needle)
            .unwrap_or_else(|| panic!("{needle} missing"))
    };
    assert!(position("Información de auditoría del Perú") < position("Marcador intermedio"));
    assert!(position("Marcador intermedio") < position("Marcador inferior"));
    assert!(position("Marcador inferior") < position("Última línea del documento"));
}

#[test]
fn a_wrapped_paragraph_reads_as_its_own_lines_not_one_run() {
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let text = extracted_text(&pdf);
    // The browser broke this paragraph over seven lines; each is its own run,
    // so the words still read in order but the geometry is per line.
    assert!(text.contains("Este párrafo es deliberadamente"));
    assert!(text.contains("se amontone."));
    let joined = text.replace('\n', " ");
    assert!(
        joined.contains("de modo que") && joined.contains("tantos renglones"),
        "a wrapped paragraph lost words between its lines"
    );
}

#[test]
fn only_the_supported_links_became_annotations() {
    let (pdf, report) = acceptance_pdf(PageSize::A4);
    let uris = annotation_uris(&pdf);
    assert_eq!(report.links_placed, uris.len());

    assert!(uris.iter().any(|u| u == "https://example.com/principio"));
    assert!(uris.iter().any(|u| u == "https://example.com/final"));
    // The browser resolved the relative href for us; nothing was concatenated
    // by hand here.
    assert!(uris
        .iter()
        .any(|u| u.starts_with("http://127.0.0.1:8765/informes/2026")));
    // A link wrapped over two lines gets an annotation per line, so the whole
    // of it is clickable rather than only its first half.
    assert_eq!(
        uris.iter()
            .filter(|u| u.ends_with("/una/ruta/bastante/larga/para/partirse"))
            .count(),
        2
    );

    let all = uris.join(" ");
    assert!(!all.contains("javascript"), "javascript: reached the PDF");
    assert!(!all.contains("data:"), "data: reached the PDF");
    assert!(!all.contains("mailto:"), "mailto: is not supported in V1");
}

#[test]
fn a_fixed_footer_appears_once_where_the_compositor_kept_it() {
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let text = extracted_text(&pdf);
    assert_eq!(
        text.matches("Pie fijo").count(),
        1,
        "a viewport-anchored footer must not repeat down the document"
    );

    // And it must be on the last page, which is where the last band — the
    // only band that keeps it — ended up.
    let layout = PageLayout::new(
        PageSize::A4,
        Orientation::Portrait,
        VIEWPORT_WIDTH,
        DOCUMENT_HEIGHT,
    )
    .unwrap();
    let bands = bands(&TILE_OFFSETS, VIEWPORT_HEIGHT, 1.0);
    let mapping = SourceMapping::new(&layout, &bands, 1.0);
    let footer = acceptance_layer()
        .fragments
        .into_iter()
        .find(|f| f.text.starts_with("Pie fijo"))
        .expect("the fixture has a fixed footer");
    let placed = mapping
        .place(SourceRect {
            x: footer.x,
            y: footer.y,
            width: footer.width,
            height: footer.height,
        })
        .expect("the footer must land inside the composite");
    assert_eq!(placed.page, layout.pages.len() - 1);
}

#[test]
fn a_sticky_header_appears_once_at_the_top() {
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let text = extracted_text(&pdf);
    assert_eq!(
        text.matches("Cabecera fija").count(),
        1,
        "a sticky header must not repeat in every band"
    );
    let first_page_break = text.find("Marcador intermedio").unwrap();
    assert!(text.find("Cabecera fija").unwrap() < first_page_break);
}

#[test]
fn the_same_text_survives_every_page_model() {
    for page_size in [PageSize::A4, PageSize::Letter, PageSize::Auto] {
        let (pdf, report) = acceptance_pdf(page_size);
        assert_eq!(report.fragments_dropped, 0, "{page_size:?} dropped text");
        let text = extracted_text(&pdf);
        assert!(text.contains("Marcador inferior"), "{page_size:?}");
        assert_eq!(text.matches("Pie fijo").count(), 1, "{page_size:?}");
    }
    // Auto is a single page by definition; A4 is not.
    let (auto, _) = acceptance_pdf(PageSize::Auto);
    let (a4, _) = acceptance_pdf(PageSize::A4);
    assert_eq!(page_count(&auto), 1);
    assert!(page_count(&a4) > 1);
}

#[test]
fn every_line_stays_on_the_pixels_that_drew_it_at_every_device_pixel_ratio() {
    // The fixture was measured at dpr 1, but the same CSS geometry on a
    // fractionally-scaled display must still land on its own pixels — that is
    // the failure mode this project has already paid for once.
    let layer = acceptance_layer();
    for dpr in [1.0, 1.25, 1.5, 1.75, 2.0] {
        let bands = bands(&TILE_OFFSETS, VIEWPORT_HEIGHT, dpr);
        let height = bands.last().unwrap().device_row_start + bands.last().unwrap().device_rows;
        let width = (VIEWPORT_WIDTH as f64 * dpr).round() as u32;
        let layout = PageLayout::new(PageSize::Auto, Orientation::Portrait, width, height).unwrap();
        let mapping = SourceMapping::new(&layout, &bands, dpr);

        for fragment in &layer.fragments {
            let placed = mapping
                .place(SourceRect {
                    x: fragment.x,
                    y: fragment.y,
                    width: fragment.width,
                    height: fragment.height,
                })
                .unwrap_or_else(|| panic!("dpr {dpr}: {:?} fell off the composite", fragment.text));
            // Auto page: one point per device pixel, so the distance from the
            // page top is the composite row, and it must be the row the
            // naive scaling would give to within the seam's own rounding.
            let from_top = layout.page_height_pt - (placed.y + placed.height);
            let naive = fragment.y * dpr;
            assert!(
                (from_top as f64 - naive).abs() <= 0.5,
                "dpr {dpr}: {:?} placed at {from_top}, drawn at {naive}",
                fragment.text
            );
        }
    }
}

// --- Scroll area ----------------------------------------------------------

#[test]
fn a_scroll_areas_pdf_contains_the_container_and_nothing_around_it() {
    // The panel as the browser reported it: 619×354 visible, 1920 of content.
    let layer = scroll_area_layer();
    let offsets: Vec<f64> = {
        let (viewport, content, overlap) = (354.0, 1920.0, 40.0);
        let stride = viewport - overlap;
        let max_y = content - viewport;
        let mut out = Vec::new();
        let mut y = 0.0;
        loop {
            out.push(f64::min(y, max_y));
            if y >= max_y {
                break;
            }
            y += stride;
        }
        out
    };
    let bands = bands(&offsets, 354.0, 1.0);
    let height = bands.last().unwrap().device_row_start + bands.last().unwrap().device_rows;
    let (pdf, report) = generate_hybrid_pdf(
        &white(619, height),
        619,
        height,
        PageSize::Auto,
        Orientation::Portrait,
        Some(TextLayerInput {
            layer: &layer,
            bands: &bands,
            dpr: 1.0,
        }),
        PdfMetadata::default(),
    )
    .expect("a scroll-area capture must export");

    let text = extracted_text(&pdf);
    // Every row of the container, from the first to the last — including the
    // ones that were never on screen at the same time.
    assert!(text.contains("PANEL ROW 1"), "{text:?}");
    assert!(text.contains("PANEL ROW 14"), "{text:?}");
    assert!(text.contains("información"), "accents inside the container");
    // Nothing from the page around it.
    assert!(
        !text.contains("FUERA DEL PANEL"),
        "text outside the scroll area leaked in: {text:?}"
    );
    let uris = annotation_uris(&pdf);
    assert_eq!(uris, vec!["https://example.com/dentro".to_string()]);
    assert!(report.fragments_placed >= 14);
}

// --- Link annotations, read back out of the finished file --------------------
//
// These read the PDF's own object graph — page tree, `/Annots`, the annotation
// dictionaries — rather than the extractor's output, because the extractor
// being right is not the same as the file being right. The link that failed
// physically is `link-top`, "documento de origen".

const LINK_TOP: &str = "https://example.com/principio";
const LINK_BOTTOM: &str = "https://example.com/final";
const LINK_WRAPPED: &str = "https://example.com/una/ruta/bastante/larga/para/partirse";

fn annotations_for(uri: &str, annotations: &[LinkAnnotation]) -> Vec<LinkAnnotation> {
    annotations
        .iter()
        .filter(|a| a.uri == uri)
        .cloned()
        .collect()
}

/// A rectangle a reader can actually hit: correctly ordered corners, real
/// area, and inside the page it is attached to.
fn assert_clickable(annotation: &LinkAnnotation, media: &[[f32; 4]]) {
    assert_eq!(annotation.subtype, "Link", "wrong annotation subtype");
    assert!(
        annotation.has_uri_action,
        "annotation carries no /S /URI action"
    );
    assert!(
        annotation.rect.iter().all(|v| v.is_finite()),
        "rectangle is not a number: {:?}",
        annotation.rect
    );
    assert!(
        annotation.width() > 0.0,
        "degenerate width — /Rect must be [x1 y1 x2 y2] with x2 > x1, got {:?}",
        annotation.rect
    );
    assert!(
        annotation.height() > 0.0,
        "degenerate height — /Rect must be [x1 y1 x2 y2] with y2 > y1, got {:?}",
        annotation.rect
    );
    let page = media.get(annotation.page).unwrap_or_else(|| {
        panic!(
            "annotation on page {} which does not exist",
            annotation.page
        )
    });
    assert!(
        annotation.rect[0] >= page[0] - 0.5
            && annotation.rect[1] >= page[1] - 0.5
            && annotation.rect[2] <= page[2] + 0.5
            && annotation.rect[3] <= page[3] + 0.5,
        "annotation {:?} is clipped off page {} {:?}",
        annotation.rect,
        annotation.page,
        page
    );
}

#[test]
fn the_link_that_failed_physically_is_a_real_annotation_on_its_own_page() {
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let annotations = link_annotations(&pdf);
    let media = media_boxes(&pdf);

    let top = annotations_for(LINK_TOP, &annotations);
    assert_eq!(
        top.len(),
        1,
        "\"documento de origen\" must have exactly one annotation"
    );
    assert_clickable(&top[0], &media);
    // It is near the head of the document, so it belongs on the first page.
    assert_eq!(top[0].page, 0);
}

#[test]
fn a_link_near_the_end_is_attached_to_the_page_it_is_drawn_on() {
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let annotations = link_annotations(&pdf);
    let media = media_boxes(&pdf);

    let bottom = annotations_for(LINK_BOTTOM, &annotations);
    assert_eq!(bottom.len(), 1);
    assert_clickable(&bottom[0], &media);
    // The failure this guards against is an annotation left on page 1 holding
    // page-N coordinates, which is invisible to a reader and unhittable.
    assert_eq!(
        bottom[0].page,
        media.len() - 1,
        "a link near the end must live on the last page, not the first"
    );
}

#[test]
fn a_wrapped_link_is_clickable_on_every_line_it_occupies() {
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let annotations = link_annotations(&pdf);
    let media = media_boxes(&pdf);

    let wrapped = annotations_for(LINK_WRAPPED, &annotations);
    assert!(
        wrapped.len() >= 2,
        "a link broken over two lines needs an annotation per line, got {}",
        wrapped.len()
    );
    for annotation in &wrapped {
        assert_clickable(annotation, &media);
        assert_eq!(annotation.uri, LINK_WRAPPED);
    }
    // Distinct rectangles, not one box swallowing the whitespace between the
    // lines: the second line starts lower and is shorter.
    assert_ne!(wrapped[0].rect, wrapped[1].rect);
    assert!(
        wrapped[0].rect[1] > wrapped[1].rect[1],
        "the lines must sit at different heights"
    );
    let gap = wrapped[0].rect[1] - wrapped[1].rect[3];
    assert!(
        gap.abs() < wrapped[0].height() * 2.0,
        "the two line boxes are too far apart to be consecutive lines"
    );
}

#[test]
fn a_rejected_scheme_produces_no_annotation_at_all() {
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let annotations = link_annotations(&pdf);
    for annotation in &annotations {
        assert!(!annotation.uri.starts_with("javascript:"), "{annotation:?}");
        assert!(!annotation.uri.starts_with("data:"), "{annotation:?}");
        assert!(!annotation.uri.starts_with("mailto:"), "{annotation:?}");
        assert!(
            annotation.uri.starts_with("http://") || annotation.uri.starts_with("https://"),
            "unsupported scheme reached the PDF: {annotation:?}"
        );
    }
    // The fixture has three links that must never become annotations, so the
    // count is the proof they were all dropped.
    assert_eq!(annotations.len(), 5);
}

#[test]
fn every_annotation_sits_over_the_text_it_belongs_to() {
    // The visible underline comes from the screenshot; the hotspot has to be
    // in the same place or the link is decorative. Both are placed from the
    // same measured rectangle, and this checks the file agrees.
    let (pdf, _) = acceptance_pdf(PageSize::A4);
    let annotations = link_annotations(&pdf);
    let layer = acceptance_layer();
    let bands = bands(&TILE_OFFSETS, VIEWPORT_HEIGHT, 1.0);
    let layout = PageLayout::new(
        PageSize::A4,
        Orientation::Portrait,
        VIEWPORT_WIDTH,
        DOCUMENT_HEIGHT,
    )
    .unwrap();
    let mapping = SourceMapping::new(&layout, &bands, 1.0);

    let top_link = layer
        .links
        .iter()
        .find(|l| l.uri == LINK_TOP)
        .expect("the fixture has the link that failed");
    let anchor_text = layer
        .fragments
        .iter()
        .find(|f| f.text.trim() == "documento de origen")
        .expect("the fixture has its visible text");

    let placed_text = mapping
        .place(SourceRect {
            x: anchor_text.x,
            y: anchor_text.y,
            width: anchor_text.width,
            height: anchor_text.height,
        })
        .unwrap();
    let annotation = annotations_for(LINK_TOP, &annotations).remove(0);
    assert_eq!(
        annotation.page, placed_text.page,
        "hotspot is on another page"
    );
    assert!(
        (annotation.rect[0] - placed_text.x).abs() < 0.5
            && (annotation.rect[1] - placed_text.y).abs() < 0.5,
        "hotspot {:?} does not cover the words at ({}, {})",
        annotation.rect,
        placed_text.x,
        placed_text.y
    );
    let _ = top_link;
}

#[test]
fn annotation_geometry_holds_at_every_device_pixel_ratio() {
    let layer = acceptance_layer();
    for dpr in [1.0, 1.25, 1.5, 1.75, 2.0] {
        let bands = bands(&TILE_OFFSETS, VIEWPORT_HEIGHT, dpr);
        let height = bands.last().unwrap().device_row_start + bands.last().unwrap().device_rows;
        let width = (VIEWPORT_WIDTH as f64 * dpr).round() as u32;

        for page_size in [PageSize::A4, PageSize::Auto] {
            let (pdf, report) = generate_hybrid_pdf(
                &white(width, height),
                width,
                height,
                page_size,
                Orientation::Portrait,
                Some(TextLayerInput {
                    layer: &layer,
                    bands: &bands,
                    dpr,
                }),
                PdfMetadata::default(),
            )
            .unwrap();
            assert_eq!(
                report.links_dropped, 0,
                "dpr {dpr}: a link fell off the composite"
            );
            assert_eq!(report.links_placed, 5, "dpr {dpr}");

            let annotations = link_annotations(&pdf);
            let media = media_boxes(&pdf);
            assert_eq!(annotations.len(), 5, "dpr {dpr} {page_size:?}");
            for annotation in &annotations {
                assert_clickable(annotation, &media);
            }

            // Top, bottom and wrapped, specifically.
            assert_eq!(
                annotations_for(LINK_TOP, &annotations).len(),
                1,
                "dpr {dpr}"
            );
            assert_eq!(
                annotations_for(LINK_BOTTOM, &annotations).len(),
                1,
                "dpr {dpr}"
            );
            assert_eq!(
                annotations_for(LINK_WRAPPED, &annotations).len(),
                2,
                "dpr {dpr}"
            );

            // Y inversion: the link near the top of the document must sit
            // higher on its page than the one near the end sits on its own.
            let top = annotations_for(LINK_TOP, &annotations).remove(0);
            let page = media[top.page];
            let from_page_top = page[3] - top.rect[3];
            assert!(
                from_page_top > 0.0 && from_page_top < page[3],
                "dpr {dpr}: y inversion is wrong, {from_page_top} into page {page:?}"
            );
        }
    }
}

#[test]
fn a_scroll_areas_links_are_annotations_too() {
    let layer = scroll_area_layer();
    let bands = bands(&[0.0, 314.0, 628.0, 942.0, 1256.0, 1566.0], 354.0, 1.0);
    let height = bands.last().unwrap().device_row_start + bands.last().unwrap().device_rows;
    let (pdf, report) = generate_hybrid_pdf(
        &white(619, height),
        619,
        height,
        PageSize::Auto,
        Orientation::Portrait,
        Some(TextLayerInput {
            layer: &layer,
            bands: &bands,
            dpr: 1.0,
        }),
        PdfMetadata::default(),
    )
    .unwrap();
    assert_eq!(report.links_placed, 1);
    let annotations = link_annotations(&pdf);
    let media = media_boxes(&pdf);
    assert_eq!(annotations.len(), 1);
    assert_eq!(annotations[0].uri, "https://example.com/dentro");
    assert_clickable(&annotations[0], &media);
}
