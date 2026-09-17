// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use flate2::write::ZlibEncoder;
use flate2::Compression;
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref};
use std::io::Write;

use screenshot_core::capture_plan::CapturePlan;
use screenshot_core::compositor::{compose_streaming, expected_output_height, RowSink, TileImage};
use screenshot_core::CoreError;

use crate::paginator::paginate;

/// Physical page size. `A4`/`Letter` scale the composed capture to fit the
/// page width ("Fit Width"); `Auto` uses the capture's own pixel
/// dimensions as the page size 1:1 ("Original Scale") and is always a
/// single page — see the P3 design spec for why these two scale modes
/// are tied to page-size choice rather than offered independently.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PageSize {
    A4,
    Letter,
    Auto,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Orientation {
    Portrait,
    Landscape,
}

const A4_WIDTH_PT: f32 = 595.28;
const A4_HEIGHT_PT: f32 = 841.89;
const LETTER_WIDTH_PT: f32 = 612.0;
const LETTER_HEIGHT_PT: f32 = 792.0;

fn page_dimensions_pt(
    page_size: PageSize,
    orientation: Orientation,
    image_width_px: u32,
    image_height_px: u32,
) -> (f32, f32) {
    let (w, h) = match page_size {
        PageSize::A4 => (A4_WIDTH_PT, A4_HEIGHT_PT),
        PageSize::Letter => (LETTER_WIDTH_PT, LETTER_HEIGHT_PT),
        PageSize::Auto => (image_width_px as f32, image_height_px as f32),
    };
    match (page_size, orientation) {
        (PageSize::Auto, _) => (w, h),
        (_, Orientation::Landscape) => (h, w),
        (_, Orientation::Portrait) => (w, h),
    }
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

/// Builds a paginated raster PDF directly from an already-composed RGB
/// buffer (row-major, `width * height * 3` bytes, no alpha — see
/// `compose_full_page_pdf` for the full-page-capture entry point that
/// composes tiles into this buffer first).
pub fn generate_pdf_from_rgb(
    rgb: &[u8],
    width: u32,
    height: u32,
    page_size: PageSize,
    orientation: Orientation,
) -> Result<Vec<u8>, CoreError> {
    if width == 0 || height == 0 || rgb.len() != (width as usize) * (height as usize) * 3 {
        return Err(CoreError::InvalidDimensions { width, height });
    }

    let (page_width_pt, page_height_pt) = page_dimensions_pt(page_size, orientation, width, height);
    let scale = page_width_pt / width as f32;
    let page_content_height_px = if page_size == PageSize::Auto {
        height as f64
    } else {
        (page_height_pt / scale) as f64
    };

    let pages = paginate(height as f64, page_content_height_px)?;
    if pages.is_empty() {
        return Err(CoreError::InvalidDimensions { width, height });
    }

    let mut pdf = Pdf::new();
    let mut next_id = 1_i32;
    let mut alloc = || {
        let id = Ref::new(next_id);
        next_id += 1;
        id
    };

    let catalog_id = alloc();
    let page_tree_id = alloc();
    let page_ids: Vec<Ref> = pages.iter().map(|_| alloc()).collect();
    let image_ids: Vec<Ref> = pages.iter().map(|_| alloc()).collect();
    let content_ids: Vec<Ref> = pages.iter().map(|_| alloc()).collect();

    pdf.catalog(catalog_id).pages(page_tree_id);
    pdf.pages(page_tree_id)
        .kids(page_ids.iter().copied())
        .count(page_ids.len() as i32);

    let row_len = width as usize * 3;
    let image_name = Name(b"Im0");

    for (i, &(start, end)) in pages.iter().enumerate() {
        let start_row = start.round() as usize;
        let end_row = (end.round() as usize).min(height as usize);
        let band_rows = end_row.saturating_sub(start_row);
        if band_rows == 0 {
            continue;
        }
        let band_start_byte = start_row * row_len;
        let band_end_byte = end_row * row_len;
        let band_rgb = &rgb[band_start_byte..band_end_byte];
        let compressed = zlib_compress(band_rgb)?;

        let band_height_pt = band_rows as f32 * scale;

        let mut page = pdf.page(page_ids[i]);
        page.media_box(Rect::new(0.0, 0.0, page_width_pt, page_height_pt));
        page.parent(page_tree_id);
        page.contents(content_ids[i]);
        page.resources().x_objects().pair(image_name, image_ids[i]);
        page.finish();

        let mut image = pdf.image_xobject(image_ids[i], &compressed);
        image.filter(Filter::FlateDecode);
        image.width(width as i32);
        image.height(band_rows as i32);
        image.color_space().device_rgb();
        image.bits_per_component(8);
        image.finish();

        let image_width_pt = width as f32 * scale;
        let y = page_height_pt - band_height_pt;
        let mut content = Content::new();
        content.save_state();
        content.transform([image_width_pt, 0.0, 0.0, band_height_pt, 0.0, y]);
        content.x_object(image_name);
        content.restore_state();
        pdf.stream(content_ids[i], &content.finish());
    }

    Ok(pdf.finish())
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
    let height = expected_output_height(plan, dpr)?;
    let width = tiles
        .first()
        .map(|t| t.meta.width)
        .ok_or(CoreError::InvalidDimensions {
            width: 0,
            height: 0,
        })?;

    let mut collector = RgbCollector {
        buf: Vec::with_capacity(width as usize * height as usize * 3),
    };
    compose_streaming(plan, dpr, tiles, &mut collector)?;

    generate_pdf_from_rgb(&collector.buf, width, height, page_size, orientation)
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
