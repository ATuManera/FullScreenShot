// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

//! The one coordinate transform in the PDF export.
//!
//! Three spaces meet here:
//!
//! 1. **Source CSS px** — what the DOM measured. Document coordinates for a
//!    full-page capture; the container's own content coordinates for a scroll
//!    area. The origin is top-left and y grows downward.
//! 2. **Composite device px** — the stitched screenshot. Reached through the
//!    compositor's [`Band`] map, never through `y * dpr`: the bands are where
//!    the browser's own rounding at each scroll seam is already accounted for,
//!    and re-deriving the position from CSS arithmetic is precisely the class
//!    of bug that produced the fractional-DPR failures this project has
//!    already paid for once.
//! 3. **PDF user space** — points, origin bottom-left, y growing *upward*, one
//!    page at a time.
//!
//! Both the raster and the invisible text layer are placed from
//! [`PageLayout`], so a page's image and the text over it cannot disagree
//! about where a row is.

use screenshot_core::compositor::Band;
use screenshot_core::CoreError;

use crate::paginator::paginate;

const A4_WIDTH_PT: f32 = 595.28;
const A4_HEIGHT_PT: f32 = 841.89;
const LETTER_WIDTH_PT: f32 = 612.0;
const LETTER_HEIGHT_PT: f32 = 792.0;

/// Physical page size. `A4`/`Letter` scale the composed capture to fit the
/// page width ("Fit Width"); `Auto` uses the capture's own pixel dimensions as
/// the page size 1:1 ("Original Scale") and is always a single page — see the
/// P3 design spec for why these two scale modes are tied to page-size choice
/// rather than offered independently.
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

/// A rectangle in source CSS px, as `getClientRects()` reports one once the
/// scroll origin has been added back.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SourceRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A rectangle placed on one PDF page, in PDF user space: `(x, y)` is its
/// **bottom-left** corner, because that is the corner PDF measures from.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlacedRect {
    pub page: usize,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// How the composite is cut into pages, and how composite pixels become
/// points. Built once per export and shared by the image writer and the text
/// writer.
#[derive(Debug, Clone, PartialEq)]
pub struct PageLayout {
    pub page_width_pt: f32,
    pub page_height_pt: f32,
    /// Composite device px → PDF pt.
    pub scale: f32,
    /// Each page's half-open row range in the composite, already rounded to
    /// whole rows and clamped to the image. The image writer slices these
    /// exact rows, so the text writer must measure from the same numbers.
    pub pages: Vec<(u32, u32)>,
    pub composite_width: u32,
    pub composite_height: u32,
}

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

impl PageLayout {
    pub fn new(
        page_size: PageSize,
        orientation: Orientation,
        width: u32,
        height: u32,
    ) -> Result<PageLayout, CoreError> {
        if width == 0 || height == 0 {
            return Err(CoreError::InvalidDimensions { width, height });
        }
        let (page_width_pt, page_height_pt) =
            page_dimensions_pt(page_size, orientation, width, height);
        let scale = page_width_pt / width as f32;
        let page_content_height_px = if page_size == PageSize::Auto {
            height as f64
        } else {
            (page_height_pt / scale) as f64
        };

        // Rounded to whole rows here, once, so that "which rows are on page
        // n" has exactly one answer for the image and the text alike. Empty
        // ranges are dropped rather than emitted as page objects with no
        // content — a page in `/Kids` whose object was never written is a
        // corrupt file.
        let pages: Vec<(u32, u32)> = paginate(height as f64, page_content_height_px)?
            .into_iter()
            .map(|(start, end)| {
                let start_row = start.round().max(0.0) as u32;
                let end_row = (end.round().max(0.0) as u32).min(height);
                (start_row, end_row)
            })
            .filter(|(start, end)| end > start)
            .collect();
        if pages.is_empty() {
            return Err(CoreError::InvalidDimensions { width, height });
        }

        Ok(PageLayout {
            page_width_pt,
            page_height_pt,
            scale,
            pages,
            composite_width: width,
            composite_height: height,
        })
    }

    /// Which page a composite row falls on, or `None` if it falls off the
    /// image entirely.
    pub fn page_of_device_row(&self, row: f64) -> Option<usize> {
        if !row.is_finite() || row < 0.0 {
            return None;
        }
        let idx = self
            .pages
            .partition_point(|(start, _)| (*start as f64) <= row);
        let page = idx.checked_sub(1)?;
        let (_, end) = self.pages[page];
        if row < end as f64 {
            Some(page)
        } else {
            None
        }
    }
}

/// Maps source CSS rectangles onto pages, using the compositor's band map so
/// text lands on the pixels it describes.
#[derive(Debug, Clone, Copy)]
pub struct SourceMapping<'a> {
    pub layout: &'a PageLayout,
    pub bands: &'a [Band],
    pub dpr: f64,
}

impl<'a> SourceMapping<'a> {
    pub fn new(layout: &'a PageLayout, bands: &'a [Band], dpr: f64) -> SourceMapping<'a> {
        SourceMapping { layout, bands, dpr }
    }

    /// One CSS px, in PDF points.
    pub fn css_to_pt(&self, css: f64) -> f32 {
        (css * self.dpr * self.layout.scale as f64) as f32
    }

    /// The composite row a source position sits on, or `None` when that
    /// position is not in the composite at all — text below a scroll area's
    /// captured band, for instance.
    pub fn device_row_of_source_y(&self, source_css_y: f64) -> Option<f64> {
        if !source_css_y.is_finite() {
            return None;
        }
        let idx = self
            .bands
            .partition_point(|b| b.source_offset_css <= source_css_y);
        let band = self.bands.get(idx.checked_sub(1)?)?;
        if !band.contains_source_css(source_css_y, self.dpr) {
            return None;
        }
        Some(band.device_row_of_source_css(source_css_y, self.dpr))
    }

    /// Places a source rectangle on the page that owns it.
    ///
    /// The page is chosen by the rectangle's vertical **centre**, which is
    /// what makes a line of text straddling a page break appear exactly once:
    /// clipping it would hide half a word from search, and emitting it on both
    /// pages would make a copied selection stutter. A line so placed can
    /// overhang the page edge by a few points; it stays searchable and
    /// selectable there, and it is invisible either way.
    ///
    /// Only the top edge is mapped through the band map; the height is scaled
    /// directly. A line of text is far shorter than a capture band, so at most
    /// one seam can fall inside it, and a seam is worth less than half a
    /// device pixel.
    pub fn place(&self, rect: SourceRect) -> Option<PlacedRect> {
        if !(rect.width > 0.0 && rect.height > 0.0) {
            return None;
        }
        let device_top = self.device_row_of_source_y(rect.y)?;
        let device_height = rect.height * self.dpr;
        let device_x = rect.x * self.dpr;
        let device_width = rect.width * self.dpr;
        if !device_height.is_finite() || !device_x.is_finite() || !device_width.is_finite() {
            return None;
        }
        // Entirely beside the captured column — a scroll area's horizontal
        // overflow, or a negatively-positioned off-screen label.
        if device_x + device_width <= 0.0 || device_x >= self.layout.composite_width as f64 {
            return None;
        }

        let centre = device_top + device_height / 2.0;
        let page = self.layout.page_of_device_row(centre)?;
        let (page_start, _) = self.layout.pages[page];
        let scale = self.layout.scale as f64;
        let device_bottom = device_top + device_height;
        let y = self.layout.page_height_pt as f64 - (device_bottom - page_start as f64) * scale;

        Some(PlacedRect {
            page,
            x: (device_x * scale) as f32,
            y: y as f32,
            width: (device_width * scale) as f32,
            height: (device_height * scale) as f32,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A composite of `tiles` viewports of `viewport_css` CSS px each, as the
    /// compositor would describe it at `dpr`.
    fn bands_for(offsets: &[f64], viewport_css: f64, dpr: f64) -> (Vec<Band>, u32) {
        let mut bands = Vec::new();
        let mut row_start = 0u32;
        for (i, &off) in offsets.iter().enumerate() {
            let rows = if i + 1 == offsets.len() {
                (viewport_css * dpr).round() as u32
            } else {
                ((offsets[i + 1] * dpr).round() - (off * dpr).round()) as u32
            };
            bands.push(Band {
                source_offset_css: off,
                device_row_start: row_start,
                device_rows: rows,
            });
            row_start += rows;
        }
        (bands, row_start)
    }

    #[test]
    fn auto_page_is_the_composite_one_to_one() {
        let layout = PageLayout::new(PageSize::Auto, Orientation::Portrait, 800, 2000).unwrap();
        assert_eq!(layout.page_width_pt, 800.0);
        assert_eq!(layout.page_height_pt, 2000.0);
        assert_eq!(layout.scale, 1.0);
        assert_eq!(layout.pages, vec![(0, 2000)]);
    }

    #[test]
    fn fit_width_pages_tile_the_composite_without_gap_or_overlap() {
        let layout = PageLayout::new(PageSize::A4, Orientation::Portrait, 800, 5000).unwrap();
        assert!(layout.pages.len() > 1);
        assert_eq!(layout.pages.first().unwrap().0, 0);
        assert_eq!(layout.pages.last().unwrap().1, 5000);
        for w in layout.pages.windows(2) {
            assert_eq!(w[0].1, w[1].0, "pages must be contiguous");
        }
    }

    #[test]
    fn a_row_belongs_to_exactly_one_page() {
        let layout = PageLayout::new(PageSize::Letter, Orientation::Portrait, 900, 4000).unwrap();
        for row in [0u32, 1, 999, 1000, 2500, 3999] {
            let owners = layout
                .pages
                .iter()
                .filter(|(s, e)| row >= *s && row < *e)
                .count();
            assert_eq!(owners, 1, "row {row} owned by {owners} pages");
            assert!(layout.page_of_device_row(row as f64).is_some());
        }
        assert_eq!(layout.page_of_device_row(4000.0), None);
        assert_eq!(layout.page_of_device_row(-1.0), None);
    }

    /// The whole point of the band map: a rectangle measured in CSS lands on
    /// the pixels that rendered it, whatever the device pixel ratio.
    #[test]
    fn a_source_rect_lands_on_its_own_pixels_at_every_device_pixel_ratio() {
        for dpr in [1.0, 1.25, 1.5, 1.75, 2.0] {
            let viewport = 800.0;
            let (bands, height) = bands_for(&[0.0, 760.0, 1520.0], viewport, dpr);
            let width = (1200.0 * dpr).round() as u32;
            let layout =
                PageLayout::new(PageSize::Auto, Orientation::Portrait, width, height).unwrap();
            let map = SourceMapping::new(&layout, &bands, dpr);

            for source_y in [0.0, 100.0, 759.0, 760.0, 1000.0, 1519.0, 1520.0, 2000.0] {
                let placed = map
                    .place(SourceRect {
                        x: 10.0,
                        y: source_y,
                        width: 100.0,
                        height: 20.0,
                    })
                    .unwrap_or_else(|| panic!("dpr {dpr}: y={source_y} fell off the composite"));
                // Auto page: scale is 1, so PDF pt == device px, and the
                // rectangle's top measured from the page top must be where
                // the compositor put that source row.
                let top_from_page_top = layout.page_height_pt - (placed.y + placed.height);
                let naive = source_y * dpr;
                assert!(
                    (top_from_page_top as f64 - naive).abs() <= 0.5,
                    "dpr {dpr}: source y={source_y} placed at {top_from_page_top}, pixels at {naive}"
                );
            }
        }
    }

    #[test]
    fn pdf_y_axis_is_inverted_relative_to_css() {
        let (bands, height) = bands_for(&[0.0], 1000.0, 1.0);
        let layout = PageLayout::new(PageSize::Auto, Orientation::Portrait, 500, height).unwrap();
        let map = SourceMapping::new(&layout, &bands, 1.0);

        let top = map
            .place(SourceRect {
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 10.0,
            })
            .unwrap();
        let bottom = map
            .place(SourceRect {
                x: 0.0,
                y: 980.0,
                width: 10.0,
                height: 10.0,
            })
            .unwrap();
        // Top of the page in CSS is the *high* y in PDF user space.
        assert!(top.y > bottom.y);
        assert_eq!(top.y, 1000.0 - 10.0);
        assert_eq!(bottom.y, 1000.0 - 990.0);
    }

    #[test]
    fn fit_width_scales_both_axes_by_the_same_factor() {
        let (bands, height) = bands_for(&[0.0], 1000.0, 2.0);
        let width = 1600u32;
        let layout = PageLayout::new(PageSize::A4, Orientation::Portrait, width, height).unwrap();
        let map = SourceMapping::new(&layout, &bands, 2.0);
        let placed = map
            .place(SourceRect {
                x: 100.0,
                y: 0.0,
                width: 200.0,
                height: 50.0,
            })
            .unwrap();
        let css_to_pt = map.css_to_pt(1.0);
        assert!((placed.x - 100.0 * css_to_pt).abs() < 0.01);
        assert!((placed.width - 200.0 * css_to_pt).abs() < 0.01);
        assert!((placed.height - 50.0 * css_to_pt).abs() < 0.01);
        // Fit Width means the composite's full width is the page's full width.
        assert!((layout.page_width_pt - A4_WIDTH_PT).abs() < 0.01);
    }

    #[test]
    fn a_rect_crossing_a_page_boundary_is_placed_once_on_the_page_holding_its_centre() {
        let (bands, height) = bands_for(&[0.0], 4000.0, 1.0);
        let layout = PageLayout::new(PageSize::A4, Orientation::Portrait, 800, height).unwrap();
        let map = SourceMapping::new(&layout, &bands, 1.0);
        let boundary = layout.pages[0].1 as f64;

        // A line whose top is on page 0 and bottom on page 1.
        let straddling = map
            .place(SourceRect {
                x: 0.0,
                y: boundary - 8.0,
                width: 50.0,
                height: 20.0,
            })
            .unwrap();
        assert_eq!(
            straddling.page, 1,
            "centre is past the break, so page 1 owns it"
        );

        // And one just above it stays on page 0 — neither vanishes, neither
        // is emitted twice.
        let above = map
            .place(SourceRect {
                x: 0.0,
                y: boundary - 30.0,
                width: 50.0,
                height: 20.0,
            })
            .unwrap();
        assert_eq!(above.page, 0);
    }

    #[test]
    fn content_outside_the_composite_is_not_placed() {
        let (bands, height) = bands_for(&[0.0], 600.0, 1.0);
        let layout = PageLayout::new(PageSize::Auto, Orientation::Portrait, 400, height).unwrap();
        let map = SourceMapping::new(&layout, &bands, 1.0);

        // Below the captured band (a scroll area's unreached content).
        assert!(map
            .place(SourceRect {
                x: 0.0,
                y: 600.0,
                width: 10.0,
                height: 10.0
            })
            .is_none());
        // Above the origin.
        assert!(map
            .place(SourceRect {
                x: 0.0,
                y: -20.0,
                width: 10.0,
                height: 10.0
            })
            .is_none());
        // Beside the captured column (horizontal overflow in a scroll area).
        assert!(map
            .place(SourceRect {
                x: 400.0,
                y: 0.0,
                width: 50.0,
                height: 10.0
            })
            .is_none());
        assert!(map
            .place(SourceRect {
                x: -60.0,
                y: 0.0,
                width: 50.0,
                height: 10.0
            })
            .is_none());
        // Degenerate rectangles.
        assert!(map
            .place(SourceRect {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 10.0
            })
            .is_none());
    }

    /// A scroll area's composite starts at the container's content origin, so
    /// the same source coordinate maps differently than it would for a page.
    #[test]
    fn a_scroll_area_band_map_starts_at_the_containers_content_origin() {
        let dpr = 1.5;
        let (bands, height) = bands_for(&[0.0, 300.0], 320.0, dpr);
        let width = (500.0 * dpr) as u32;
        let layout = PageLayout::new(PageSize::Auto, Orientation::Portrait, width, height).unwrap();
        let map = SourceMapping::new(&layout, &bands, dpr);

        // Content at container offset 0 is at the very top of the composite.
        let first = map
            .place(SourceRect {
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 10.0,
            })
            .unwrap();
        assert!((layout.page_height_pt - (first.y + first.height)).abs() < 0.01);

        // Content past the captured extent is dropped rather than clamped
        // onto the last row, which would stack it all on one line.
        assert!(map
            .place(SourceRect {
                x: 0.0,
                y: 620.0,
                width: 10.0,
                height: 10.0
            })
            .is_none());
    }

    #[test]
    fn landscape_swaps_the_page_axes() {
        let portrait = PageLayout::new(PageSize::A4, Orientation::Portrait, 800, 800).unwrap();
        let landscape = PageLayout::new(PageSize::A4, Orientation::Landscape, 800, 800).unwrap();
        assert_eq!(portrait.page_width_pt, landscape.page_height_pt);
        assert_eq!(portrait.page_height_pt, landscape.page_width_pt);
    }

    #[test]
    fn rejects_dimensions_that_cannot_describe_an_image() {
        assert!(PageLayout::new(PageSize::Auto, Orientation::Portrait, 0, 10).is_err());
        assert!(PageLayout::new(PageSize::Auto, Orientation::Portrait, 10, 0).is_err());
    }
}
