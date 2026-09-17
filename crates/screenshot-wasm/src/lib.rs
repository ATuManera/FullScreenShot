// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use wasm_bindgen::prelude::*;

use screenshot_core::geometry::plan_tile_offsets;

/// Plans scroll-Y tile offsets for a full-page capture. Returns a JS
/// array of numbers (CSS px) on success, or throws a JS error carrying
/// the underlying `CoreError`'s message on invalid input.
#[wasm_bindgen]
pub fn plan_tiles(
    viewport_height: f64,
    content_height: f64,
    overlap: f64,
) -> Result<js_sys::Array, JsValue> {
    let offsets = plan_tile_offsets(viewport_height, content_height, overlap)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let arr = js_sys::Array::new();
    for offset in offsets {
        arr.push(&JsValue::from_f64(offset));
    }
    Ok(arr)
}
