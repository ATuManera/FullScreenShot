// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use crate::geometry::{Point, Rect};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TileId(pub u64);

#[derive(Debug, Clone, PartialEq)]
pub struct Tile {
    pub id: TileId,
    pub scroll_offset: Point,
    pub crop: Rect,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Size;

    #[test]
    fn tile_ids_are_orderable_for_stitch_sequencing() {
        let a = TileId(0);
        let b = TileId(1);
        assert!(a < b);
    }

    #[test]
    fn tiles_with_equal_fields_are_equal() {
        let t1 = Tile {
            id: TileId(0),
            scroll_offset: Point { x: 0.0, y: 0.0 },
            crop: Rect {
                origin: Point { x: 0.0, y: 0.0 },
                size: Size {
                    width: 10.0,
                    height: 10.0,
                },
            },
        };
        let t2 = t1.clone();
        assert_eq!(t1, t2);
    }
}
