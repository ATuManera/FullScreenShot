// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use crate::geometry::{Point, Rect, Size};
use crate::tile::{Tile, TileId};

#[derive(Debug, Clone, PartialEq)]
pub struct CapturePlan {
    pub tiles: Vec<Tile>,
    pub content_size: Size,
}

impl CapturePlan {
    pub fn from_offsets(offsets: &[f64], viewport: Size) -> CapturePlan {
        let tiles = offsets
            .iter()
            .enumerate()
            .map(|(i, &y)| Tile {
                id: TileId(i as u64),
                scroll_offset: Point { x: 0.0, y },
                crop: Rect {
                    origin: Point { x: 0.0, y: 0.0 },
                    size: viewport,
                },
            })
            .collect();
        let content_height = offsets.last().copied().unwrap_or(0.0) + viewport.height;
        CapturePlan {
            tiles,
            content_size: Size {
                width: viewport.width,
                height: content_height,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_offsets_produces_one_tile_per_offset() {
        let viewport = Size {
            width: 800.0,
            height: 600.0,
        };
        let plan = CapturePlan::from_offsets(&[0.0, 500.0, 1000.0], viewport);
        assert_eq!(plan.tiles.len(), 3);
        assert_eq!(plan.tiles[1].scroll_offset.y, 500.0);
    }

    #[test]
    fn from_offsets_computes_content_height_from_last_tile() {
        let viewport = Size {
            width: 800.0,
            height: 600.0,
        };
        let plan = CapturePlan::from_offsets(&[0.0, 400.0], viewport);
        assert_eq!(plan.content_size.height, 1000.0);
    }

    #[test]
    fn from_empty_offsets_produces_empty_plan() {
        let viewport = Size {
            width: 800.0,
            height: 600.0,
        };
        let plan = CapturePlan::from_offsets(&[], viewport);
        assert!(plan.tiles.is_empty());
    }
}
