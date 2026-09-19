// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use crate::capture_plan::CapturePlan;
use crate::error::CoreError;
use crate::tile::TileId;
use crate::validation::{rgba_byte_len, validate_output_dimensions, validate_plan};

/// Sink for streaming, row-by-row image output. Implemented by the PNG
/// writer so full-page composition never needs to hold the entire
/// stitched bitmap in memory at once.
pub trait RowSink {
    fn write_row(&mut self, row: &[u8]) -> Result<(), CoreError>;
}

pub type CompositeError = CoreError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TileImageMeta {
    pub tile_id: TileId,
    pub width: u32,
    pub height: u32,
}

/// One captured tile's raw device-pixel RGBA data, borrowed rather than
/// owned so the caller can decode/discard tiles one at a time and keep
/// peak memory bounded.
pub struct TileImage<'a> {
    pub meta: TileImageMeta,
    pub rgba: &'a [u8],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompositeDimensions {
    pub width: u32,
    pub height: u32,
}

/// Validates that `tiles` can be composed against `plan` at `dpr`, and
/// reports the output width every tile agrees on.
fn validate_inputs(
    plan: &CapturePlan,
    dpr: f64,
    tiles: &[TileImage<'_>],
) -> Result<u32, CoreError> {
    validate_plan(plan)?;
    if !dpr.is_finite() || dpr <= 0.0 {
        return Err(CoreError::InvalidDimensions {
            width: 0,
            height: 0,
        });
    }
    if tiles.len() != plan.tiles.len() {
        return Err(CoreError::Overflow(format!(
            "tile image count {} does not match plan tile count {}",
            tiles.len(),
            plan.tiles.len()
        )));
    }
    for (planned, image) in plan.tiles.iter().zip(tiles.iter()) {
        if planned.id != image.meta.tile_id {
            return Err(CoreError::Overflow(format!(
                "tile order mismatch: plan expected {:?}, got {:?}",
                planned.id, image.meta.tile_id
            )));
        }
        // Checked in u64: on wasm32 `usize` is 32 bits, so a hostile tile
        // could otherwise wrap this product and satisfy the length test
        // against a buffer far too small for the image it claims to be.
        let expected_len = rgba_byte_len(image.meta.width, image.meta.height)?;
        if image.rgba.len() != expected_len {
            return Err(CoreError::InvalidDimensions {
                width: image.meta.width,
                height: image.meta.height,
            });
        }
    }

    let output_width = match tiles.first() {
        Some(t) => t.meta.width,
        None => {
            return Err(CoreError::InvalidDimensions {
                width: 0,
                height: 0,
            })
        }
    };
    for image in tiles {
        if image.meta.width != output_width {
            return Err(CoreError::InvalidDimensions {
                width: image.meta.width,
                height: image.meta.height,
            });
        }
    }
    Ok(output_width)
}

/// How many device rows each tile contributes to the output, in order.
///
/// Every band but the last is the gap to the next tile's origin, in device
/// pixels. The last band is the last screenshot itself, and that is the
/// repair: the height of a viewport in device pixels is whatever the browser
/// rasterised, not `round(css_height * dpr)`. On a fractionally-scaled
/// display the two disagree by a row for some scroll positions — the browser
/// returns 821 rows where the arithmetic asks for 822 — and the old code,
/// which derived the output height from CSS geometry alone, then demanded a
/// row the final tile did not contain. The shortfall surfaced as a
/// row-accounting failure reported as "invalid dimensions", on captures whose
/// dimensions were perfectly ordinary.
///
/// Tile heights are therefore allowed to differ from each other by the
/// browser's rounding. Widths are not: they set the output width.
fn planned_band_rows(
    plan: &CapturePlan,
    dpr: f64,
    tiles: &[TileImage<'_>],
) -> Result<Vec<u32>, CoreError> {
    let last = plan.tiles.len() - 1;
    let mut rows = Vec::with_capacity(plan.tiles.len());
    for (i, planned) in plan.tiles.iter().enumerate() {
        let image_rows = tiles[i].meta.height;
        if i == last {
            rows.push(image_rows);
            continue;
        }
        let start = (planned.scroll_offset.y * dpr).round();
        let end = (plan.tiles[i + 1].scroll_offset.y * dpr).round();
        let needed = (end - start).max(0.0) as u32;
        // A band wider than its own screenshot would leave a gap in the
        // page. It cannot happen for a plan whose stride is smaller than the
        // viewport, which is every plan this crate produces, so it is a real
        // inconsistency rather than rounding — and it is reported as one,
        // not as a dimension problem.
        if needed > image_rows {
            return Err(CoreError::Overflow(format!(
                "tile {i} must supply {needed} device rows but its screenshot is only {image_rows} tall"
            )));
        }
        rows.push(needed);
    }
    Ok(rows)
}

fn total_rows(rows: &[u32]) -> Result<u32, CoreError> {
    rows.iter().try_fold(0u32, |acc, r| {
        acc.checked_add(*r).ok_or_else(|| {
            CoreError::Overflow("composite height overflows a 32-bit row count".to_string())
        })
    })
}

/// Streams a full-page composite from `tiles` (in the same order as
/// `plan.tiles`) into `sink`, one output row at a time. Each tile
/// contributes the non-overlapping content band
/// `[scroll_offset_i, scroll_offset_{i+1})` from its own top edge — the
/// overlap in `plan` is rounding tolerance, not a blend region, so no two
/// tiles ever write the same output row. The last tile contributes its whole
/// screenshot; see `planned_band_rows` for why that, and not CSS arithmetic,
/// defines where the image ends.
pub fn compose_streaming(
    plan: &CapturePlan,
    dpr: f64,
    tiles: &[TileImage<'_>],
    sink: &mut dyn RowSink,
) -> Result<CompositeDimensions, CoreError> {
    let output_width = validate_inputs(plan, dpr, tiles)?;
    let band_rows = planned_band_rows(plan, dpr, tiles)?;
    let output_height = total_rows(&band_rows)?;
    validate_output_dimensions(output_width, output_height)?;

    let row_len = output_width as usize * 4;
    let mut rows_written: u32 = 0;

    for (image, rows_to_write) in tiles.iter().zip(band_rows.iter()) {
        for local_row in 0..*rows_to_write {
            let start = local_row as usize * row_len;
            let end = start + row_len;
            sink.write_row(&image.rgba[start..end])?;
            rows_written += 1;
        }
    }

    // Now a pure internal-consistency assertion — the plan and the writing
    // loop read from the same `band_rows` — rather than a comparison between
    // CSS arithmetic and real pixels, which is what used to fail here.
    if rows_written != output_height {
        return Err(CoreError::Overflow(format!(
            "composite wrote {rows_written} rows but its plan called for {output_height}"
        )));
    }

    Ok(CompositeDimensions {
        width: output_width,
        height: rows_written,
    })
}

/// The exact output height a composite will have, computable before any row
/// is streamed — this is what a PNG writer declares in its header, so it must
/// agree with `compose_streaming` exactly or the file is corrupt. Both derive
/// it from the same `planned_band_rows`, which is why they cannot drift.
pub fn expected_output_height(
    plan: &CapturePlan,
    dpr: f64,
    tiles: &[TileImage<'_>],
) -> Result<u32, CoreError> {
    let output_width = validate_inputs(plan, dpr, tiles)?;
    let height = total_rows(&planned_band_rows(plan, dpr, tiles)?)?;
    validate_output_dimensions(output_width, height)?;
    Ok(height)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Size;
    use crate::tile::Tile;

    struct CollectingSink {
        rows: Vec<Vec<u8>>,
    }

    impl RowSink for CollectingSink {
        fn write_row(&mut self, row: &[u8]) -> Result<(), CoreError> {
            self.rows.push(row.to_vec());
            Ok(())
        }
    }

    fn plan_with_offsets(offsets: &[f64], viewport: Size) -> CapturePlan {
        CapturePlan::from_offsets(offsets, viewport)
    }

    fn solid_tile(id: u64, width: u32, height: u32, color: [u8; 4]) -> (TileImageMeta, Vec<u8>) {
        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..(width * height) {
            rgba.extend_from_slice(&color);
        }
        (
            TileImageMeta {
                tile_id: TileId(id),
                width,
                height,
            },
            rgba,
        )
    }

    /// The physical failure this module was repaired for.
    ///
    /// On a fractionally-scaled display the browser's own CSS-to-device
    /// rounding and this module's `round(css * dpr)` arithmetic can disagree
    /// by one row for the final band: the screenshot the browser handed back
    /// is one row shorter than the height the composite was told to expect.
    /// The last tile then cannot supply the row the target demands, and the
    /// row-accounting check fired — reporting the number of rows *written*,
    /// which read like "invalid dimensions: 1660x8484" and looked for all the
    /// world like a size limit on long captures.
    #[test]
    fn final_band_uses_the_screenshot_the_browser_actually_returned() {
        let viewport = Size {
            width: 4.0,
            height: 657.0,
        };
        // dpr 1.25 puts the viewport at 821.25 device rows: the browser
        // rasterises 821, while `round((offset + viewport) * dpr)` asks for
        // 822 at this particular offset.
        let dpr = 1.25;
        let plan = plan_with_offsets(&[0.0, 100.2], viewport);
        let (meta0, rgba0) = solid_tile(0, 4, 821, [1, 2, 3, 255]);
        let (meta1, rgba1) = solid_tile(1, 4, 821, [4, 5, 6, 255]);
        let tiles = [
            TileImage {
                meta: meta0,
                rgba: &rgba0,
            },
            TileImage {
                meta: meta1,
                rgba: &rgba1,
            },
        ];
        let mut sink = CollectingSink { rows: Vec::new() };
        let dims = compose_streaming(&plan, dpr, &tiles, &mut sink)
            .expect("a long capture on a fractionally-scaled display must compose");
        assert_eq!(dims.height, sink.rows.len() as u32);
        // The output ends exactly where the last screenshot ends, rather than
        // where CSS arithmetic predicted it would.
        assert_eq!(dims.height, (100.2 * dpr).round() as u32 + 821);
    }

    #[test]
    fn expected_output_height_agrees_with_what_is_written_at_fractional_dpr() {
        let viewport = Size {
            width: 4.0,
            height: 657.0,
        };
        let dpr = 1.25;
        let plan = plan_with_offsets(&[0.0, 100.2], viewport);
        let (meta0, rgba0) = solid_tile(0, 4, 821, [1, 2, 3, 255]);
        let (meta1, rgba1) = solid_tile(1, 4, 821, [4, 5, 6, 255]);
        let tiles = [
            TileImage {
                meta: meta0,
                rgba: &rgba0,
            },
            TileImage {
                meta: meta1,
                rgba: &rgba1,
            },
        ];
        // The PNG header is written from this before a single row is
        // streamed, so a disagreement here is a corrupt file, not an error.
        let declared = expected_output_height(&plan, dpr, &tiles).unwrap();
        let mut sink = CollectingSink { rows: Vec::new() };
        let dims = compose_streaming(&plan, dpr, &tiles, &mut sink).unwrap();
        assert_eq!(declared, dims.height);
    }

    #[test]
    fn a_long_full_page_capture_is_a_supported_size() {
        // 1660x8484 is the capture that was rejected in the field. Only the
        // dimension policy is exercised here — allocating 56MB of RGBA to
        // prove a bounds check would be a waste of a unit test.
        assert!(crate::validation::validate_output_dimensions(1660, 8484).is_ok());
        assert!(crate::validation::validate_output_dimensions(1660, 20_000).is_ok());
        assert!(crate::validation::validate_output_dimensions(3840, 26_000).is_ok());
    }

    #[test]
    fn row_sink_trait_is_implementable_and_callable() {
        struct CountingSink {
            rows_written: usize,
        }
        impl RowSink for CountingSink {
            fn write_row(&mut self, _row: &[u8]) -> Result<(), CoreError> {
                self.rows_written += 1;
                Ok(())
            }
        }
        let mut sink = CountingSink { rows_written: 0 };
        sink.write_row(&[0, 0, 0, 255]).unwrap();
        sink.write_row(&[255, 255, 255, 255]).unwrap();
        assert_eq!(sink.rows_written, 2);
    }

    #[test]
    fn single_tile_composite_matches_content_exactly() {
        let viewport = Size {
            width: 4.0,
            height: 3.0,
        };
        let plan = plan_with_offsets(&[0.0], viewport);
        let (meta, rgba) = solid_tile(0, 4, 3, [10, 20, 30, 255]);
        let tiles = [TileImage { meta, rgba: &rgba }];
        let mut sink = CollectingSink { rows: Vec::new() };

        let dims = compose_streaming(&plan, 1.0, &tiles, &mut sink).unwrap();

        assert_eq!(
            dims,
            CompositeDimensions {
                width: 4,
                height: 3
            }
        );
        assert_eq!(sink.rows.len(), 3);
        for row in &sink.rows {
            assert_eq!(
                row,
                &vec![10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255]
            );
        }
    }

    #[test]
    fn multi_tile_composite_covers_full_content_with_no_duplicate_or_missing_rows() {
        let viewport = Size {
            width: 2.0,
            height: 4.0,
        };
        // content = 10px tall: tiles at 0, 3, 6 (overlap=1 tolerance), last band ends at content height.
        let plan = plan_with_offsets(&[0.0, 3.0, 6.0], viewport);
        let (meta_a, rgba_a) = solid_tile(0, 2, 4, [1, 1, 1, 255]);
        let (meta_b, rgba_b) = solid_tile(1, 2, 4, [2, 2, 2, 255]);
        let (meta_c, rgba_c) = solid_tile(2, 2, 4, [3, 3, 3, 255]);
        let tiles = [
            TileImage {
                meta: meta_a,
                rgba: &rgba_a,
            },
            TileImage {
                meta: meta_b,
                rgba: &rgba_b,
            },
            TileImage {
                meta: meta_c,
                rgba: &rgba_c,
            },
        ];
        let mut sink = CollectingSink { rows: Vec::new() };

        let dims = compose_streaming(&plan, 1.0, &tiles, &mut sink).unwrap();

        // content height = last offset (6) + viewport (4) = 10
        assert_eq!(dims.height, 10);
        // Bands: tile0 -> rows [0,3) from its own top (3 rows, color 1),
        // tile1 -> rows [3,6) i.e. 3 rows from its own top (color 2),
        // tile2 -> rows [6,10) i.e. 4 rows from its own top (color 3).
        let colors: Vec<u8> = sink.rows.iter().map(|row| row[0]).collect();
        assert_eq!(colors, vec![1, 1, 1, 2, 2, 2, 3, 3, 3, 3]);
    }

    #[test]
    fn fractional_dpr_scales_output_height() {
        let viewport = Size {
            width: 2.0,
            height: 4.0,
        };
        let plan = plan_with_offsets(&[0.0], viewport);
        // device px at dpr 1.25: 2*1.25=2.5 -> width rounds to 3? We keep
        // width driven by the tile image itself (already captured at
        // device resolution), not recomputed here.
        let (meta, rgba) = solid_tile(0, 3, 5, [9, 9, 9, 255]);
        let tiles = [TileImage { meta, rgba: &rgba }];
        let mut sink = CollectingSink { rows: Vec::new() };

        let dims = compose_streaming(&plan, 1.25, &tiles, &mut sink).unwrap();
        // output_height_target = round(4 * 1.25) = 5; tile provides 5 rows.
        assert_eq!(dims.height, 5);
    }

    /// Explicit coverage for every DPR value the spec calls out by name
    /// (section 12: "1.0, 1.25, 1.5, 1.75, 2.0, Retina") plus a
    /// multi-tile composite at Retina (dpr 2.0), matching the MVP
    /// acceptance criterion "Retina/DPR 2 → correct" (section 35).
    #[test]
    fn every_named_dpr_value_scales_output_height_correctly() {
        let viewport = Size {
            width: 2.0,
            height: 4.0,
        };
        for (dpr, expected_height) in [(1.0, 4u32), (1.25, 5), (1.5, 6), (1.75, 7), (2.0, 8)] {
            let plan = plan_with_offsets(&[0.0], viewport);
            let tile_height = expected_height;
            let (meta, rgba) = solid_tile(0, 2, tile_height, [7, 7, 7, 255]);
            let tiles = [TileImage { meta, rgba: &rgba }];
            let mut sink = CollectingSink { rows: Vec::new() };

            let dims = compose_streaming(&plan, dpr, &tiles, &mut sink).unwrap();
            assert_eq!(
                dims.height, expected_height,
                "dpr {dpr} should produce height {expected_height}"
            );
        }
    }

    #[test]
    fn retina_dpr_two_multi_tile_composite_covers_full_content() {
        let viewport = Size {
            width: 2.0,
            height: 4.0,
        };
        // Two CSS-px tiles at dpr 2.0: each tile image is 8 device-px tall.
        let plan = plan_with_offsets(&[0.0, 4.0], viewport);
        let (meta_a, rgba_a) = solid_tile(0, 4, 8, [1, 1, 1, 255]);
        let (meta_b, rgba_b) = solid_tile(1, 4, 8, [2, 2, 2, 255]);
        let tiles = [
            TileImage {
                meta: meta_a,
                rgba: &rgba_a,
            },
            TileImage {
                meta: meta_b,
                rgba: &rgba_b,
            },
        ];
        let mut sink = CollectingSink { rows: Vec::new() };

        let dims = compose_streaming(&plan, 2.0, &tiles, &mut sink).unwrap();
        // content height = 4 (offset) + 4 (viewport) = 8 CSS px -> 16 device px at dpr 2.0.
        assert_eq!(dims.height, 16);
        assert_eq!(dims.width, 4);
    }

    #[test]
    fn rejects_tile_count_mismatch() {
        let viewport = Size {
            width: 2.0,
            height: 2.0,
        };
        let plan = plan_with_offsets(&[0.0, 100.0], viewport);
        let (meta, rgba) = solid_tile(0, 2, 2, [0, 0, 0, 255]);
        let tiles = [TileImage { meta, rgba: &rgba }];
        let mut sink = CollectingSink { rows: Vec::new() };
        assert!(compose_streaming(&plan, 1.0, &tiles, &mut sink).is_err());
    }

    #[test]
    fn rejects_tile_order_mismatch() {
        let viewport = Size {
            width: 2.0,
            height: 2.0,
        };
        let plan = plan_with_offsets(&[0.0, 2.0], viewport);
        let (meta_a, rgba_a) = solid_tile(5, 2, 2, [0, 0, 0, 255]);
        let (meta_b, rgba_b) = solid_tile(6, 2, 2, [1, 1, 1, 255]);
        let tiles = [
            TileImage {
                meta: meta_a,
                rgba: &rgba_a,
            },
            TileImage {
                meta: meta_b,
                rgba: &rgba_b,
            },
        ];
        let mut sink = CollectingSink { rows: Vec::new() };
        assert!(compose_streaming(&plan, 1.0, &tiles, &mut sink).is_err());
    }

    #[test]
    fn rejects_inconsistent_tile_widths() {
        let viewport = Size {
            width: 2.0,
            height: 2.0,
        };
        let plan = plan_with_offsets(&[0.0, 2.0], viewport);
        let (meta_a, rgba_a) = solid_tile(0, 2, 2, [0, 0, 0, 255]);
        let (meta_b, rgba_b) = solid_tile(1, 3, 2, [1, 1, 1, 255]);
        let tiles = [
            TileImage {
                meta: meta_a,
                rgba: &rgba_a,
            },
            TileImage {
                meta: meta_b,
                rgba: &rgba_b,
            },
        ];
        let mut sink = CollectingSink { rows: Vec::new() };
        assert!(compose_streaming(&plan, 1.0, &tiles, &mut sink).is_err());
    }

    #[test]
    fn rejects_mismatched_rgba_buffer_length() {
        let viewport = Size {
            width: 2.0,
            height: 2.0,
        };
        let plan = plan_with_offsets(&[0.0], viewport);
        let meta = TileImageMeta {
            tile_id: TileId(0),
            width: 2,
            height: 2,
        };
        let rgba = vec![0u8; 3]; // wrong length
        let tiles = [TileImage { meta, rgba: &rgba }];
        let mut sink = CollectingSink { rows: Vec::new() };
        assert!(compose_streaming(&plan, 1.0, &tiles, &mut sink).is_err());
    }

    #[test]
    fn rejects_invalid_dpr() {
        let viewport = Size {
            width: 2.0,
            height: 2.0,
        };
        let plan = plan_with_offsets(&[0.0], viewport);
        let (meta, rgba) = solid_tile(0, 2, 2, [0, 0, 0, 255]);
        let tiles = [TileImage { meta, rgba: &rgba }];
        let mut sink = CollectingSink { rows: Vec::new() };
        assert!(compose_streaming(&plan, 0.0, &tiles, &mut sink).is_err());
        assert!(compose_streaming(&plan, -1.0, &tiles, &mut sink).is_err());
    }

    #[test]
    fn rejects_when_a_tile_image_is_shorter_than_its_band() {
        let viewport = Size {
            width: 2.0,
            height: 4.0,
        };
        let plan = plan_with_offsets(&[0.0, 3.0], viewport);
        // Tile 0's band is [0,3) but the image only has 2 rows.
        let (meta_a, rgba_a) = solid_tile(0, 2, 2, [1, 1, 1, 255]);
        let (meta_b, rgba_b) = solid_tile(1, 2, 4, [2, 2, 2, 255]);
        let tiles = [
            TileImage {
                meta: meta_a,
                rgba: &rgba_a,
            },
            TileImage {
                meta: meta_b,
                rgba: &rgba_b,
            },
        ];
        let mut sink = CollectingSink { rows: Vec::new() };
        assert!(compose_streaming(&plan, 1.0, &tiles, &mut sink).is_err());
    }

    #[test]
    fn expected_output_height_matches_actual_composite_height() {
        let viewport = Size {
            width: 2.0,
            height: 4.0,
        };
        let plan = plan_with_offsets(&[0.0, 3.0, 6.0], viewport);
        for (dpr, tile_height, expected) in [(1.0, 4u32, 10u32), (2.0, 8u32, 20u32)] {
            let built: Vec<(TileImageMeta, Vec<u8>)> = (0..3)
                .map(|i| solid_tile(i, 2, tile_height, [9, 9, 9, 255]))
                .collect();
            let tiles: Vec<TileImage<'_>> = built
                .iter()
                .map(|(meta, rgba)| TileImage { meta: *meta, rgba })
                .collect();
            assert_eq!(
                expected_output_height(&plan, dpr, &tiles).unwrap(),
                expected
            );

            let mut sink = CollectingSink { rows: Vec::new() };
            let dims = compose_streaming(&plan, dpr, &tiles, &mut sink).unwrap();
            assert_eq!(dims.height, expected);
        }
    }

    #[test]
    fn empty_plan_is_rejected_before_touching_tiles() {
        let plan = CapturePlan {
            tiles: Vec::<Tile>::new(),
            content_size: Size {
                width: 0.0,
                height: 0.0,
            },
        };
        let tiles: [TileImage<'_>; 0] = [];
        let mut sink = CollectingSink { rows: Vec::new() };
        assert!(compose_streaming(&plan, 1.0, &tiles, &mut sink).is_err());
    }
}
