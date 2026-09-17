// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use wasm_bindgen::prelude::*;

use screenshot_core::capture_plan::CapturePlan;
use screenshot_core::compositor::{TileImage, TileImageMeta};
use screenshot_core::geometry::Size;
use screenshot_core::tile::TileId;
use screenshot_pdf::{compose_full_page_pdf, Orientation, PageSize};

fn parse_page_size(value: &str) -> Result<PageSize, JsValue> {
    match value.to_ascii_lowercase().as_str() {
        "a4" => Ok(PageSize::A4),
        "letter" => Ok(PageSize::Letter),
        "auto" => Ok(PageSize::Auto),
        other => Err(JsValue::from_str(&format!(
            "unknown page_size '{other}', expected a4|letter|auto"
        ))),
    }
}

fn parse_orientation(value: &str) -> Result<Orientation, JsValue> {
    match value.to_ascii_lowercase().as_str() {
        "portrait" => Ok(Orientation::Portrait),
        "landscape" => Ok(Orientation::Landscape),
        other => Err(JsValue::from_str(&format!(
            "unknown orientation '{other}', expected portrait|landscape"
        ))),
    }
}

/// Composes a paginated raster PDF from captured tiles. See
/// `composeFullPagePng` (png.rs) for the shared flat-array tile
/// encoding; `page_size` is "a4" | "letter" | "auto", `orientation` is
/// "portrait" | "landscape".
#[wasm_bindgen(js_name = "composeFullPagePdf")]
#[allow(clippy::too_many_arguments)]
pub fn compose_full_page_pdf_js(
    offsets: Vec<f64>,
    viewport_width: f64,
    viewport_height: f64,
    dpr: f64,
    tile_widths: Vec<u32>,
    tile_heights: Vec<u32>,
    tile_rgba_concat: Vec<u8>,
    page_size: &str,
    orientation: &str,
) -> Result<Vec<u8>, JsValue> {
    let page_size = parse_page_size(page_size)?;
    let orientation = parse_orientation(orientation)?;

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

    compose_full_page_pdf(&plan, dpr, &tiles, page_size, orientation)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
