// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use wasm_bindgen::prelude::*;

use screenshot_core::capture_plan::CapturePlan;
use screenshot_core::compositor::{TileImage, TileImageMeta};
use screenshot_core::geometry::Size;
use screenshot_core::tile::TileId;

/// Composes a full-page PNG from captured tiles.
///
/// `offsets`, `tile_widths` and `tile_heights` must all have the same
/// length (one entry per tile, in capture order). `tile_rgba_concat` is
/// every tile's device-pixel RGBA buffer concatenated back-to-back in
/// that same order — this flat-array-plus-parallel-metadata shape avoids
/// needing a JS object marshalling layer at the WASM boundary.
#[wasm_bindgen(js_name = "composeFullPagePng")]
#[allow(clippy::too_many_arguments)]
pub fn compose_full_page_png(
    offsets: Vec<f64>,
    viewport_width: f64,
    viewport_height: f64,
    dpr: f64,
    tile_widths: Vec<u32>,
    tile_heights: Vec<u32>,
    tile_rgba_concat: Vec<u8>,
) -> Result<Vec<u8>, JsValue> {
    if tile_widths.len() != offsets.len() || tile_heights.len() != offsets.len() {
        return Err(JsValue::from_str(
            "tile_widths/tile_heights length must match offsets length",
        ));
    }

    let viewport = Size {
        width: viewport_width,
        height: viewport_height,
    };
    let plan = CapturePlan::from_offsets(&offsets, viewport);

    let mut tiles = Vec::with_capacity(offsets.len());
    let mut cursor = 0usize;
    for (i, (&width, &height)) in tile_widths.iter().zip(tile_heights.iter()).enumerate() {
        let len = width as usize * height as usize * 4;
        let end = cursor
            .checked_add(len)
            .ok_or_else(|| JsValue::from_str("tile buffer length overflow"))?;
        if end > tile_rgba_concat.len() {
            return Err(JsValue::from_str(
                "tile_rgba_concat is shorter than the declared tile dimensions require",
            ));
        }
        tiles.push(TileImage {
            meta: TileImageMeta {
                tile_id: TileId(i as u64),
                width,
                height,
            },
            rgba: &tile_rgba_concat[cursor..end],
        });
        cursor = end;
    }

    screenshot_png::compose_full_page_png(&plan, dpr, &tiles)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
