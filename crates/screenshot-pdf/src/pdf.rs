// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

//! The hybrid PDF: a screenshot for the eye, a DOM-derived text layer for
//! everything else.
//!
//! The visible content of every page is the same raster band the PNG export
//! would have produced — the capture is the visual truth and nothing here
//! re-renders it. Over that raster go two things the raster cannot carry:
//! the page's text, drawn in rendering mode 3 so it is selectable, searchable
//! and copyable but never painted, and `/Link` annotations over the
//! rectangles the browser said its hyperlinks occupied.
//!
//! Both are placed through [`crate::transform::SourceMapping`], which reads
//! the compositor's own band map, so a line of invisible text sits on the
//! pixels that drew it rather than where CSS arithmetic guessed they were.

use flate2::write::ZlibEncoder;
use flate2::Compression;
use pdf_writer::types::{
    ActionType, AnnotationFlags, AnnotationType, CidFontType, FontFlags, SystemInfo,
    TextRenderingMode, UnicodeCmap,
};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, Str, TextStr};
use std::io::Write;

use screenshot_core::capture_plan::CapturePlan;
use screenshot_core::compositor::{
    band_map, compose_streaming, expected_output_height, Band, RowSink, TileImage,
};
use screenshot_core::CoreError;

use crate::font::{cid_to_gid_map, glyphless_truetype, CodeAssignment, GLYPH_ADVANCE_EM};
use crate::text_layer::TextLayer;
use crate::transform::{Orientation, PageLayout, PageSize, SourceMapping, SourceRect};

/// Where a line's baseline sits above the bottom of the box the DOM measured
/// for it, as a fraction of the font size.
///
/// `getClientRects()` returns the font's ascent+descent box, so the baseline
/// is one descent up from its bottom edge. 0.21em is the descent of the
/// families that actually render body text on the web (Arial, Helvetica,
/// Roboto, San Francisco and the Liberation/DejaVu substitutes all sit within
/// a few thousandths of it), and being a few thousandths of an em out moves a
/// selection highlight by a fraction of a pixel.
const BASELINE_ABOVE_BOX_BOTTOM_EM: f64 = 0.21;

/// Bounds on the horizontal scaling used to make a run as wide as the DOM
/// measured it. Anything outside this came from a rectangle that does not
/// describe the text it is attached to.
const MIN_HORIZONTAL_SCALE: f64 = 1.0;
const MAX_HORIZONTAL_SCALE: f64 = 2000.0;

const FONT_RESOURCE: Name<'static> = Name(b"F0");
const IMAGE_RESOURCE: Name<'static> = Name(b"Im0");

/// The semantic layer to lay over a composed capture, together with the
/// compositor geometry that says where its coordinates ended up.
pub struct TextLayerInput<'a> {
    pub layer: &'a TextLayer,
    /// The compositor's band map for this capture — the authority on which
    /// output row a source position became.
    pub bands: &'a [Band],
    pub dpr: f64,
}

/// Document-level metadata. Deliberately thin: a title and the producing
/// application, and nothing that describes the user or where they were.
#[derive(Debug, Clone, Copy, Default)]
pub struct PdfMetadata<'a> {
    pub title: Option<&'a str>,
}

const PRODUCER: &str = "FullScreenShot";

/// What the text layer actually achieved, for the caller to report honestly
/// rather than assume.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TextLayerReport {
    pub fragments_placed: usize,
    pub fragments_dropped: usize,
    pub links_placed: usize,
    pub links_dropped: usize,
}

impl TextLayerReport {
    pub fn has_text(&self) -> bool {
        self.fragments_placed > 0
    }
}

struct PagedFragment {
    x: f32,
    baseline_y: f32,
    size_pt: f32,
    horizontal_scale: f32,
    codes: Vec<u8>,
}

struct PagedLink {
    rect: Rect,
    uri: String,
}

struct RgbCollector {
    buf: Vec<u8>,
}

impl RowSink for RgbCollector {
    fn write_row(&mut self, row: &[u8]) -> Result<(), CoreError> {
        let (chunks, _) = row.as_chunks::<4>();
        for px in chunks {
            let a = px[3] as f32 / 255.0;
            let composite = |channel: u8| -> u8 {
                ((channel as f32) * a + 255.0 * (1.0 - a))
                    .round()
                    .clamp(0.0, 255.0) as u8
            };
            self.buf.push(composite(px[0]));
            self.buf.push(composite(px[1]));
            self.buf.push(composite(px[2]));
        }
        Ok(())
    }
}

fn zlib_compress(data: &[u8]) -> Result<Vec<u8>, CoreError> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(data)
        .map_err(|e| CoreError::Overflow(e.to_string()))?;
    encoder
        .finish()
        .map_err(|e| CoreError::Overflow(e.to_string()))
}

/// Builds a paginated raster PDF from an already-composed RGB buffer
/// (row-major, `width * height * 3` bytes, no alpha). Visual only — see
/// [`generate_hybrid_pdf`] for the searchable variant and
/// [`compose_full_page_pdf`] for the capture-side entry point.
pub fn generate_pdf_from_rgb(
    rgb: &[u8],
    width: u32,
    height: u32,
    page_size: PageSize,
    orientation: Orientation,
) -> Result<Vec<u8>, CoreError> {
    let (bytes, _) = generate_hybrid_pdf(
        rgb,
        width,
        height,
        page_size,
        orientation,
        None,
        PdfMetadata::default(),
    )?;
    Ok(bytes)
}

/// Lays `text` out over the composed capture and writes the hybrid PDF,
/// reporting what the text layer managed to place.
///
/// A fragment whose rectangle does not land in the composite is dropped, not
/// clamped: a scroll area's off-screen content and a `position: fixed` bar
/// that the compositor kept only once both produce coordinates outside the
/// image, and stacking them onto the nearest row would put invisible text
/// where the picture says there is none. What was dropped is counted and
/// returned, so the caller can say `textLayer=false` rather than claim a
/// searchable PDF it did not produce.
pub fn generate_hybrid_pdf(
    rgb: &[u8],
    width: u32,
    height: u32,
    page_size: PageSize,
    orientation: Orientation,
    text: Option<TextLayerInput<'_>>,
    metadata: PdfMetadata<'_>,
) -> Result<(Vec<u8>, TextLayerReport), CoreError> {
    if width == 0 || height == 0 || rgb.len() != (width as usize) * (height as usize) * 3 {
        return Err(CoreError::InvalidDimensions { width, height });
    }

    let layout = PageLayout::new(page_size, orientation, width, height)?;
    let page_count = layout.pages.len();

    // --- Place the semantic layer, page by page ---------------------------
    let mut codes = CodeAssignment::new();
    let mut report = TextLayerReport::default();
    let mut page_fragments: Vec<Vec<PagedFragment>> = (0..page_count).map(|_| Vec::new()).collect();
    let mut page_links: Vec<Vec<PagedLink>> = (0..page_count).map(|_| Vec::new()).collect();

    if let Some(input) = text.as_ref() {
        let mapping = SourceMapping::new(&layout, input.bands, input.dpr);

        for fragment in &input.layer.fragments {
            let placed = mapping.place(SourceRect {
                x: fragment.x,
                y: fragment.y,
                width: fragment.width,
                height: fragment.height,
            });
            let Some(placed) = placed else {
                report.fragments_dropped += 1;
                continue;
            };
            let (encoded, char_count) = codes.encode(&fragment.text);
            let size_pt = mapping.css_to_pt(fragment.font_size) as f64;
            if char_count == 0 || size_pt <= 0.0 {
                report.fragments_dropped += 1;
                continue;
            }

            // The run is as wide as the DOM said it was. Every glyph in this
            // font is exactly half an em, so the scale that stretches the run
            // onto its measured box is arithmetic, not a metrics lookup —
            // and getting it right is what makes a drag-selection highlight
            // cover the words it is over.
            let natural_width = char_count as f64 * GLYPH_ADVANCE_EM * size_pt;
            let horizontal_scale = (100.0 * placed.width as f64 / natural_width)
                .clamp(MIN_HORIZONTAL_SCALE, MAX_HORIZONTAL_SCALE);

            page_fragments[placed.page].push(PagedFragment {
                x: placed.x,
                baseline_y: (placed.y as f64 + BASELINE_ABOVE_BOX_BOTTOM_EM * size_pt) as f32,
                size_pt: size_pt as f32,
                horizontal_scale: horizontal_scale as f32,
                codes: encoded,
            });
            report.fragments_placed += 1;
        }

        for link in &input.layer.links {
            let placed = mapping.place(SourceRect {
                x: link.x,
                y: link.y,
                width: link.width,
                height: link.height,
            });
            let Some(placed) = placed else {
                report.links_dropped += 1;
                continue;
            };
            page_links[placed.page].push(PagedLink {
                rect: Rect::new(
                    placed.x,
                    placed.y,
                    placed.x + placed.width,
                    placed.y + placed.height,
                ),
                uri: link.uri.clone(),
            });
            report.links_placed += 1;
        }
    }

    let has_text = report.fragments_placed > 0 && !codes.is_empty();

    // --- Object identifiers ----------------------------------------------
    let mut pdf = Pdf::new();
    let mut next_id = 1_i32;
    let mut alloc = || {
        let id = Ref::new(next_id);
        next_id += 1;
        id
    };

    let catalog_id = alloc();
    let page_tree_id = alloc();
    let info_id = alloc();
    let page_ids: Vec<Ref> = (0..page_count).map(|_| alloc()).collect();
    let image_ids: Vec<Ref> = (0..page_count).map(|_| alloc()).collect();
    let content_ids: Vec<Ref> = (0..page_count).map(|_| alloc()).collect();
    let annotation_ids: Vec<Vec<Ref>> = page_links
        .iter()
        .map(|links| links.iter().map(|_| alloc()).collect())
        .collect();
    let font_ids = if has_text {
        Some(FontIds {
            type0: alloc(),
            cid_font: alloc(),
            descriptor: alloc(),
            font_file: alloc(),
            cid_to_gid: alloc(),
            to_unicode: alloc(),
        })
    } else {
        None
    };

    pdf.catalog(catalog_id).pages(page_tree_id);
    pdf.pages(page_tree_id)
        .kids(page_ids.iter().copied())
        .count(page_count as i32);

    let mut info = pdf.document_info(info_id);
    info.producer(TextStr(PRODUCER));
    info.creator(TextStr(PRODUCER));
    if let Some(title) = metadata.title.map(sanitized_title) {
        info.title(TextStr(&title));
        info.finish();
    } else {
        info.finish();
    }

    let row_len = width as usize * 3;

    for (i, &(start_row, end_row)) in layout.pages.iter().enumerate() {
        let start_row = start_row as usize;
        let end_row = end_row as usize;
        let band_rows = end_row - start_row;
        let band_rgb = &rgb[start_row * row_len..end_row * row_len];
        let compressed = zlib_compress(band_rgb)?;
        let band_height_pt = band_rows as f32 * layout.scale;

        let mut page = pdf.page(page_ids[i]);
        page.media_box(Rect::new(
            0.0,
            0.0,
            layout.page_width_pt,
            layout.page_height_pt,
        ));
        page.parent(page_tree_id);
        page.contents(content_ids[i]);
        {
            let mut resources = page.resources();
            resources.x_objects().pair(IMAGE_RESOURCE, image_ids[i]);
            if let Some(fonts) = font_ids.as_ref() {
                resources.fonts().pair(FONT_RESOURCE, fonts.type0);
            }
            resources.finish();
        }
        if !annotation_ids[i].is_empty() {
            page.annotations(annotation_ids[i].iter().copied());
        }
        page.finish();

        let mut image = pdf.image_xobject(image_ids[i], &compressed);
        image.filter(Filter::FlateDecode);
        image.width(width as i32);
        image.height(band_rows as i32);
        image.color_space().device_rgb();
        image.bits_per_component(8);
        image.finish();

        let mut content = Content::new();
        content.save_state();
        content.transform([
            width as f32 * layout.scale,
            0.0,
            0.0,
            band_height_pt,
            0.0,
            layout.page_height_pt - band_height_pt,
        ]);
        content.x_object(IMAGE_RESOURCE);
        content.restore_state();

        if !page_fragments[i].is_empty() {
            content.begin_text();
            // Mode 3: the glyphs take part in selection, search and copy, and
            // are never painted. Not white text, not a zero opacity, not a
            // one-point font — those are all approximations readers disagree
            // about, and any of them would risk showing through the
            // screenshot the PDF exists to preserve.
            content.set_text_rendering_mode(TextRenderingMode::Invisible);
            for fragment in &page_fragments[i] {
                content.set_font(FONT_RESOURCE, fragment.size_pt);
                content.set_horizontal_scaling(fragment.horizontal_scale);
                content.set_text_matrix([1.0, 0.0, 0.0, 1.0, fragment.x, fragment.baseline_y]);
                content.show(Str(&fragment.codes));
            }
            content.end_text();
        }
        pdf.stream(content_ids[i], &content.finish());

        for (link, &id) in page_links[i].iter().zip(annotation_ids[i].iter()) {
            let mut annotation = pdf.annotation(id);
            annotation.subtype(AnnotationType::Link);
            annotation.rect(link.rect);
            // No border, and no appearance stream: the screenshot already
            // shows the link the way the page drew it, and a reader-drawn
            // rectangle on top would be the one mark the PDF adds that the
            // capture never had.
            annotation.border(0.0, 0.0, 0.0, None);
            annotation.flags(AnnotationFlags::PRINT);
            annotation
                .action()
                .action_type(ActionType::Uri)
                .uri(Str(link.uri.as_bytes()))
                .finish();
            annotation.finish();
        }
    }

    if let Some(fonts) = font_ids.as_ref() {
        write_invisible_font(&mut pdf, fonts, &codes)?;
    }

    Ok((pdf.finish(), report))
}

struct FontIds {
    type0: Ref,
    cid_font: Ref,
    descriptor: Ref,
    font_file: Ref,
    cid_to_gid: Ref,
    to_unicode: Ref,
}

/// Writes the `Type0` font the invisible layer is shown in: an `Identity-H`
/// encoding over a single blank glyph, with `/ToUnicode` carrying the real
/// characters. See `crate::font` for why the glyphs are blank.
fn write_invisible_font(
    pdf: &mut Pdf,
    ids: &FontIds,
    codes: &CodeAssignment,
) -> Result<(), CoreError> {
    let base_font = Name(b"FSSInvisible");
    let system_info = SystemInfo {
        registry: Str(b"Adobe"),
        ordering: Str(b"Identity"),
        supplement: 0,
    };

    let mut type0 = pdf.type0_font(ids.type0);
    type0.base_font(base_font);
    type0.encoding_predefined(Name(b"Identity-H"));
    type0.descendant_font(ids.cid_font);
    type0.to_unicode(ids.to_unicode);
    type0.finish();

    let mut cid = pdf.cid_font(ids.cid_font);
    cid.subtype(CidFontType::Type2);
    cid.base_font(base_font);
    cid.system_info(system_info);
    cid.font_descriptor(ids.descriptor);
    // One width for every glyph, so no `/W` array is needed at all.
    cid.default_width(crate::font::GLYPH_ADVANCE_UNITS as f32);
    cid.cid_to_gid_map_stream(ids.cid_to_gid);
    cid.finish();

    let mut descriptor = pdf.font_descriptor(ids.descriptor);
    descriptor.name(base_font);
    descriptor.flags(FontFlags::SYMBOLIC);
    descriptor.bbox(Rect::new(0.0, -200.0, 500.0, 800.0));
    descriptor.italic_angle(0.0);
    descriptor.ascent(800.0);
    descriptor.descent(-200.0);
    descriptor.cap_height(700.0);
    descriptor.stem_v(80.0);
    descriptor.font_file2(ids.font_file);
    descriptor.finish();

    let font_bytes = glyphless_truetype();
    let compressed_font = zlib_compress(&font_bytes)?;
    let mut font_file = pdf.stream(ids.font_file, &compressed_font);
    font_file.filter(Filter::FlateDecode);
    font_file.pair(Name(b"Length1"), font_bytes.len() as i32);
    font_file.finish();

    let gid_map = cid_to_gid_map(codes.max_code());
    let compressed_map = zlib_compress(&gid_map)?;
    let mut map_stream = pdf.stream(ids.cid_to_gid, &compressed_map);
    map_stream.filter(Filter::FlateDecode);
    map_stream.finish();

    let mut cmap = UnicodeCmap::<u16>::new(Name(b"FSSInvisible"), system_info);
    for (code, character) in codes.pairs() {
        cmap.pair(code, character);
    }
    let cmap_bytes = cmap.finish();
    let compressed_cmap = zlib_compress(&cmap_bytes)?;
    let mut cmap_stream = pdf.cmap(ids.to_unicode, &compressed_cmap);
    cmap_stream.filter(Filter::FlateDecode);
    cmap_stream.finish();

    Ok(())
}

/// A document title fit for PDF metadata: no control characters, and short
/// enough that a hostile `<title>` cannot bloat every export.
fn sanitized_title(title: &str) -> String {
    title
        .chars()
        .filter(|c| !c.is_control())
        .take(300)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Composes `tiles` per `plan`/`dpr` (same inputs as
/// `screenshot_png::compose_full_page_png`) into an RGB buffer, then
/// paginates it into a raster PDF. Unlike the PNG path this does not
/// stream — see ADR-0004's "Consequences" for why that's an accepted,
/// scoped exception.
pub fn compose_full_page_pdf(
    plan: &CapturePlan,
    dpr: f64,
    tiles: &[TileImage<'_>],
    page_size: PageSize,
    orientation: Orientation,
) -> Result<Vec<u8>, CoreError> {
    let (bytes, _) = compose_hybrid_pdf(
        plan,
        dpr,
        tiles,
        page_size,
        orientation,
        None,
        PdfMetadata::default(),
    )?;
    Ok(bytes)
}

/// The capture-side entry point for a hybrid PDF: composes the tiles exactly
/// as the PNG export would, then lays `layer` over the result using the band
/// map that composition produced.
pub fn compose_hybrid_pdf(
    plan: &CapturePlan,
    dpr: f64,
    tiles: &[TileImage<'_>],
    page_size: PageSize,
    orientation: Orientation,
    layer: Option<&TextLayer>,
    metadata: PdfMetadata<'_>,
) -> Result<(Vec<u8>, TextLayerReport), CoreError> {
    let height = expected_output_height(plan, dpr, tiles)?;
    let width = tiles
        .first()
        .map(|t| t.meta.width)
        .ok_or(CoreError::InvalidDimensions {
            width: 0,
            height: 0,
        })?;

    let bands = band_map(plan, dpr, tiles)?;
    let mut collector = RgbCollector {
        buf: Vec::with_capacity(width as usize * height as usize * 3),
    };
    compose_streaming(plan, dpr, tiles, &mut collector)?;

    let input = layer.map(|layer| TextLayerInput {
        layer,
        bands: &bands,
        dpr,
    });
    generate_hybrid_pdf(
        &collector.buf,
        width,
        height,
        page_size,
        orientation,
        input,
        metadata,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_rgb(width: u32, height: u32, color: [u8; 3]) -> Vec<u8> {
        let mut buf = Vec::with_capacity(width as usize * height as usize * 3);
        for _ in 0..(width * height) {
            buf.extend_from_slice(&color);
        }
        buf
    }

    /// Counts `/Type /Page` object declarations, excluding the `/Type
    /// /Pages` tree root (which also contains the substring `/Type
    /// /Page`), and asserts the PDF has a valid header/trailer.
    fn assert_valid_pdf_structure(bytes: &[u8], expected_page_count: usize) {
        assert!(bytes.starts_with(b"%PDF-"), "missing PDF header");
        let tail = &bytes[bytes.len().saturating_sub(64)..];
        assert!(
            tail.windows(5).any(|w| w == b"%%EOF"),
            "missing PDF trailer %%EOF"
        );

        let text = String::from_utf8_lossy(bytes);
        let page_object_count =
            text.matches("/Type /Page").count() - text.matches("/Type /Pages").count();
        assert_eq!(
            page_object_count, expected_page_count,
            "unexpected page count"
        );
    }

    #[test]
    fn single_page_auto_pdf_is_structurally_valid() {
        let rgb = solid_rgb(10, 20, [255, 0, 0]);
        let bytes =
            generate_pdf_from_rgb(&rgb, 10, 20, PageSize::Auto, Orientation::Portrait).unwrap();
        assert_valid_pdf_structure(&bytes, 1);
    }

    #[test]
    fn a4_portrait_paginates_tall_content_into_multiple_pages() {
        // A tall, narrow image at A4 width (roughly matched) forces >1 page.
        let rgb = solid_rgb(800, 20000, [10, 20, 30]);
        let bytes =
            generate_pdf_from_rgb(&rgb, 800, 20000, PageSize::A4, Orientation::Portrait).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        let text = String::from_utf8_lossy(&bytes);
        let page_object_count =
            text.matches("/Type /Page").count() - text.matches("/Type /Pages").count();
        assert!(
            page_object_count > 1,
            "expected multiple pages, got {page_object_count}"
        );
    }

    #[test]
    fn letter_and_a4_produce_different_byte_output() {
        let rgb = solid_rgb(800, 3000, [1, 2, 3]);
        let a4 =
            generate_pdf_from_rgb(&rgb, 800, 3000, PageSize::A4, Orientation::Portrait).unwrap();
        let letter =
            generate_pdf_from_rgb(&rgb, 800, 3000, PageSize::Letter, Orientation::Portrait)
                .unwrap();
        assert_ne!(a4, letter);
    }

    #[test]
    fn landscape_swaps_page_dimensions_relative_to_portrait() {
        let rgb = solid_rgb(800, 400, [5, 6, 7]);
        let portrait =
            generate_pdf_from_rgb(&rgb, 800, 400, PageSize::Letter, Orientation::Portrait).unwrap();
        let landscape =
            generate_pdf_from_rgb(&rgb, 800, 400, PageSize::Letter, Orientation::Landscape)
                .unwrap();
        assert_ne!(portrait, landscape);
    }

    #[test]
    fn rejects_zero_dimensions() {
        assert!(generate_pdf_from_rgb(&[], 0, 10, PageSize::Auto, Orientation::Portrait).is_err());
        assert!(generate_pdf_from_rgb(&[], 10, 0, PageSize::Auto, Orientation::Portrait).is_err());
    }

    #[test]
    fn rejects_mismatched_buffer_length() {
        let rgb = vec![0u8; 5]; // not width*height*3
        assert!(
            generate_pdf_from_rgb(&rgb, 10, 10, PageSize::Auto, Orientation::Portrait).is_err()
        );
    }

    // --- hybrid PDF ------------------------------------------------------

    use crate::text_layer::TextLayer;
    use flate2::read::ZlibDecoder;
    use std::io::Read;

    fn single_band(height: u32) -> [Band; 1] {
        [Band {
            source_offset_css: 0.0,
            device_row_start: 0,
            device_rows: height,
        }]
    }

    fn hybrid(
        width: u32,
        height: u32,
        json: &str,
        page_size: PageSize,
    ) -> (Vec<u8>, TextLayerReport) {
        let rgb = solid_rgb(width, height, [255, 255, 255]);
        let layer = TextLayer::from_untrusted_json(json).unwrap();
        let bands = single_band(height);
        generate_hybrid_pdf(
            &rgb,
            width,
            height,
            page_size,
            Orientation::Portrait,
            Some(TextLayerInput {
                layer: &layer,
                bands: &bands,
                dpr: 1.0,
            }),
            PdfMetadata::default(),
        )
        .unwrap()
    }

    /// Every `stream`/`endstream` payload in the file, raw.
    fn streams(pdf: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        let mut i = 0;
        while let Some(rel) = find(&pdf[i..], b"stream") {
            let mut start = i + rel + b"stream".len();
            // `endstream` also matches "stream"; skip those.
            if pdf[i + rel..].starts_with(b"stream")
                && i + rel >= 3
                && &pdf[i + rel - 3..i + rel] == b"end"
            {
                i = start;
                continue;
            }
            while matches!(pdf.get(start), Some(b'\r') | Some(b'\n')) {
                start += 1;
            }
            let Some(rel_end) = find(&pdf[start..], b"endstream") else {
                break;
            };
            let mut end = start + rel_end;
            while end > start && matches!(pdf[end - 1], b'\r' | b'\n') {
                end -= 1;
            }
            out.push(pdf[start..end].to_vec());
            i = start + rel_end;
        }
        out
    }

    fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|w| w == needle)
    }

    fn inflate(data: &[u8]) -> Option<Vec<u8>> {
        let mut out = Vec::new();
        ZlibDecoder::new(data).read_to_end(&mut out).ok()?;
        Some(out)
    }

    /// The `/ToUnicode` map, as a reader would read it: code → character.
    fn to_unicode_map(pdf: &[u8]) -> std::collections::HashMap<u16, String> {
        let cmap = streams(pdf)
            .iter()
            .filter_map(|s| inflate(s))
            .find(|d| find(d, b"beginbfchar").is_some())
            .expect("the PDF must carry a /ToUnicode map");
        let text = String::from_utf8_lossy(&cmap).into_owned();
        let mut map = std::collections::HashMap::new();
        for line in text.lines() {
            let line = line.trim();
            if !line.starts_with('<') {
                continue;
            }
            let parts: Vec<&str> = line
                .split(['<', '>'])
                .filter(|p| !p.trim().is_empty())
                .collect();
            if parts.len() != 2 {
                continue;
            }
            let code = u16::from_str_radix(parts[0].trim(), 16).unwrap();
            let units: Vec<u16> = parts[1]
                .trim()
                .as_bytes()
                .chunks(4)
                .map(|c| u16::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap())
                .collect();
            map.insert(code, String::from_utf16(&units).unwrap());
        }
        map
    }

    /// A content stream: the ones that draw this export's page raster.
    fn is_content_stream(stream: &[u8]) -> bool {
        find(stream, b"/Im0 Do").is_some()
    }

    /// Every string a `Tj` shows, decoded from PDF literal-string syntax —
    /// `Str` writes `(...)` with octal escapes, not hex, and a test that
    /// assumed otherwise would be testing its own assumption.
    fn shown_strings(stream: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < stream.len() {
            if stream[i] != b'(' {
                i += 1;
                continue;
            }
            let mut j = i + 1;
            let mut depth = 1usize;
            let mut bytes = Vec::new();
            while j < stream.len() {
                match stream[j] {
                    b'\\' => {
                        j += 1;
                        match stream.get(j) {
                            Some(b'n') => {
                                bytes.push(b'\n');
                                j += 1;
                            }
                            Some(b'r') => {
                                bytes.push(b'\r');
                                j += 1;
                            }
                            Some(b't') => {
                                bytes.push(b'\t');
                                j += 1;
                            }
                            Some(b'b') => {
                                bytes.push(0x08);
                                j += 1;
                            }
                            Some(b'f') => {
                                bytes.push(0x0C);
                                j += 1;
                            }
                            Some(&c @ b'0'..=b'7') => {
                                let mut value = u32::from(c - b'0');
                                j += 1;
                                for _ in 0..2 {
                                    match stream.get(j) {
                                        Some(&d @ b'0'..=b'7') => {
                                            value = value * 8 + u32::from(d - b'0');
                                            j += 1;
                                        }
                                        _ => break,
                                    }
                                }
                                bytes.push(value as u8);
                            }
                            Some(&c) => {
                                bytes.push(c);
                                j += 1;
                            }
                            None => break,
                        }
                    }
                    b'(' => {
                        depth += 1;
                        bytes.push(b'(');
                        j += 1;
                    }
                    b')' => {
                        depth -= 1;
                        j += 1;
                        if depth == 0 {
                            break;
                        }
                        bytes.push(b')');
                    }
                    c => {
                        bytes.push(c);
                        j += 1;
                    }
                }
            }
            if stream[j..].starts_with(b" Tj") {
                out.push(bytes);
            }
            i = j;
        }
        out
    }

    /// Everything a reader would extract, in the order the content stream
    /// shows it — the actual answer to "is this PDF searchable".
    fn extracted_text(pdf: &[u8]) -> String {
        let map = to_unicode_map(pdf);
        let mut out = String::new();
        for stream in streams(pdf) {
            if !is_content_stream(&stream) {
                continue;
            }
            for shown in shown_strings(&stream) {
                let (codes, _) = shown.as_chunks::<2>();
                for code in codes {
                    let code = u16::from_be_bytes(*code);
                    out.push_str(map.get(&code).map(String::as_str).unwrap_or("\u{FFFD}"));
                }
                out.push('\n');
            }
        }
        out
    }

    fn content_streams(pdf: &[u8]) -> String {
        streams(pdf)
            .iter()
            .filter(|s| is_content_stream(s))
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect::<Vec<_>>()
            .join("\n")
    }

    const SPANISH: &str = r#"{"fragments":[
        {"text":"Información de auditoría","x":40,"y":40,"w":200,"h":22,"size":19},
        {"text":"Perú señal ñÑüÜ","x":40,"y":120,"w":160,"h":18,"size":16}],
      "links":[{"uri":"https://example.com/destino","x":40,"y":200,"w":180,"h":18}]}"#;

    #[test]
    fn invisible_text_is_written_in_rendering_mode_three() {
        let (bytes, _) = hybrid(600, 800, SPANISH, PageSize::Auto);
        let content = content_streams(&bytes);
        assert!(content.contains("BT"), "no text object was opened");
        assert!(
            content.contains("3 Tr"),
            "text must be invisible via rendering mode 3, not by any colour trick"
        );
        assert!(content.contains("ET"));
        // The screenshot stays the only thing that paints.
        assert!(
            !content.contains("rg"),
            "the text layer must set no fill colour"
        );
        assert!(
            !content.contains("gs"),
            "the text layer must set no transparency state"
        );
    }

    #[test]
    fn text_is_extractable_exactly_as_the_dom_had_it() {
        let (bytes, report) = hybrid(600, 800, SPANISH, PageSize::Auto);
        assert_eq!(report.fragments_placed, 2);
        let extracted = extracted_text(&bytes);
        assert!(
            extracted.contains("Información de auditoría"),
            "accented text did not survive: {extracted:?}"
        );
        assert!(extracted.contains("Perú señal ñÑüÜ"), "got {extracted:?}");
        assert!(
            !extracted.contains('\u{FFFD}'),
            "a character had no /ToUnicode entry"
        );
    }

    #[test]
    fn text_beyond_the_basic_multilingual_plane_survives_too() {
        let (bytes, _) = hybrid(
            400,
            400,
            r#"{"fragments":[{"text":"中文 🙂 ok","x":10,"y":10,"w":100,"h":18,"size":16}]}"#,
            PageSize::Auto,
        );
        assert!(extracted_text(&bytes).contains("中文 🙂 ok"));
    }

    #[test]
    fn reading_order_follows_the_dom_not_the_geometry() {
        let (bytes, _) = hybrid(
            400,
            600,
            r#"{"fragments":[
                {"text":"alpha","x":10,"y":300,"w":40,"h":18,"size":16},
                {"text":"beta","x":10,"y":10,"w":40,"h":18,"size":16}]}"#,
            PageSize::Auto,
        );
        let extracted = extracted_text(&bytes);
        let alpha = extracted.find("alpha").unwrap();
        let beta = extracted.find("beta").unwrap();
        assert!(
            alpha < beta,
            "the extractor's DOM order must reach the PDF unchanged"
        );
    }

    #[test]
    fn a_link_becomes_an_annotation_carrying_the_resolved_uri() {
        let (bytes, report) = hybrid(600, 800, SPANISH, PageSize::Auto);
        assert_eq!(report.links_placed, 1);
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("/Subtype /Link"));
        assert!(text.contains("/S /URI"));
        assert!(text.contains("(https://example.com/destino)"));
        assert!(text.contains("/Annots"));
        // The annotation adds no mark of its own to a page that is a
        // screenshot of how the link already looked.
        assert!(text.contains("/Border [0 0 0]"));
    }

    #[test]
    fn a_link_annotation_sits_where_the_link_was_drawn() {
        // 800pt-tall Auto page, link box at CSS y 200..218 from the top, so
        // PDF y 582..600 measured from the bottom.
        let (bytes, _) = hybrid(600, 800, SPANISH, PageSize::Auto);
        let text = String::from_utf8_lossy(&bytes);
        assert!(
            text.contains("/Rect [40 582 220 600]"),
            "annotation rectangle is not over the link"
        );
    }

    #[test]
    fn a_rejected_scheme_never_reaches_the_pdf() {
        let (bytes, report) = hybrid(
            400,
            400,
            r#"{"links":[
                {"uri":"javascript:alert(1)","x":10,"y":10,"w":50,"h":18},
                {"uri":"data:text/html,<script>","x":10,"y":40,"w":50,"h":18}]}"#,
            PageSize::Auto,
        );
        assert_eq!(report.links_placed, 0);
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains("javascript"));
        assert!(!text.contains("/Subtype /Link"));
    }

    /// The whole promise of a hybrid PDF: the picture is untouched.
    #[test]
    fn the_text_layer_does_not_change_a_single_pixel_of_the_raster() {
        // The same pixels either way — only the semantic layer differs.
        let rgb = solid_rgb(120, 200, [255, 255, 255]);
        let visual_only =
            generate_pdf_from_rgb(&rgb, 120, 200, PageSize::Auto, Orientation::Portrait).unwrap();
        let (with_text, report) = hybrid(120, 200, SPANISH, PageSize::Auto);
        assert!(
            report.has_text(),
            "the comparison is only meaningful with text present"
        );

        let raster = |pdf: &[u8]| -> Vec<Vec<u8>> {
            streams(pdf)
                .iter()
                .filter_map(|s| inflate(s))
                .filter(|d| d.len() == 120 * 200 * 3)
                .collect()
        };
        assert_eq!(
            raster(&visual_only),
            raster(&with_text),
            "the image XObject must be byte-identical with and without a text layer"
        );

        // And the drawing operators that place it are the same too.
        let image_ops = |pdf: &[u8]| -> Vec<String> {
            content_streams(pdf)
                .lines()
                .filter(|l| {
                    l.ends_with(" cm")
                        || l.trim() == "/Im0 Do"
                        || l.trim() == "q"
                        || l.trim() == "Q"
                })
                .map(|l| l.trim().to_string())
                .collect()
        };
        assert_eq!(image_ops(&visual_only), image_ops(&with_text));
    }

    #[test]
    fn a_capture_with_no_text_layer_writes_no_text_objects_at_all() {
        let rgb = solid_rgb(100, 100, [1, 2, 3]);
        let (bytes, report) = generate_hybrid_pdf(
            &rgb,
            100,
            100,
            PageSize::Auto,
            Orientation::Portrait,
            None,
            PdfMetadata::default(),
        )
        .unwrap();
        assert!(!report.has_text());
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains("/Font"), "no font should be embedded");
        assert!(!content_streams(&bytes).contains("BT"));
        assert!(
            content_streams(&bytes).contains("/Im0 Do"),
            "the raster is still drawn"
        );
    }

    #[test]
    fn a_line_crossing_a_page_break_is_written_exactly_once() {
        // Tall enough at A4 to need several pages.
        let rgb = solid_rgb(800, 6000, [255, 255, 255]);
        let layer = TextLayer::from_untrusted_json(
            r#"{"fragments":[{"text":"straddle","x":10,"y":1118,"w":60,"h":20,"size":16}]}"#,
        )
        .unwrap();
        let bands = single_band(6000);
        let (bytes, report) = generate_hybrid_pdf(
            &rgb,
            800,
            6000,
            PageSize::A4,
            Orientation::Portrait,
            Some(TextLayerInput {
                layer: &layer,
                bands: &bands,
                dpr: 1.0,
            }),
            PdfMetadata::default(),
        )
        .unwrap();
        assert_eq!(report.fragments_placed, 1);
        assert_eq!(extracted_text(&bytes).matches("straddle").count(), 1);
    }

    #[test]
    fn text_outside_the_composite_is_dropped_and_counted() {
        let (bytes, report) = hybrid(
            400,
            400,
            r#"{"fragments":[
                {"text":"inside","x":10,"y":10,"w":40,"h":18,"size":16},
                {"text":"below","x":10,"y":900,"w":40,"h":18,"size":16},
                {"text":"beside","x":900,"y":10,"w":40,"h":18,"size":16}]}"#,
            PageSize::Auto,
        );
        assert_eq!(report.fragments_placed, 1);
        assert_eq!(report.fragments_dropped, 2);
        let extracted = extracted_text(&bytes);
        assert!(extracted.contains("inside"));
        assert!(!extracted.contains("below"));
        assert!(!extracted.contains("beside"));
    }

    #[test]
    fn a_run_is_scaled_to_the_width_the_dom_measured() {
        // 10 characters at 16pt: the font's own width is 10 * 0.5 * 16 = 80pt,
        // and the DOM says the line is 160pt wide, so the run must be
        // stretched to exactly 200%.
        let (bytes, _) = hybrid(
            400,
            400,
            r#"{"fragments":[{"text":"0123456789","x":0,"y":0,"w":160,"h":18,"size":16}]}"#,
            PageSize::Auto,
        );
        assert!(
            content_streams(&bytes).contains("200 Tz"),
            "selection width comes from Tz: {}",
            content_streams(&bytes)
        );
    }

    #[test]
    fn metadata_names_the_producer_and_nothing_private() {
        let rgb = solid_rgb(50, 50, [0, 0, 0]);
        let (bytes, _) = generate_hybrid_pdf(
            &rgb,
            50,
            50,
            PageSize::Auto,
            Orientation::Portrait,
            None,
            PdfMetadata {
                title: Some("Página de\u{0007} aceptación"),
            },
        )
        .unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("/Producer"));
        assert!(text.contains("/Creator"));
        assert!(text.contains("/Title"));
        // Control characters are stripped rather than escaped into the file.
        assert!(!bytes.windows(1).any(|w| w == [0x07]));
    }

    #[test]
    fn compose_full_page_pdf_produces_valid_multi_tile_output() {
        use screenshot_core::compositor::TileImageMeta;
        use screenshot_core::geometry::Size;
        use screenshot_core::tile::TileId;

        let viewport = Size {
            width: 4.0,
            height: 3.0,
        };
        let plan = CapturePlan::from_offsets(&[0.0, 2.0], viewport);

        let mut rgba_a = Vec::new();
        for _ in 0..(4 * 3) {
            rgba_a.extend_from_slice(&[200, 0, 0, 255]);
        }
        let mut rgba_b = Vec::new();
        for _ in 0..(4 * 3) {
            rgba_b.extend_from_slice(&[0, 200, 0, 255]);
        }

        let tiles = [
            TileImage {
                meta: TileImageMeta {
                    tile_id: TileId(0),
                    width: 4,
                    height: 3,
                },
                rgba: &rgba_a,
            },
            TileImage {
                meta: TileImageMeta {
                    tile_id: TileId(1),
                    width: 4,
                    height: 3,
                },
                rgba: &rgba_b,
            },
        ];

        let bytes =
            compose_full_page_pdf(&plan, 1.0, &tiles, PageSize::Auto, Orientation::Portrait)
                .unwrap();
        assert_valid_pdf_structure(&bytes, 1);
    }
}
