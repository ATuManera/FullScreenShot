// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use crate::capture_plan::CapturePlan;
use crate::error::CoreError;
use crate::tile::TileId;
use crate::validation::validate_plan;

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

/// Streams a full-page composite from `tiles` (in the same order as
/// `plan.tiles`) into `sink`, one output row at a time. Each tile
/// contributes the non-overlapping content band
/// `[scroll_offset_i, scroll_offset_{i+1})` (last tile: up to
/// `content_size.height`) from its own top edge — the overlap in
/// `plan` is rounding tolerance, not a blend region, so no two tiles
/// ever write the same output row.
pub fn compose_streaming(
    plan: &CapturePlan,
    dpr: f64,
    tiles: &[TileImage<'_>],
    sink: &mut dyn RowSink,
) -> Result<CompositeDimensions, CoreError> {
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
        let expected_len = image.meta.width as usize * image.meta.height as usize * 4;
        if image.meta.width == 0 || image.meta.height == 0 || image.rgba.len() != expected_len {
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

    let output_height_target = (plan.content_size.height * dpr).round() as u32;
    let row_len = output_width as usize * 4;
    let mut rows_written: u32 = 0;

    for (i, (planned, image)) in plan.tiles.iter().zip(tiles.iter()).enumerate() {
        let band_start_css = planned.scroll_offset.y;
        let band_end_css = plan
            .tiles
            .get(i + 1)
            .map(|next| next.scroll_offset.y)
            .unwrap_or(plan.content_size.height);

        let band_start_row = (band_start_css * dpr).round() as u32;
        let band_end_row = ((band_end_css * dpr).round() as u32).min(output_height_target);
        if band_end_row <= band_start_row {
            continue;
        }
        let local_rows_needed = band_end_row - band_start_row;
        let rows_to_write = local_rows_needed.min(image.meta.height);

        for local_row in 0..rows_to_write {
            let start = local_row as usize * row_len;
            let end = start + row_len;
            sink.write_row(&image.rgba[start..end])?;
            rows_written += 1;
        }
    }

    if rows_written != output_height_target {
        return Err(CoreError::InvalidDimensions {
            width: output_width,
            height: rows_written,
        });
    }

    Ok(CompositeDimensions {
        width: output_width,
        height: rows_written,
    })
}

/// The exact output height a composite will have for `plan` at `dpr`,
/// computable before any tile data is available — lets callers (e.g. a
/// PNG writer) allocate/declare output dimensions up front for a true
/// single-pass streaming encode.
pub fn expected_output_height(plan: &CapturePlan, dpr: f64) -> Result<u32, CoreError> {
    validate_plan(plan)?;
    if !dpr.is_finite() || dpr <= 0.0 {
        return Err(CoreError::InvalidDimensions {
            width: 0,
            height: 0,
        });
    }
    Ok((plan.content_size.height * dpr).round() as u32)
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
        assert_eq!(expected_output_height(&plan, 1.0).unwrap(), 10);
        assert_eq!(expected_output_height(&plan, 2.0).unwrap(), 20);
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
