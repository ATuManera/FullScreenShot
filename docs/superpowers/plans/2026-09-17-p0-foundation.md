# P0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (chosen over subagent-driven-development: the author already holds full spec context from brainstorming, so a fresh-eyes subagent per task adds latency without added review value for this scaffolding-heavy phase — see spec Decisions section). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up FullScreenShot's foundation: a compiling/tested Rust workspace, complete and consistent legal/attribution docs, a minimal MV3 extension shell that loads in Chrome, three ADRs, basic CI, test fixtures, and an `xtask` build entrypoint — with nothing here claiming capture functionality (that's P1).

**Architecture:** Cargo workspace at repo root with 5 library crates under `crates/` (`screenshot-core`, `screenshot-png`, `screenshot-pdf`, `screenshot-md`, `screenshot-wasm`) plus an `xtask` binary crate. `screenshot-core` holds shared geometry/error types other crates depend on. The browser extension lives in `extension/` as a separate JS/TS tree (no Cargo dependency at build-time in P0; wiring the compiled WASM into it is a P0 step but the extension doesn't yet call into it for capture logic).

**Tech Stack:** Rust 1.98 (workspace), `wasm32-unknown-unknown` target, TypeScript (extension, no bundler yet — plain `tsc` typecheck), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-p0-foundation-design.md`

## Global Constraints

- License: MPL-2.0, "Incompatible With Secondary Licenses" (Exhibit B notice required in `LICENSE`).
- SPDX header on project-owned source files: `SPDX-License-Identifier: MPL-2.0-no-copyleft-exception` / `Copyright (c) 2026 A Tu Manera Digital / Fernando Gallarday`.
- Canonical repo: `https://github.com/ATuManera/FullScreenShot` (referenced in docs even though not yet created remotely).
- Manifest V3 only. Permissions in P0: `activeTab`, `scripting`, `storage` — nothing else.
- No remote scripts, no telemetry, no network calls anywhere in the codebase.
- No giant placeholder files — every crate/file created in P0 must compile and, where it has logic, have real tests.
- Version: `0.1.0` everywhere (Cargo.toml files, manifest.json, package.json if any).

---

### Task 1: Cargo workspace + screenshot-core (error, geometry)

**Files:**

- Create: `Cargo.toml` (workspace root)
- Create: `crates/screenshot-core/Cargo.toml`
- Create: `crates/screenshot-core/src/lib.rs`
- Create: `crates/screenshot-core/src/error.rs`
- Create: `crates/screenshot-core/src/geometry.rs`

**Interfaces:**

- Produces: `screenshot_core::error::CoreError` (enum, `Debug + Display + std::error::Error`, variants: `InvalidDimensions { width: u32, height: u32 }`, `Overflow(String)`).

- Produces: `screenshot_core::geometry::{Point, Size, Rect, DevicePixelRatio}` — `Point{x:f64,y:f64}`, `Size{width:f64,height:f64}`, `Rect{origin:Point,size:Size}`, `DevicePixelRatio(f64)` (newtype).

- Produces: `screenshot_core::geometry::DevicePixelRatio::css_to_device(&self, css_px: f64) -> f64` and `device_to_css(&self, device_px: f64) -> f64`.

- Produces: `screenshot_core::geometry::plan_tile_offsets(viewport_height: f64, content_height: f64, overlap: f64) -> Result<Vec<f64>, CoreError>` — returns the list of scroll-Y offsets (CSS px) needed to cover `content_height` using a viewport of `viewport_height`, with `overlap` px of intentional overlap between consecutive tiles to avoid seam gaps from rounding. Must return `Err(CoreError::InvalidDimensions)` if `viewport_height <= 0.0` or `content_height < 0.0`, and `Err(CoreError::Overflow)` if the computed tile count would exceed 100_000.

- [ ] **Step 1: Write workspace root `Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = [
    "crates/screenshot-core",
    "crates/screenshot-png",
    "crates/screenshot-pdf",
    "crates/screenshot-md",
    "crates/screenshot-wasm",
    "xtask",
]

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "MPL-2.0"
authors = ["Fernando Gallarday <fernando@gallarday.net>"]
repository = "https://github.com/ATuManera/FullScreenShot"

[profile.release]
opt-level = "s"
lto = true
```

- [ ] **Step 2: Write `crates/screenshot-core/Cargo.toml`**

```toml
[package]
name = "screenshot-core"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true
repository.workspace = true
description = "Capture geometry, planning and validation core for FullScreenShot"

[dependencies]

[dev-dependencies]
proptest = "1"
```

- [ ] **Step 3: Write `crates/screenshot-core/src/error.rs`**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum CoreError {
    InvalidDimensions { width: u32, height: u32 },
    Overflow(String),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::InvalidDimensions { width, height } => {
                write!(f, "invalid dimensions: {width}x{height}")
            }
            CoreError::Overflow(msg) => write!(f, "overflow: {msg}"),
        }
    }
}

impl std::error::Error for CoreError {}
```

- [ ] **Step 4: Write failing tests + implementation together in `crates/screenshot-core/src/geometry.rs`**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use crate::error::CoreError;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub origin: Point,
    pub size: Size,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DevicePixelRatio(pub f64);

impl DevicePixelRatio {
    pub fn css_to_device(&self, css_px: f64) -> f64 {
        css_px * self.0
    }

    pub fn device_to_css(&self, device_px: f64) -> f64 {
        device_px / self.0
    }
}

const MAX_TILES: usize = 100_000;

/// Plans scroll-Y offsets (CSS px) needed to cover `content_height` using a
/// viewport of `viewport_height`, each consecutive pair overlapping by
/// `overlap` px to absorb sub-pixel rounding error at stitch seams.
pub fn plan_tile_offsets(
    viewport_height: f64,
    content_height: f64,
    overlap: f64,
) -> Result<Vec<f64>, CoreError> {
    if viewport_height <= 0.0 || content_height < 0.0 || !viewport_height.is_finite() || !content_height.is_finite() {
        return Err(CoreError::InvalidDimensions {
            width: 0,
            height: content_height.max(0.0) as u32,
        });
    }
    if content_height <= viewport_height {
        return Ok(vec![0.0]);
    }

    let stride = (viewport_height - overlap).max(1.0);
    let mut offsets = Vec::new();
    let mut y = 0.0_f64;
    let max_y = content_height - viewport_height;

    loop {
        offsets.push(y.min(max_y));
        if offsets.len() > MAX_TILES {
            return Err(CoreError::Overflow(format!(
                "tile plan exceeded {MAX_TILES} tiles for content_height={content_height}"
            )));
        }
        if y >= max_y {
            break;
        }
        y += stride;
    }

    Ok(offsets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpr_round_trips_integer_scale() {
        let dpr = DevicePixelRatio(2.0);
        assert_eq!(dpr.css_to_device(10.0), 20.0);
        assert_eq!(dpr.device_to_css(20.0), 10.0);
    }

    #[test]
    fn dpr_handles_fractional_scale() {
        let dpr = DevicePixelRatio(1.25);
        assert_eq!(dpr.css_to_device(100.0), 125.0);
        assert!((dpr.device_to_css(125.0) - 100.0).abs() < 1e-9);
    }

    #[test]
    fn single_tile_when_content_fits_viewport() {
        let offsets = plan_tile_offsets(800.0, 600.0, 40.0).unwrap();
        assert_eq!(offsets, vec![0.0]);
    }

    #[test]
    fn single_tile_when_content_equals_viewport() {
        let offsets = plan_tile_offsets(800.0, 800.0, 40.0).unwrap();
        assert_eq!(offsets, vec![0.0]);
    }

    #[test]
    fn multiple_tiles_cover_full_content_with_overlap() {
        let offsets = plan_tile_offsets(1000.0, 3200.0, 100.0).unwrap();
        let viewport = 1000.0;
        let content = 3200.0;
        assert_eq!(*offsets.last().unwrap(), content - viewport);
        for w in offsets.windows(2) {
            let covered_end = w[0] + viewport;
            assert!(covered_end >= w[1], "gap between tiles: {w:?}");
        }
    }

    #[test]
    fn last_tile_never_exceeds_content_bounds() {
        let offsets = plan_tile_offsets(377.0, 10_007.0, 50.0).unwrap();
        let viewport = 377.0;
        let content = 10_007.0;
        for &y in &offsets {
            assert!(y + viewport <= content + 1e-6);
        }
    }

    #[test]
    fn rejects_non_positive_viewport() {
        let err = plan_tile_offsets(0.0, 1000.0, 10.0).unwrap_err();
        assert!(matches!(err, CoreError::InvalidDimensions { .. }));
    }

    #[test]
    fn rejects_negative_content_height() {
        let err = plan_tile_offsets(500.0, -1.0, 10.0).unwrap_err();
        assert!(matches!(err, CoreError::InvalidDimensions { .. }));
    }

    #[test]
    fn rejects_absurd_content_height_as_overflow() {
        let err = plan_tile_offsets(1.0, 1.0e12, 0.0).unwrap_err();
        assert!(matches!(err, CoreError::Overflow(_)));
    }

    proptest::proptest! {
        #[test]
        fn offsets_are_monotonically_non_decreasing(
            viewport in 1.0f64..5000.0,
            content in 0.0f64..200_000.0,
            overlap in 0.0f64..500.0,
        ) {
            if let Ok(offsets) = plan_tile_offsets(viewport, content, overlap.min(viewport - 1.0)) {
                for w in offsets.windows(2) {
                    proptest::prop_assert!(w[1] >= w[0]);
                }
            }
        }
    }
}
```

- [ ] **Step 5: Write `crates/screenshot-core/src/lib.rs`**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

pub mod error;
pub mod geometry;

pub use error::CoreError;
pub use geometry::{DevicePixelRatio, Point, Rect, Size};
```

- [ ] **Step 6: Run tests**

Run: `cargo test -p screenshot-core`
Expected: all tests in `geometry.rs` PASS (9 unit tests + 1 proptest), 0 failed.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml crates/screenshot-core
git commit -m "feat(core): initialize workspace and capture geometry"
```

---

### Task 2: screenshot-core remaining modules (capture_plan, tile, compositor, validation)

**Files:**

- Create: `crates/screenshot-core/src/capture_plan.rs`
- Create: `crates/screenshot-core/src/tile.rs`
- Create: `crates/screenshot-core/src/compositor.rs`
- Create: `crates/screenshot-core/src/validation.rs`
- Modify: `crates/screenshot-core/src/lib.rs`

**Interfaces:**

- Consumes: `crate::geometry::{Rect, Point, Size}`, `crate::error::CoreError` from Task 1.

- Produces: `screenshot_core::tile::TileId(pub u64)` (newtype, `Copy + Eq + Hash + Ord`).

- Produces: `screenshot_core::tile::Tile { pub id: TileId, pub scroll_offset: crate::geometry::Point, pub crop: Rect }`.

- Produces: `screenshot_core::capture_plan::CapturePlan { pub tiles: Vec<Tile>, pub content_size: Size }` and `CapturePlan::from_offsets(offsets: &[f64], viewport: Size) -> CapturePlan`.

- Produces: `screenshot_core::validation::validate_plan(plan: &CapturePlan) -> Result<(), CoreError>` — checks: no duplicate `TileId`s, no duplicate `scroll_offset`s among tiles (catches "duplicate tiles"), tiles list not empty (catches "missing tiles"), every `crop.size` has positive width/height.

- Produces: `screenshot_core::compositor::CompositeError` (re-exported alias `pub type CompositeError = CoreError;`) — the streaming compositor implementation itself lands in P1 alongside the PNG writer; this module in P0 only defines `pub trait RowSink { fn write_row(&mut self, row: &[u8]) -> Result<(), CoreError>; }`, the interface P1's real compositor and PNG writer will implement against.

- [ ] **Step 1: Write `crates/screenshot-core/src/tile.rs` with tests**

```rust
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
```

- [ ] **Step 2: Write `crates/screenshot-core/src/capture_plan.rs` with tests**

```rust
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
```

- [ ] **Step 3: Write `crates/screenshot-core/src/validation.rs` with tests**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use std::collections::HashSet;

use crate::capture_plan::CapturePlan;
use crate::error::CoreError;

pub fn validate_plan(plan: &CapturePlan) -> Result<(), CoreError> {
    if plan.tiles.is_empty() {
        return Err(CoreError::InvalidDimensions {
            width: plan.content_size.width as u32,
            height: plan.content_size.height as u32,
        });
    }

    let mut seen_ids = HashSet::new();
    let mut seen_offsets = HashSet::new();
    for tile in &plan.tiles {
        if !seen_ids.insert(tile.id) {
            return Err(CoreError::Overflow(format!("duplicate tile id: {:?}", tile.id)));
        }
        let key = (tile.scroll_offset.x.to_bits(), tile.scroll_offset.y.to_bits());
        if !seen_offsets.insert(key) {
            return Err(CoreError::Overflow(format!(
                "duplicate scroll offset in plan: {:?}",
                tile.scroll_offset
            )));
        }
        if tile.crop.size.width <= 0.0 || tile.crop.size.height <= 0.0 {
            return Err(CoreError::InvalidDimensions {
                width: tile.crop.size.width as u32,
                height: tile.crop.size.height as u32,
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Size;

    #[test]
    fn rejects_empty_plan() {
        let plan = CapturePlan::from_offsets(&[], Size { width: 800.0, height: 600.0 });
        assert!(validate_plan(&plan).is_err());
    }

    #[test]
    fn accepts_well_formed_plan() {
        let plan = CapturePlan::from_offsets(&[0.0, 500.0], Size { width: 800.0, height: 600.0 });
        assert!(validate_plan(&plan).is_ok());
    }

    #[test]
    fn rejects_duplicate_scroll_offsets() {
        let mut plan = CapturePlan::from_offsets(&[0.0, 500.0], Size { width: 800.0, height: 600.0 });
        plan.tiles[1].scroll_offset = plan.tiles[0].scroll_offset;
        assert!(validate_plan(&plan).is_err());
    }

    #[test]
    fn rejects_zero_size_crop() {
        let mut plan = CapturePlan::from_offsets(&[0.0], Size { width: 800.0, height: 600.0 });
        plan.tiles[0].crop.size.width = 0.0;
        assert!(validate_plan(&plan).is_err());
    }
}
```

- [ ] **Step 4: Write `crates/screenshot-core/src/compositor.rs`**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use crate::error::CoreError;

/// Sink for streaming, row-by-row image output. Implemented by P1's PNG
/// writer and the streaming compositor so full-page composition never
/// needs to hold the entire stitched bitmap in memory at once.
pub trait RowSink {
    fn write_row(&mut self, row: &[u8]) -> Result<(), CoreError>;
}

pub type CompositeError = CoreError;

#[cfg(test)]
mod tests {
    use super::*;

    struct CountingSink {
        rows_written: usize,
    }

    impl RowSink for CountingSink {
        fn write_row(&mut self, _row: &[u8]) -> Result<(), CoreError> {
            self.rows_written += 1;
            Ok(())
        }
    }

    #[test]
    fn row_sink_trait_is_implementable_and_callable() {
        let mut sink = CountingSink { rows_written: 0 };
        sink.write_row(&[0, 0, 0, 255]).unwrap();
        sink.write_row(&[255, 255, 255, 255]).unwrap();
        assert_eq!(sink.rows_written, 2);
    }
}
```

- [ ] **Step 5: Update `crates/screenshot-core/src/lib.rs`**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

pub mod capture_plan;
pub mod compositor;
pub mod error;
pub mod geometry;
pub mod tile;
pub mod validation;

pub use error::CoreError;
pub use geometry::{DevicePixelRatio, Point, Rect, Size};
```

- [ ] **Step 6: Run tests**

Run: `cargo test -p screenshot-core`
Expected: all previous tests plus 2 (tile) + 3 (capture_plan) + 4 (validation) + 1 (compositor) = 10 new tests PASS, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add crates/screenshot-core
git commit -m "feat(core): add capture plan, tile, validation and compositor interface"
```

---

### Task 3: screenshot-png, screenshot-pdf, screenshot-md, screenshot-wasm crate skeletons

**Files:**

- Create: `crates/screenshot-png/Cargo.toml`, `crates/screenshot-png/src/lib.rs`
- Create: `crates/screenshot-pdf/Cargo.toml`, `crates/screenshot-pdf/src/lib.rs`, `crates/screenshot-pdf/src/paginator.rs`
- Create: `crates/screenshot-md/Cargo.toml`, `crates/screenshot-md/src/lib.rs`, `crates/screenshot-md/src/ast.rs`, `crates/screenshot-md/src/sanitizer.rs`, `crates/screenshot-md/src/writer.rs`
- Create: `crates/screenshot-wasm/Cargo.toml`, `crates/screenshot-wasm/src/lib.rs`

**Interfaces:**

- Consumes: `screenshot_core::geometry::Size`, `screenshot_core::CoreError` from Task 1/2.

- Produces: `screenshot_pdf::paginator::PageSize` enum (`A4`, `Letter`, `Auto(Size)`) and `paginate(content_height: f64, page_height: f64) -> Result<Vec<(f64, f64)>, CoreError>` returning `(start, end)` CSS-px ranges per page — reuses the same "no gaps, no overlap-loss" property as Task 1's tile planner but for page breaks, not overlapping tiles (pages must NOT overlap).

- Produces: `screenshot_md::ast::{Node, Document}` — `Node` enum with variants matching spec section 19: `Heading{level:u8, children:Vec<Node>}`, `Paragraph(Vec<Node>)`, `Text(String)`, `Strong(Vec<Node>)`, `Emphasis(Vec<Node>)`, `Link{href:String, children:Vec<Node>}`, `Image{src:String, alt:String}`, `OrderedList(Vec<Node>)`, `UnorderedList(Vec<Node>)`, `ListItem(Vec<Node>)`, `Table{rows:Vec<Node>}`, `TableRow(Vec<Node>)`, `TableCell(Vec<Node>)`, `Code(String)`, `CodeBlock{lang:Option<String>, code:String}`, `BlockQuote(Vec<Node>)`, `HorizontalRule`. `Document{children: Vec<Node>}`.

- Produces: `screenshot_md::sanitizer::sanitize_href(href: &str) -> Option<String>` — returns `None` for `javascript:` URLs (case-insensitive, whitespace-tolerant), `Some(href.to_string())` otherwise.

- Produces: `screenshot_md::writer::write_markdown(doc: &Document) -> String` — deterministic renderer covering `Heading`, `Paragraph`, `Text`, `Strong`, `Emphasis`, `Link` (via `sanitize_href`, dropping unsafe links to plain text), `CodeBlock`, `HorizontalRule` (the remaining node kinds are wired into the writer in P3 alongside full DOM-to-AST extraction; the writer already exhaustively matches every `Node` variant so this compiles and there is no `todo!()`/`unimplemented!()` path — unhandled-in-P0 variants currently render their child text via a shared `render_children` fallback).

- Produces: `screenshot_png` crate depends on `png` crate (MIT/Apache-2.0, wasm32-compatible) and exposes `screenshot_png::encode_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, CoreError>`.

- Produces: `screenshot_wasm` crate depends on `wasm-bindgen` and re-exports `#[wasm_bindgen] pub fn plan_tiles(viewport_height: f64, content_height: f64, overlap: f64) -> Result<js_sys::Array, JsValue>` wrapping Task 1's `plan_tile_offsets`.

- [ ] **Step 1: Write `crates/screenshot-png/Cargo.toml`**

```toml
[package]
name = "screenshot-png"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true
repository.workspace = true
description = "Lossless PNG encoding for FullScreenShot captures"

[dependencies]
screenshot-core = { path = "../screenshot-core" }
png = "0.17"
```

- [ ] **Step 2: Write `crates/screenshot-png/src/lib.rs` with test**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use screenshot_core::CoreError;

pub fn encode_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, CoreError> {
    if width == 0 || height == 0 {
        return Err(CoreError::InvalidDimensions { width, height });
    }
    let expected_len = (width as usize) * (height as usize) * 4;
    if rgba.len() != expected_len {
        return Err(CoreError::InvalidDimensions { width, height });
    }

    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| CoreError::Overflow(e.to_string()))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| CoreError::Overflow(e.to_string()))?;
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_a_single_pixel_png_with_valid_signature() {
        let rgba = [255u8, 0, 0, 255];
        let png_bytes = encode_rgba(1, 1, &rgba).unwrap();
        assert_eq!(&png_bytes[0..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    #[test]
    fn rejects_mismatched_buffer_length() {
        let rgba = [255u8, 0, 0]; // not a multiple of 4
        assert!(encode_rgba(1, 1, &rgba).is_err());
    }

    #[test]
    fn rejects_zero_dimensions() {
        assert!(encode_rgba(0, 10, &[]).is_err());
    }
}
```

- [ ] **Step 3: Write `crates/screenshot-pdf/Cargo.toml`**

```toml
[package]
name = "screenshot-pdf"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true
repository.workspace = true
description = "Paginated raster PDF export for FullScreenShot captures"

[dependencies]
screenshot-core = { path = "../screenshot-core" }
```

- [ ] **Step 4: Write `crates/screenshot-pdf/src/paginator.rs` with tests**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use screenshot_core::{CoreError, Size};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PageSize {
    A4,
    Letter,
    Auto(Size),
}

impl PageSize {
    fn css_height_px(&self) -> f64 {
        match self {
            // A4 at 96 CSS px/inch: 11.69in
            PageSize::A4 => 1122.24,
            // Letter at 96 CSS px/inch: 11in
            PageSize::Letter => 1056.0,
            PageSize::Auto(size) => size.height,
        }
    }
}

/// Splits `content_height` into non-overlapping, gap-free (start, end)
/// ranges of at most `page_height` CSS px each.
pub fn paginate(content_height: f64, page_size: PageSize) -> Result<Vec<(f64, f64)>, CoreError> {
    let page_height = page_size.css_height_px();
    if content_height < 0.0 || page_height <= 0.0 {
        return Err(CoreError::InvalidDimensions {
            width: 0,
            height: content_height.max(0.0) as u32,
        });
    }
    if content_height == 0.0 {
        return Ok(vec![(0.0, 0.0)]);
    }

    let mut pages = Vec::new();
    let mut y = 0.0_f64;
    while y < content_height {
        let end = (y + page_height).min(content_height);
        pages.push((y, end));
        y = end;
    }
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_page_when_content_fits() {
        let pages = paginate(500.0, PageSize::Auto(Size { width: 800.0, height: 1000.0 })).unwrap();
        assert_eq!(pages, vec![(0.0, 500.0)]);
    }

    #[test]
    fn splits_into_multiple_non_overlapping_pages() {
        let page = PageSize::Auto(Size { width: 800.0, height: 1000.0 });
        let pages = paginate(2500.0, page).unwrap();
        assert_eq!(pages, vec![(0.0, 1000.0), (1000.0, 2000.0), (2000.0, 2500.0)]);
        for w in pages.windows(2) {
            assert_eq!(w[0].1, w[1].0, "pages must be contiguous with no gap or overlap");
        }
    }

    #[test]
    fn a4_and_letter_produce_distinct_page_heights() {
        let content = 3000.0;
        let a4_pages = paginate(content, PageSize::A4).unwrap();
        let letter_pages = paginate(content, PageSize::Letter).unwrap();
        assert_ne!(a4_pages.len(), 0);
        assert_ne!(letter_pages.len(), 0);
        assert_ne!(a4_pages[0].1, letter_pages[0].1);
    }

    #[test]
    fn rejects_negative_content_height() {
        assert!(paginate(-1.0, PageSize::A4).is_err());
    }
}
```

- [ ] **Step 5: Write `crates/screenshot-pdf/src/lib.rs`**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

pub mod paginator;

pub use paginator::{paginate, PageSize};
```

- [ ] **Step 6: Write `crates/screenshot-md/Cargo.toml`**

```toml
[package]
name = "screenshot-md"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true
repository.workspace = true
description = "Semantic DOM-to-Markdown AST and writer for FullScreenShot"

[dependencies]
screenshot-core = { path = "../screenshot-core" }
```

- [ ] **Step 7: Write `crates/screenshot-md/src/ast.rs` with test**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    Heading { level: u8, children: Vec<Node> },
    Paragraph(Vec<Node>),
    Text(String),
    Strong(Vec<Node>),
    Emphasis(Vec<Node>),
    Link { href: String, children: Vec<Node> },
    Image { src: String, alt: String },
    OrderedList(Vec<Node>),
    UnorderedList(Vec<Node>),
    ListItem(Vec<Node>),
    Table { rows: Vec<Node> },
    TableRow(Vec<Node>),
    TableCell(Vec<Node>),
    Code(String),
    CodeBlock { lang: Option<String>, code: String },
    BlockQuote(Vec<Node>),
    HorizontalRule,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub children: Vec<Node>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_can_hold_a_mixed_node_tree() {
        let doc = Document {
            children: vec![
                Node::Heading {
                    level: 1,
                    children: vec![Node::Text("Title".into())],
                },
                Node::Paragraph(vec![Node::Text("Hello ".into()), Node::Strong(vec![Node::Text("world".into())])]),
                Node::HorizontalRule,
            ],
        };
        assert_eq!(doc.children.len(), 3);
    }
}
```

- [ ] **Step 8: Write `crates/screenshot-md/src/sanitizer.rs` with tests**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/// Returns `None` for links that must not be rendered as clickable
/// Markdown links (javascript: URLs), `Some(href)` otherwise.
pub fn sanitize_href(href: &str) -> Option<String> {
    let normalized: String = href
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    if normalized.starts_with("javascript:") {
        None
    } else {
        Some(href.trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_https_links() {
        assert_eq!(sanitize_href("https://example.com"), Some("https://example.com".to_string()));
    }

    #[test]
    fn blocks_javascript_urls() {
        assert_eq!(sanitize_href("javascript:alert(1)"), None);
    }

    #[test]
    fn blocks_javascript_urls_with_whitespace_obfuscation() {
        assert_eq!(sanitize_href(" \tjava\nscript:alert(1)"), None);
    }

    #[test]
    fn blocks_javascript_urls_case_insensitively() {
        assert_eq!(sanitize_href("JavaScript:alert(1)"), None);
    }

    #[test]
    fn allows_relative_links() {
        assert_eq!(sanitize_href("/about"), Some("/about".to_string()));
    }
}
```

- [ ] **Step 9: Write `crates/screenshot-md/src/writer.rs` with tests**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use crate::ast::{Document, Node};
use crate::sanitizer::sanitize_href;

pub fn write_markdown(doc: &Document) -> String {
    let mut out = String::new();
    for node in &doc.children {
        render_node(node, &mut out);
        out.push('\n');
    }
    out
}

fn render_children(children: &[Node], out: &mut String) {
    for child in children {
        render_node(child, out);
    }
}

fn render_node(node: &Node, out: &mut String) {
    match node {
        Node::Heading { level, children } => {
            out.push_str(&"#".repeat((*level).clamp(1, 6) as usize));
            out.push(' ');
            render_children(children, out);
            out.push('\n');
        }
        Node::Paragraph(children) => {
            render_children(children, out);
            out.push('\n');
        }
        Node::Text(text) => out.push_str(text),
        Node::Strong(children) => {
            out.push_str("**");
            render_children(children, out);
            out.push_str("**");
        }
        Node::Emphasis(children) => {
            out.push('_');
            render_children(children, out);
            out.push('_');
        }
        Node::Link { href, children } => match sanitize_href(href) {
            Some(safe_href) => {
                out.push('[');
                render_children(children, out);
                out.push_str("](");
                out.push_str(&safe_href);
                out.push(')');
            }
            None => render_children(children, out),
        },
        Node::CodeBlock { lang, code } => {
            out.push_str("```");
            out.push_str(lang.as_deref().unwrap_or(""));
            out.push('\n');
            out.push_str(code);
            out.push_str("\n```\n");
        }
        Node::HorizontalRule => out.push_str("---\n"),
        // Image, lists, tables, code spans, block quotes: full rendering
        // lands in P3 with the DOM extractor. Until then, render inner
        // text so nothing panics and nothing silently disappears.
        Node::Image { alt, .. } => out.push_str(alt),
        Node::OrderedList(children)
        | Node::UnorderedList(children)
        | Node::ListItem(children)
        | Node::BlockQuote(children)
        | Node::TableRow(children)
        | Node::TableCell(children) => render_children(children, out),
        Node::Table { rows } => render_children(rows, out),
        Node::Code(text) => {
            out.push('`');
            out.push_str(text);
            out.push('`');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_heading_and_paragraph() {
        let doc = Document {
            children: vec![
                Node::Heading { level: 1, children: vec![Node::Text("Title".into())] },
                Node::Paragraph(vec![Node::Text("Body text".into())]),
            ],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("# Title"));
        assert!(md.contains("Body text"));
    }

    #[test]
    fn renders_safe_link_as_markdown_link() {
        let doc = Document {
            children: vec![Node::Paragraph(vec![Node::Link {
                href: "https://example.com".into(),
                children: vec![Node::Text("example".into())],
            }])],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("[example](https://example.com)"));
    }

    #[test]
    fn drops_javascript_link_href_but_keeps_text() {
        let doc = Document {
            children: vec![Node::Paragraph(vec![Node::Link {
                href: "javascript:alert(1)".into(),
                children: vec![Node::Text("click me".into())],
            }])],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("click me"));
        assert!(!md.contains("javascript:"));
    }

    #[test]
    fn renders_code_block_with_language() {
        let doc = Document {
            children: vec![Node::CodeBlock { lang: Some("rust".into()), code: "fn main() {}".into() }],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("```rust"));
        assert!(md.contains("fn main() {}"));
    }

    #[test]
    fn writer_never_panics_on_any_node_variant() {
        let doc = Document {
            children: vec![
                Node::Image { src: "x.png".into(), alt: "alt text".into() },
                Node::UnorderedList(vec![Node::ListItem(vec![Node::Text("item".into())])]),
                Node::Table { rows: vec![Node::TableRow(vec![Node::TableCell(vec![Node::Text("cell".into())])])] },
                Node::BlockQuote(vec![Node::Text("quoted".into())]),
                Node::Code("inline".into()),
            ],
        };
        let md = write_markdown(&doc);
        assert!(md.contains("alt text"));
        assert!(md.contains("item"));
        assert!(md.contains("cell"));
        assert!(md.contains("quoted"));
        assert!(md.contains("inline"));
    }
}
```

- [ ] **Step 10: Write `crates/screenshot-md/src/lib.rs`**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

pub mod ast;
pub mod sanitizer;
pub mod writer;

pub use ast::{Document, Node};
pub use writer::write_markdown;
```

- [ ] **Step 11: Write `crates/screenshot-wasm/Cargo.toml`**

```toml
[package]
name = "screenshot-wasm"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true
repository.workspace = true
description = "WASM bridge exposing FullScreenShot's Rust core to the extension"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
screenshot-core = { path = "../screenshot-core" }
wasm-bindgen = "0.2"
js-sys = "0.3"
```

- [ ] **Step 12: Write `crates/screenshot-wasm/src/lib.rs`**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use wasm_bindgen::prelude::*;

use screenshot_core::geometry::plan_tile_offsets;

/// Plans scroll-Y tile offsets for a full-page capture. Returns a JS
/// array of numbers (CSS px) on success, or throws a JS error carrying
/// the underlying `CoreError`'s message on invalid input.
#[wasm_bindgen]
pub fn plan_tiles(viewport_height: f64, content_height: f64, overlap: f64) -> Result<js_sys::Array, JsValue> {
    let offsets = plan_tile_offsets(viewport_height, content_height, overlap)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let arr = js_sys::Array::new();
    for offset in offsets {
        arr.push(&JsValue::from_f64(offset));
    }
    Ok(arr)
}
```

- [ ] **Step 13: Run all workspace tests**

Run: `cargo test --workspace`
Expected: 0 failed across all crates (screenshot-core ~19, screenshot-png 3, screenshot-pdf 4, screenshot-md 10).

- [ ] **Step 14: Build the wasm target explicitly**

Run: `cargo build -p screenshot-wasm --target wasm32-unknown-unknown`
Expected: builds successfully, produces `target/wasm32-unknown-unknown/debug/screenshot_wasm.wasm`.

- [ ] **Step 15: Commit**

```bash
git add crates/screenshot-png crates/screenshot-pdf crates/screenshot-md crates/screenshot-wasm
git commit -m "feat: add png, pdf pagination, markdown AST/writer and wasm bridge crates"
```

---

### Task 4: Legal, licensing and attribution documents

**Files:**

- Create: `LICENSE`
- Create: `AUTHORS.md`
- Create: `NOTICE.md`
- Create: `TRADEMARKS.md`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `SECURITY.md`
- Create: `PRIVACY.md`
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `CHANGELOG.md`
- Create: `README.md`

**Interfaces:**

- Consumes: nothing (pure documentation), but every doc must agree verbatim on: project name `FullScreenShot`, org `ATuManera`, author `Fernando Gallarday`, canonical repo `https://github.com/ATuManera/FullScreenShot`, year `2026`, license `MPL-2.0-no-copyleft-exception`.

- [ ] **Step 1: Fetch and write the official MPL-2.0 text to `LICENSE`, then append Exhibit B**

Fetch the plain-text official license from `https://www.mozilla.org/media/MPL/2.0/index.f75d2927d3c1.txt` (Mozilla's canonical plain-text MPL-2.0). Write its exact contents to `LICENSE` verbatim — do not alter a single word of the MPL body. Then append this exact block at the end of the file (this is Exhibit B language from the official MPL-2.0 text itself, selected as the project's choice):

```text
---

This Source Code Form is "Incompatible With Secondary Licenses", as
defined by the Mozilla Public License, v. 2.0.
```

If network fetch is unavailable in the execution environment, do not fabricate the license text from memory — stop and report the exact blocker instead of writing an approximate MPL-2.0 text.

- [ ] **Step 2: Write `AUTHORS.md`**

```markdown
# Authors

FullScreenShot
Original project: ATuManera
Original author: Fernando Gallarday
Canonical repository: https://github.com/ATuManera/FullScreenShot

## Contributors

Contributions are tracked via the Git history and GitHub's contributor
graph at the canonical repository above. To be added to this file
explicitly, open a pull request adding your name and (optionally) a
contact method.
```

- [ ] **Step 3: Write `NOTICE.md`**

```markdown
# NOTICE

FullScreenShot

Originally created by ATuManera / Fernando Gallarday.

Canonical project:
https://github.com/ATuManera/FullScreenShot

Copyright (c) 2026 ATuManera / Fernando Gallarday.

Licensed under the Mozilla Public License 2.0
with the "Incompatible With Secondary Licenses" notice.

See `LICENSE` for the full license text and `THIRD_PARTY_NOTICES.md`
for third-party components and their licenses.
```

- [ ] **Step 4: Write `TRADEMARKS.md`**

```markdown
# Trademarks

This document explains the difference between the **license on the
code** and any rights in the **FullScreenShot name and branding**.

## License vs. brand

The Mozilla Public License 2.0 (see `LICENSE`) grants broad rights to
use, modify, and redistribute the *source code* of this project. It
does **not** grant any trademark, service mark, or branding rights.
You are free to fork, modify, and redistribute FullScreenShot's code
under MPL-2.0 terms without needing separate permission for the code
itself.

## Use of the name "FullScreenShot", "ATuManera", and "Fernando Gallarday"

- You may factually state that your fork or derivative work is "based
  on FullScreenShot" or "a fork of FullScreenShot".
- You may **not** present a fork, derivative, or unrelated project as
  an official release, official edition, or as being published,
  endorsed, or maintained by ATuManera or Fernando Gallarday, unless
  you have their explicit written authorization.
- You may **not** use the "FullScreenShot" name, or the "ATuManera" or
  "Fernando Gallarday" names, in a way that is likely to confuse users
  into believing your distribution is the canonical one at
  https://github.com/ATuManera/FullScreenShot when it is not.
- Browser extension store listings, package names, and marketing
  copy for forks should clearly self-identify as independent/unofficial.

## What this is not

This is not a proprietary trademark license and it does not add any
restriction that would make the source code non-open-source. It is a
plain-language request for honest attribution, consistent with
standard open-source trademark practice (similar in spirit to how
projects like Firefox or Chromium separate code license from brand
usage). If you are unsure whether a specific use is acceptable, open
an issue at the canonical repository to ask.
```

- [ ] **Step 5: Write `THIRD_PARTY_NOTICES.md`**

```markdown
# Third-Party Notices

FullScreenShot uses the following third-party open-source components.
This file is updated whenever a new runtime dependency is added.

| Component | License | Purpose |
|---|---|---|
| [`png`](https://crates.io/crates/png) | MIT OR Apache-2.0 | Lossless PNG encoding (`screenshot-png`) |
| [`wasm-bindgen`](https://crates.io/crates/wasm-bindgen) | MIT OR Apache-2.0 | Rust/JS interop for the WASM bridge (`screenshot-wasm`) |
| [`js-sys`](https://crates.io/crates/js-sys) | MIT OR Apache-2.0 | JS type bindings for the WASM bridge (`screenshot-wasm`) |
| [`proptest`](https://crates.io/crates/proptest) | MIT OR Apache-2.0 | Property-based testing (dev-dependency only, not shipped) |

None of the above components are modified from their published form;
they are used as unmodified dependencies via Cargo/crates.io. No
component's license requires source redistribution beyond what MPL-2.0
already provides for this project's own code.

Design reference (not a code or asset dependency): FullScreenShot used
[mrcoles/full-page-screen-capture-chrome-extension](https://github.com/mrcoles/full-page-screen-capture-chrome-extension)
([license](https://github.com/mrcoles/full-page-screen-capture-chrome-extension/blob/master/LICENSE))
purely as a functional/behavioral reference during design. No source
code, architecture, or assets from that project are included here.
```

- [ ] **Step 6: Write `SECURITY.md`**

```markdown
# Security Policy

## Reporting a vulnerability

Please report security issues privately by opening a GitHub Security
Advisory at https://github.com/ATuManera/FullScreenShot/security/advisories/new
rather than a public issue. If that is unavailable, open a regular
issue asking a maintainer to provide a private contact channel.

Include: affected version, browser, reproduction steps, and impact.

## Threat model

FullScreenShot runs with browser extension privileges inside the
user's browser and processes untrusted page content (DOM, CSS, images,
URLs). Relevant threats we design against:

- Malicious page DOM/CSS crafted to break capture logic or exfiltrate
  data via the extension's own privileges.
- Huge or adversarial dimensions causing memory exhaustion (browser
  tab or WASM linear memory).
- DOM mutation during an in-progress capture.
- Untrusted URLs, `javascript:` URLs, `data:` URLs, inline SVG.
- Cross-origin iframes and canvas/WebGL content that cannot be safely
  or meaningfully captured.
- Spoofed or malformed messages between content script, background
  script, and the WASM module.
- Prototype pollution via attacker-controlled JS objects.
- Untrusted serialized data crossing the JS↔WASM boundary.

## Non-goals

FullScreenShot does not defend against a compromised browser itself,
a malicious extension store, or physical access to the user's device.

## Supported versions

Only the latest published `0.x` release line receives security fixes
during pre-1.0 development.
```

- [ ] **Step 7: Write `PRIVACY.md`**

```markdown
# Privacy Policy

FullScreenShot is designed to process everything **locally, on your
device**.

- **No transmission of captured content.** Screenshots, page DOM, and
  exported files never leave your device unless you explicitly choose
  to save/export them yourself.
- **No transmission of browsing history or URLs** to any server.
- **No analytics, no telemetry, no crash reporting to a remote
  service.**
- **No trackers, no advertising SDKs.**
- **No user account required** — there is no sign-in, and no server
  associates any data with you.
- **No cloud processing.** All capture, stitching, PNG/PDF/Markdown
  generation happens inside your browser via the local Rust/WebAssembly
  core.
- **No sale of information** — none is collected to sell.
- **No persistent storage of captures** beyond the export action you
  explicitly trigger; the extension does not silently retain your
  screenshots after you close or export them.

## Future features

If a future version were to add any feature requiring network access
(e.g., an optional cloud export), it would be strictly **opt-in**,
disabled by default, and documented here before release. No such
feature exists in the current version.

## Permissions

See `SECURITY.md` and the extension's `manifest.json` for the exact,
minimal browser permissions requested and why each is needed.
```

- [ ] **Step 8: Write `CONTRIBUTING.md`**

```markdown
# Contributing to FullScreenShot

Thank you for your interest in contributing.

## Ground rules

- All contributions are licensed under this project's license,
  MPL-2.0 ("Incompatible With Secondary Licenses") — see `LICENSE`.
- Keep privacy-first principles intact: no telemetry, no analytics, no
  network calls in the capture/export path, no remote code execution.
- Prefer the minimal browser permission set; justify any new permission
  in your pull request description and, if it changes architecture, in
  an ADR under `docs/architecture/`.

## Development setup

1. Install Rust (stable) and the `wasm32-unknown-unknown` target:
   `rustup target add wasm32-unknown-unknown`
2. Install Node.js (for the extension's TypeScript typecheck).
3. Build everything: `cargo xtask build`
4. Run tests: `cargo xtask test`

## Before opening a pull request

- `cargo fmt --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace`
- Keep commits small and scoped (one logical change per commit).
- Update `CHANGELOG.md` under "Unreleased" for user-facing changes.
- If your change affects a documented design in `docs/superpowers/specs/`
  or `docs/architecture/`, update that document in the same change.

## Code style

- Rust: rely on `cargo fmt` and `cargo clippy` defaults; no unsafe code
  without a comment explaining why it's necessary and sound.
- TypeScript: keep the extension shell minimal and auditable; no new
  frontend framework without discussion in an issue first.
```

- [ ] **Step 9: Write `CODE_OF_CONDUCT.md`**

```markdown
# Code of Conduct

## Our pledge

We as contributors and maintainers pledge to make participation in
FullScreenShot a harassment-free experience for everyone, regardless
of age, body size, disability, ethnicity, gender identity and
expression, level of experience, nationality, personal appearance,
race, religion, or sexual identity and orientation.

## Our standards

Examples of behavior that contributes to a positive environment:

- Using welcoming and inclusive language.
- Being respectful of differing viewpoints and experiences.
- Gracefully accepting constructive criticism.
- Focusing on what is best for the community and the project.

Examples of unacceptable behavior:

- Harassment, insulting or derogatory comments, and personal or
  political attacks.
- Publishing others' private information without explicit permission.
- Other conduct which could reasonably be considered inappropriate in
  a professional setting.

## Enforcement

Instances of unacceptable behavior may be reported to the maintainers
via a private GitHub Security Advisory or issue asking for a private
contact channel, as described in `SECURITY.md`. All complaints will be
reviewed and investigated.

## Attribution

This Code of Conduct is adapted from the
[Contributor Covenant](https://www.contributor-covenant.org/), version
2.1, available at
https://www.contributor-covenant.org/version/2/1/code_of_conduct.html.
```

- [ ] **Step 10: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to FullScreenShot are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- P0 Foundation: Rust workspace (`screenshot-core`, `screenshot-png`,
  `screenshot-pdf`, `screenshot-md`, `screenshot-wasm`) with capture
  geometry/planning, PNG encoding, PDF pagination, Markdown AST/writer,
  and a WASM bridge exposing tile planning.
- Legal and attribution documentation: `LICENSE` (MPL-2.0, Incompatible
  With Secondary Licenses), `AUTHORS.md`, `NOTICE.md`, `TRADEMARKS.md`,
  `THIRD_PARTY_NOTICES.md`, `SECURITY.md`, `PRIVACY.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
- Minimal Manifest V3 extension shell that loads in Chrome/Edge.
- Architecture Decision Records: ADR-0001 through ADR-0006 stubs for
  P0-relevant decisions.
- Basic CI (GitHub Actions): fmt, clippy, tests, workspace build, WASM
  build, TypeScript typecheck.

## [0.1.0] - Unreleased

Initial foundation. Not yet functional for end-user captures (see
`docs/superpowers/specs/2026-09-17-p0-foundation-design.md` for scope).
```

- [ ] **Step 11: Write `README.md`**

```markdown
# FullScreenShot

> Privacy-first full-page screenshot browser extension powered by Rust
> and WebAssembly. Capture visible pages, complete pages and scrollable
> regions, with local export to PNG, PDF and Markdown.

**Status: pre-alpha (P0 — Foundation).** Capture functionality is not
implemented yet; see [Roadmap](#roadmap).

## What is FullScreenShot

FullScreenShot is an open-source browser extension for Chrome, Edge,
and Safari that captures full web pages — visible viewport, entire
scrollable pages, or a specific scrollable container — and exports the
result as PNG, PDF, or semantic Markdown. Everything runs locally in
your browser: no servers, no accounts, no telemetry.

## Features (target scope)

- Capture Visible / Capture Full Page / Capture Selected Scroll Area
- Export to PNG (lossless), PDF (paginated), and Markdown (from the
  DOM, not OCR)
- Handles fractional device-pixel-ratio, browser zoom, sticky/fixed
  headers, and lazy-loaded content
- Manifest V3, minimal permissions, no `<all_urls>`, no
  `chrome.debugger`

## Architecture

```text
Chrome / Edge / Safari
        │
        ▼
Minimal WebExtension adapter (JavaScript / TypeScript)
        │
        ▼
Rust / WebAssembly Core
        (geometry, capture planning, stitching, PNG, PDF, Markdown)
```

The browser-dependent shell is intentionally small and auditable; all
non-trivial logic (geometry, tiling, compositing, encoding, Markdown
generation) lives in Rust, compiled to WebAssembly. See
`docs/architecture/` for the Architecture Decision Records behind
these choices.

## Installation

### From source (current state — no store listing yet)

```bash
git clone https://github.com/ATuManera/FullScreenShot
cd FullScreenShot
rustup target add wasm32-unknown-unknown
cargo xtask build
```

**Chrome:** open `chrome://extensions`, enable Developer mode, "Load
unpacked", select `extension/`.

**Edge:** open `edge://extensions`, enable Developer mode, "Load
unpacked", select `extension/`.

**Safari:** Safari packaging lands in a later phase (P4); see the
roadmap below.

## Privacy & Security

See `PRIVACY.md` and `SECURITY.md`. In short: 100% local processing,
no telemetry, no analytics, no cloud, no account, no remote code.

## Limitations

Pre-alpha: capture, export, and Safari support are not implemented
yet. Some internal browser pages cannot be captured by any extension
regardless of permissions (browser security restriction) — FullScreenShot
will report this clearly rather than silently fail.

## Design inspiration

FullScreenShot's functional scope was informed by studying
[mrcoles/full-page-screen-capture-chrome-extension](https://github.com/mrcoles/full-page-screen-capture-chrome-extension)
([license](https://github.com/mrcoles/full-page-screen-capture-chrome-extension/blob/master/LICENSE))
as a reference for known full-page-capture problems (DPR handling,
sticky elements, seams). FullScreenShot is an independent
implementation with a different architecture (Rust/WASM core, Manifest
V3, streaming compositor) and does not reuse its code or assets.

## Contributing

See `CONTRIBUTING.md`.

## License

Mozilla Public License 2.0, "Incompatible With Secondary Licenses".
See `LICENSE`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md`.

## Attribution

FullScreenShot — original project by **ATuManera** / **Fernando
Gallarday**. Canonical repository:
https://github.com/ATuManera/FullScreenShot. See `AUTHORS.md`,
`NOTICE.md`, and `TRADEMARKS.md`.

## Roadmap

- P1: Chrome/Edge Capture Visible + Capture Full Page → PNG

- P2: Selected Scroll Area, lazy loading, huge-page handling

- P3: PDF export, Markdown export

- P4: Safari

- P5: Security hardening, `cargo audit`/`cargo deny`

- P6: Release-candidate packaging
  
  ```
  
  ```

- [ ] **Step 12: Cross-check consistency**

Grep all 11 files for the strings `FullScreenShot`, `ATuManera`, `Fernando Gallarday`, `2026`, and the repo URL; confirm none of them diverge (e.g. no accidental `ATuManera Inc.` or wrong year) by running:

```bash
grep -rn "FullScreenShot\|ATuManera\|Fernando Gallarday\|github.com/ATuManera" LICENSE AUTHORS.md NOTICE.md TRADEMARKS.md THIRD_PARTY_NOTICES.md SECURITY.md PRIVACY.md CONTRIBUTING.md CODE_OF_CONDUCT.md CHANGELOG.md README.md
```

Expected: every occurrence matches the canonical spelling from Global Constraints; no mismatches. Fix inline if any are found.

- [ ] **Step 13: Commit**

```bash
git add LICENSE AUTHORS.md NOTICE.md TRADEMARKS.md THIRD_PARTY_NOTICES.md SECURITY.md PRIVACY.md CONTRIBUTING.md CODE_OF_CONDUCT.md CHANGELOG.md README.md
git commit -m "docs: establish licensing, privacy, security and project attribution"
```

---

### Task 5: Architecture Decision Records (ADR-0001, ADR-0002, ADR-0006)

**Files:**

- Create: `docs/architecture/ADR-0001-rust-wasm-core.md`
- Create: `docs/architecture/ADR-0002-browser-permissions.md`
- Create: `docs/architecture/ADR-0006-licensing-and-attribution.md`

**Interfaces:**

- Consumes: nothing.

- Produces: nothing consumed by later tasks; these are documentation records only.

- [ ] **Step 1: Write `docs/architecture/ADR-0001-rust-wasm-core.md`**

```markdown
# ADR-0001: Rust/WebAssembly core with a minimal JS/TS shell

## Status

Accepted (P0)

## Context

FullScreenShot needs complex, testable logic (capture geometry, tile
planning, stitching/compositing, PNG/PDF/Markdown generation) plus
access to browser-only WebExtension APIs (`captureVisibleTab`,
`scripting`, messaging, DOM interaction). These two concerns have very
different quality bars: the WebExtension surface is small and mostly
glue; the processing logic benefits from strong typing, unit and
property-based testing, and memory-safety guarantees under adversarial
input (hostile page DOM, huge dimensions).

## Decision

Implement all browser-dependent glue in a small, auditable
JavaScript/TypeScript shell (`extension/`). Implement all reusable,
non-trivial logic in Rust crates under `crates/`, compiled to
WebAssembly via `screenshot-wasm` and consumed by the shell. The core
must never reference browser APIs; the shell must never contain
capture-geometry, stitching, or file-format logic.

## Alternatives considered

- **"100% Rust" extension (e.g. via a full Rust-to-JS framework):**
  rejected — WebExtension APIs are fundamentally JS/browser-provided;
  forcing everything through Rust would add an opaque translation
  layer without removing the JS dependency, hurting auditability.
- **Pure JavaScript/TypeScript, no Rust:** rejected — full-page capture
  correctness (DPR/zoom math, seam-free stitching, streaming
  composition to bound memory) benefits materially from Rust's type
  system, testing ecosystem (proptest), and predictable performance
  under memory pressure; a privacy-first tool with security-sensitive
  parsing (untrusted DOM → Markdown AST) also benefits from Rust's
  memory safety.

## Consequences

- Two toolchains to maintain (Rust + TypeScript), coordinated via
  `cargo xtask`.
- Clear code-review boundary: browser-API changes review differently
  than core-logic changes.
- The WASM bridge (`screenshot-wasm`) becomes a deliberate, minimal,
  versioned interface — see ADR entries for capture strategy (P1) and
  streaming compositor (P1) for how that interface grows.
```

- [ ] **Step 2: Write `docs/architecture/ADR-0002-browser-permissions.md`**

```markdown
# ADR-0002: Minimal Manifest V3 permissions, no `chrome.debugger`

## Status

Accepted (P0)

## Context

FullScreenShot is a privacy-first extension. Browser permissions are
the primary trust signal users and store reviewers see. Some
implementations of full-page capture (including some historical
extensions) use `chrome.debugger` to script arbitrary page behavior,
or request `<all_urls>` broadly, to sidestep the limitations of
`captureVisibleTab()`.

## Decision

Use Manifest V3 exclusively. Start with the minimal permission set:
`activeTab`, `scripting`, `storage`. Do not request `<all_urls>`,
`debugger`, `webRequest`, `nativeMessaging`, `history`, or `cookies`
unless a specific, documented technical requirement in a later phase
proves no narrower permission suffices — and if so, that requirement
and the rejected narrower alternatives must be recorded in a new ADR
before the permission is added.

Full-page capture is implemented via repeated `captureVisibleTab()`
calls driven by content-script-controlled scrolling, not via
`chrome.debugger`.

## Alternatives considered

- **`chrome.debugger` for full-page capture:** rejected — grants far
  broader capability than screenshot capture needs (arbitrary CDP
  access), is a strong negative signal in store review and to
  privacy-conscious users, and is unnecessary given
  `captureVisibleTab()` plus scroll-driven tiling achieves the same
  result.
- **`<all_urls>` host permission upfront:** rejected — `activeTab`
  already grants per-invocation access to the page the user explicitly
  triggers the extension on, which matches FullScreenShot's UX (user
  clicks the extension to capture the current tab) without a
  standing, always-on broad host permission.

## Consequences

- Full-page capture must handle `captureVisibleTab()` rate limits
  itself (see the P1 rate limiter design).
- Some browser-internal or store-protected pages will not be
  capturable; the extension must detect and report this clearly (see
  spec section on browser limitations) rather than request elevated
  permissions to work around it.
```

- [ ] **Step 3: Write `docs/architecture/ADR-0006-licensing-and-attribution.md`**

```markdown
# ADR-0006: MPL-2.0 (Incompatible With Secondary Licenses) + separate trademark policy

## Status

Accepted (P0)

## Context

FullScreenShot is released as open source under the ATuManera
organization, authored by Fernando Gallarday. The project needs a
license that: is genuinely open-source, is compatible with a wasm32
Rust dependency graph, and protects the project's name/attribution
from being reused misleadingly by forks — without turning the *code*
license into something non-open-source.

## Decision

License all project-owned source under MPL-2.0, with the "Incompatible
With Secondary Licenses" notice (Exhibit B) applied, recorded in full
in `LICENSE`. Keep trademark/name protection entirely separate from
the code license: `TRADEMARKS.md` documents that MPL-2.0 grants no
brand rights, and that forks may not present themselves as official
ATuManera/Fernando Gallarday releases without authorization, while
remaining free to fork, modify, and redistribute the code itself.
Attribution to the original project/author is treated as a legal
notice (`NOTICE.md`, `AUTHORS.md`, an in-extension About screen), not
as advertising.

## Alternatives considered

- **MIT/Apache-2.0 dual license:** rejected — permissive but offers no
  file-level copyleft-notice mechanism comparable to MPL's per-file
  approach, and the project owner specifically wants the "Incompatible
  With Secondary Licenses" declaration.
- **A custom "source available" or proprietary-branding license:**
  rejected — would make the project not genuinely open-source, which
  contradicts the project's stated non-negotiable principle
  (`Open source.` in the top-level goals).

## Consequences

- Every project-owned source file should carry the SPDX header
  `SPDX-License-Identifier: MPL-2.0-no-copyleft-exception`.
- Third-party dependencies keep their own licenses, tracked in
  `THIRD_PARTY_NOTICES.md`; MPL-2.0 is file-level copyleft, so
  unmodified MIT/Apache-2.0 dependencies used as-is impose no
  additional obligations beyond their own notices.
- Any fork is legally free to use the code under MPL-2.0 but is asked,
  per `TRADEMARKS.md`, not to claim official status without
  authorization — this is a social/legal-attribution norm, not a
  code-license restriction.
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture
git commit -m "docs: add ADR-0001, ADR-0002, ADR-0006 for P0 decisions"
```

---

### Task 6: Minimal Manifest V3 extension shell (Chrome/Edge)

**Files:**

- Create: `extension/manifest.base.json`
- Create: `extension/src/browser/index.ts`
- Create: `extension/src/background/index.ts`
- Create: `extension/src/popup/popup.html`
- Create: `extension/src/popup/popup.css`
- Create: `extension/src/popup/popup.ts`
- Create: `extension/src/options/options.html`
- Create: `extension/src/options/options.ts`
- Create: `extension/tsconfig.json`
- Create: `extension/package.json`
- Create: `browser/chromium/build.sh`

**Interfaces:**

- Consumes: nothing from Rust yet (P0's extension shell does not call into WASM for capture logic — that wiring happens in P1 when there is real capture logic to call). It does verify the WASM artifact loads under the extension's CSP.

- Produces: `extension/src/browser/index.ts` exports `export const browser: BrowserAdapter` where `BrowserAdapter` wraps `chrome.*` APIs used so far (`captureVisibleTab` signature reserved for P1, `runtime.getManifest`) behind a promise-based interface — this is the seam P1's capture logic will extend, not bypass.

- [ ] **Step 1: Write `extension/manifest.base.json`**

```json
{
  "manifest_version": 3,
  "name": "FullScreenShot",
  "version": "0.1.0",
  "description": "Privacy-first full-page screenshot capture. 100% local. No telemetry.",
  "permissions": ["activeTab", "scripting", "storage"],
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "FullScreenShot"
  },
  "options_page": "options/options.html",
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  },
  "icons": {}
}
```

- [ ] **Step 2: Write `extension/src/browser/index.ts`**

```typescript
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Minimal browser abstraction layer. P1 extends this with capture
 * methods (captureVisibleTab, tabs.query, scripting.executeScript);
 * P0 only needs enough to prove the background/popup/options pages
 * load and can read the extension's own manifest.
 */
export interface BrowserAdapter {
  getManifestVersion(): string;
}

function createChromiumAdapter(): BrowserAdapter {
  return {
    getManifestVersion(): string {
      return chrome.runtime.getManifest().version;
    },
  };
}

export const browser: BrowserAdapter = createChromiumAdapter();
```

- [ ] **Step 3: Write `extension/src/background/index.ts`**

```typescript
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";

// P0: background service worker exists and starts cleanly. Capture
// message handling is added in P1 alongside real capture logic.
console.log(`FullScreenShot background service worker started (v${browser.getManifestVersion()})`);
```

- [ ] **Step 4: Write `extension/src/popup/popup.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>FullScreenShot</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <main>
    <h1>FullScreenShot</h1>
    <p role="status" id="status">Foundation build — capture actions land in P1.</p>
    <nav aria-label="Capture actions">
      <button type="button" disabled aria-disabled="true">Capture Visible</button>
      <button type="button" disabled aria-disabled="true">Capture Full Page</button>
      <button type="button" disabled aria-disabled="true">Select Scroll Area</button>
    </nav>
    <a href="../options/options.html" target="_blank" rel="noopener">Settings / About</a>
  </main>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 5: Write `extension/src/popup/popup.css`**

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #6b6b6b;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1a1a;
    --fg: #f2f2f2;
    --muted: #a0a0a0;
  }
}

body {
  margin: 0;
  padding: 12px;
  width: 260px;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.4 system-ui, sans-serif;
}

h1 {
  font-size: 16px;
  margin: 0 0 8px;
}

#status {
  color: var(--muted);
  margin: 0 0 12px;
}

nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

button {
  font: inherit;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--muted);
  background: transparent;
  color: var(--fg);
}

button:disabled {
  opacity: 0.5;
}
```

- [ ] **Step 6: Write `extension/src/popup/popup.ts`**

```typescript
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";

const status = document.getElementById("status");
if (status) {
  status.textContent = `FullScreenShot v${browser.getManifestVersion()} — capture actions land in P1.`;
}
```

- [ ] **Step 7: Write `extension/src/options/options.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>FullScreenShot — Settings / About</title>
</head>
<body>
  <main>
    <h1>FullScreenShot</h1>
    <section aria-labelledby="about-heading">
      <h2 id="about-heading">About</h2>
      <dl>
        <dt>Project</dt>
        <dd>FullScreenShot</dd>
        <dt>Original project</dt>
        <dd>ATuManera</dd>
        <dt>Original author</dt>
        <dd>Fernando Gallarday</dd>
        <dt>Canonical repository</dt>
        <dd><a href="https://github.com/ATuManera/FullScreenShot" target="_blank" rel="noopener">github.com/ATuManera/FullScreenShot</a></dd>
        <dt>Version</dt>
        <dd id="version"></dd>
        <dt>License</dt>
        <dd>MPL-2.0, Incompatible With Secondary Licenses</dd>
        <dt>Privacy policy</dt>
        <dd><a href="https://github.com/ATuManera/FullScreenShot/blob/main/PRIVACY.md" target="_blank" rel="noopener">PRIVACY.md</a></dd>
      </dl>
    </section>
  </main>
  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 8: Write `extension/src/options/options.ts`**

```typescript
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

import { browser } from "../browser/index.js";

const versionEl = document.getElementById("version");
if (versionEl) {
  versionEl.textContent = browser.getManifestVersion();
}
```

- [ ] **Step 9: Write `extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "../dist/chromium",
    "rootDir": "src",
    "types": ["chrome"]
  },
  "include": ["src"]
}
```

- [ ] **Step 10: Write `extension/package.json`**

```json
{
  "name": "fullscreenshot-extension",
  "version": "0.1.0",
  "private": true,
  "license": "MPL-2.0",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/chrome": "^0.0.280"
  }
}
```

- [ ] **Step 11: Write `browser/chromium/build.sh`**

```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
# Copyright (c) 2026 ATuManera / Fernando Gallarday
#
# Assembles dist/chromium/ from the compiled TypeScript output plus
# static extension assets (manifest, HTML/CSS, icons, wasm artifact).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST_DIR="$ROOT_DIR/dist/chromium"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

(cd "$ROOT_DIR/extension" && npm run build)

cp "$ROOT_DIR/extension/manifest.base.json" "$DIST_DIR/manifest.json"
cp -r "$ROOT_DIR/extension/src/popup/popup.html" "$ROOT_DIR/dist/chromium/popup/popup.html" 2>/dev/null || true
mkdir -p "$DIST_DIR/popup" "$DIST_DIR/options" "$DIST_DIR/icons"
cp "$ROOT_DIR/extension/src/popup/popup.html" "$DIST_DIR/popup/popup.html"
cp "$ROOT_DIR/extension/src/popup/popup.css" "$DIST_DIR/popup/popup.css"
cp "$ROOT_DIR/extension/src/options/options.html" "$DIST_DIR/options/options.html"

echo "dist/chromium assembled at $DIST_DIR"
```

- [ ] **Step 12: Install TypeScript dev dependencies and typecheck**

Run: `cd extension && npm install && npm run typecheck`
Expected: `tsc --noEmit` completes with no type errors.

- [ ] **Step 13: Make the build script executable and run it**

Run: `chmod +x browser/chromium/build.sh && ./browser/chromium/build.sh`
Expected: `dist/chromium/` created with `manifest.json`, compiled `background/index.js`, `popup/`, `options/` present.

- [ ] **Step 14: Manually verify the unpacked extension loads (documented, not automatable in this environment)**

Document in the task's commit message body (not a script) that loading
`dist/chromium/` via `chrome://extensions` → Developer mode → "Load
unpacked" must be done by a human with a real Chrome/Edge window, since
this execution environment has no interactive browser session. Record
the exact manifest/CSP contents reviewed instead, and flag this as a
P0 gate item that needs the user's (or a later browser-automation
task's) manual confirmation.

- [ ] **Step 15: Commit**

```bash
git add extension browser/chromium
git commit -m "feat(chromium): add minimal MV3 extension shell"
```

---

### Task 7: Test fixtures

**Files:**

- Create: `tests/pages/basic.html`
- Create: `tests/pages/long-page.html`
- Create: `tests/pages/sticky-header.html`
- Create: `tests/pages/fixed-elements.html`
- Create: `tests/pages/lazy-images.html`
- Create: `tests/pages/nested-scroll.html`
- Create: `tests/pages/fractional-dpr.html`
- Create: `tests/pages/dynamic-content.html`
- Create: `tests/pages/huge-page.html`
- Create: `tests/pages/markdown-content.html`

**Interfaces:**

- Consumes: nothing.

- Produces: static HTML fixtures that P1/P2/P3 browser tests (Playwright) will load by relative path `tests/pages/<name>.html`.

- [ ] **Step 1: Write `tests/pages/basic.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Basic fixture</title></head>
<body>
  <h1>Basic page</h1>
  <p>A short page that fits in a single viewport. Used as the baseline
  for Capture Visible tests.</p>
</body>
</html>
```

- [ ] **Step 2: Write `tests/pages/long-page.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Long page fixture</title>
<style>
  section { height: 800px; border-bottom: 2px solid #333; box-sizing: border-box; padding: 16px; }
  section:nth-child(odd) { background: #f0f0f0; }
</style>
</head>
<body>
  <h1>Long page (10 sections x 800px = 8000px)</h1>
  <section id="s1">Section 1</section>
  <section id="s2">Section 2</section>
  <section id="s3">Section 3</section>
  <section id="s4">Section 4</section>
  <section id="s5">Section 5</section>
  <section id="s6">Section 6</section>
  <section id="s7">Section 7</section>
  <section id="s8">Section 8</section>
  <section id="s9">Section 9</section>
  <section id="s10">Section 10</section>
</body>
</html>
```

- [ ] **Step 3: Write `tests/pages/sticky-header.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Sticky header fixture</title>
<style>
  header { position: sticky; top: 0; background: #222; color: #fff; padding: 12px; z-index: 10; }
  main { padding: 16px; }
  .block { height: 600px; border-bottom: 1px solid #ccc; }
</style>
</head>
<body>
  <header id="sticky-header">Sticky Header — should appear once in full-page output</header>
  <main>
    <div class="block">Block 1</div>
    <div class="block">Block 2</div>
    <div class="block">Block 3</div>
    <div class="block">Block 4</div>
  </main>
</body>
</html>
```

- [ ] **Step 4: Write `tests/pages/fixed-elements.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixed elements fixture</title>
<style>
  .fixed-top { position: fixed; top: 0; left: 0; right: 0; background: #003; color: #fff; padding: 8px; z-index: 20; }
  .fixed-bottom { position: fixed; bottom: 0; left: 0; right: 0; background: #300; color: #fff; padding: 8px; z-index: 20; }
  main { padding: 60px 16px; }
  .block { height: 700px; border-bottom: 1px solid #ccc; }
</style>
</head>
<body>
  <div class="fixed-top" id="fixed-header">Fixed header</div>
  <main>
    <div class="block">Block 1</div>
    <div class="block">Block 2</div>
    <div class="block">Block 3</div>
  </main>
  <div class="fixed-bottom" id="fixed-footer">Fixed footer</div>
</body>
</html>
```

- [ ] **Step 5: Write `tests/pages/lazy-images.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Lazy images fixture</title>
<style>
  .spacer { height: 900px; }
  img { display: block; width: 200px; height: 150px; background: #ddd; }
</style>
</head>
<body>
  <h1>Lazy-loaded images fixture</h1>
  <div class="spacer"></div>
  <img id="lazy-1" loading="lazy" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='150'%3E%3Crect width='200' height='150' fill='%234477aa'/%3E%3C/svg%3E" alt="lazy 1" />
  <div class="spacer"></div>
  <img id="lazy-2" loading="lazy" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='150'%3E%3Crect width='200' height='150' fill='%23aa4477'/%3E%3C/svg%3E" alt="lazy 2" />
  <div class="spacer"></div>
</body>
</html>
```

- [ ] **Step 6: Write `tests/pages/nested-scroll.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Nested scroll fixture</title>
<style>
  .outer { height: 400px; overflow-y: auto; border: 2px solid #333; margin: 16px; }
  .inner-content { height: 1600px; padding: 8px; }
  .row { height: 200px; border-bottom: 1px dashed #999; }
</style>
</head>
<body>
  <h1>Nested scroll container fixture</h1>
  <div class="outer" id="scroll-container">
    <div class="inner-content">
      <div class="row">Row 1</div>
      <div class="row">Row 2</div>
      <div class="row">Row 3</div>
      <div class="row">Row 4</div>
      <div class="row">Row 5</div>
      <div class="row">Row 6</div>
      <div class="row">Row 7</div>
      <div class="row">Row 8</div>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 7: Write `tests/pages/fractional-dpr.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Fractional DPR fixture</title>
<style>
  .marker { width: 133.33px; height: 133.33px; background: repeating-linear-gradient(45deg, #f00, #f00 10px, #fff 10px, #fff 20px); }
  .block { height: 500px; }
</style>
</head>
<body>
  <h1>Fractional DPR fixture</h1>
  <p>Rendered at fractional device-pixel-ratios (1.25, 1.5, 1.75) this
  page's 133.33px markers exercise sub-pixel rounding in tile
  offsets/crops.</p>
  <div class="marker" id="marker-1"></div>
  <div class="block"></div>
  <div class="marker" id="marker-2"></div>
</body>
</html>
```

- [ ] **Step 8: Write `tests/pages/dynamic-content.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Dynamic content fixture</title></head>
<body>
  <h1>Dynamic content fixture</h1>
  <div id="dynamic-root">
    <p>Initial content.</p>
  </div>
  <script>
    // Deliberately mutates the DOM shortly after load to exercise
    // "DOM mutation during capture" handling in P2/P5 tests.
    setTimeout(() => {
      const root = document.getElementById('dynamic-root');
      const p = document.createElement('p');
      p.textContent = 'Content added after 300ms.';
      p.id = 'dynamic-added';
      root.appendChild(p);
    }, 300);
  </script>
</body>
</html>
```

- [ ] **Step 9: Write `tests/pages/huge-page.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Huge page fixture</title>
<style>
  body { margin: 0; }
  .stripe { height: 2000px; }
  .stripe:nth-child(odd) { background: #e8e8e8; }
  .stripe:nth-child(even) { background: #ffffff; }
</style>
</head>
<body>
  <!--
    25 stripes x 2000px = 50,000px tall. Used to simulate the
    "extremely tall page" and memory-limit test cases from the spec
    without requiring a real 100,000px+ page (P2 huge-page tests may
    generate a taller page programmatically instead of hand-writing
    one this large).
  -->
  <div class="stripe" id="stripe-1"></div><div class="stripe" id="stripe-2"></div>
  <div class="stripe" id="stripe-3"></div><div class="stripe" id="stripe-4"></div>
  <div class="stripe" id="stripe-5"></div><div class="stripe" id="stripe-6"></div>
  <div class="stripe" id="stripe-7"></div><div class="stripe" id="stripe-8"></div>
  <div class="stripe" id="stripe-9"></div><div class="stripe" id="stripe-10"></div>
  <div class="stripe" id="stripe-11"></div><div class="stripe" id="stripe-12"></div>
  <div class="stripe" id="stripe-13"></div><div class="stripe" id="stripe-14"></div>
  <div class="stripe" id="stripe-15"></div><div class="stripe" id="stripe-16"></div>
  <div class="stripe" id="stripe-17"></div><div class="stripe" id="stripe-18"></div>
  <div class="stripe" id="stripe-19"></div><div class="stripe" id="stripe-20"></div>
  <div class="stripe" id="stripe-21"></div><div class="stripe" id="stripe-22"></div>
  <div class="stripe" id="stripe-23"></div><div class="stripe" id="stripe-24"></div>
  <div class="stripe" id="stripe-25"></div>
</body>
</html>
```

- [ ] **Step 10: Write `tests/pages/markdown-content.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Markdown content fixture</title></head>
<body>
  <article>
    <h1>Markdown export fixture</h1>
    <p>This page exercises the <strong>DOM-to-Markdown</strong> AST
    extraction and writer: <em>emphasis</em>, a
    <a href="https://example.com">safe link</a>, and a
    <a href="javascript:alert(1)">dangerous link</a> that must be
    sanitized.</p>
    <h2>A list</h2>
    <ul>
      <li>First item</li>
      <li>Second item</li>
    </ul>
    <h2>A table</h2>
    <table>
      <tr><th>Name</th><th>Value</th></tr>
      <tr><td>Alpha</td><td>1</td></tr>
      <tr><td>Beta</td><td>2</td></tr>
    </table>
    <h2>Code</h2>
    <pre><code class="language-rust">fn main() { println!("hi"); }</code></pre>
    <blockquote>A quoted paragraph.</blockquote>
  </article>
</body>
</html>
```

- [ ] **Step 11: Commit**

```bash
git add tests/pages
git commit -m "test: add browser fixture pages for capture and markdown testing"
```

---

### Task 8: xtask build entrypoint

**Files:**

- Create: `xtask/Cargo.toml`
- Create: `xtask/src/main.rs`

**Interfaces:**

- Consumes: nothing from other crates at compile time (shells out via `std::process::Command`).

- Produces: `cargo xtask build` and `cargo xtask test` CLI subcommands, invoked as documented in `README.md`/`CONTRIBUTING.md`.

- [ ] **Step 1: Write `xtask/Cargo.toml`**

```toml
[package]
name = "xtask"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true
repository.workspace = true
description = "Build automation entrypoint for FullScreenShot (cargo xtask build|test)"

[dependencies]
```

- [ ] **Step 2: Write `xtask/src/main.rs`**

```rust
// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use std::env;
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let task = env::args().nth(1).unwrap_or_default();
    let result = match task.as_str() {
        "build" => build(),
        "test" => test(),
        other => {
            eprintln!("unknown xtask '{other}'. Available: build, test");
            return ExitCode::FAILURE;
        }
    };

    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("xtask failed to run: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(cmd: &str, args: &[&str]) -> std::io::Result<bool> {
    println!("+ {cmd} {}", args.join(" "));
    let status = Command::new(cmd).args(args).status()?;
    Ok(status.success())
}

fn build() -> std::io::Result<bool> {
    let ok_workspace = run("cargo", &["build", "--workspace"])?;
    let ok_wasm = run(
        "cargo",
        &["build", "-p", "screenshot-wasm", "--target", "wasm32-unknown-unknown"],
    )?;
    Ok(ok_workspace && ok_wasm)
}

fn test() -> std::io::Result<bool> {
    let ok_fmt = run("cargo", &["fmt", "--check"])?;
    let ok_clippy = run(
        "cargo",
        &[
            "clippy",
            "--workspace",
            "--all-targets",
            "--all-features",
            "--",
            "-D",
            "warnings",
        ],
    )?;
    let ok_tests = run("cargo", &["test", "--workspace"])?;
    Ok(ok_fmt && ok_clippy && ok_tests)
}
```

- [ ] **Step 3: Run `cargo xtask build`**

Expected: succeeds, builds the whole workspace plus the wasm target.

- [ ] **Step 4: Run `cargo xtask test`**

Expected: `fmt --check`, `clippy -D warnings`, and `test --workspace` all succeed.

- [ ] **Step 5: Commit**

```bash
git add xtask
git commit -m "chore: add cargo xtask build/test entrypoint"
```

---

### Task 9: CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: nothing (runs the same commands defined in Task 8's `xtask` and Task 6's extension typecheck).

- Produces: a GitHub Actions workflow triggered on push/PR to `main`.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
          components: rustfmt, clippy
      - name: Format check
        run: cargo fmt --check
      - name: Clippy
        run: cargo clippy --workspace --all-targets --all-features -- -D warnings
      - name: Test
        run: cargo test --workspace
      - name: Build workspace
        run: cargo build --workspace
      - name: Build wasm target
        run: cargo build -p screenshot-wasm --target wasm32-unknown-unknown

  extension:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: extension
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install
      - run: npm run typecheck
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/ci.yml'))" || node -e "require('js-yaml') ? null : null"`

If `python3`/`yaml` module or an equivalent local YAML validator isn't available, instead run: `cat .github/workflows/ci.yml` and manually verify indentation/structure by eye (2-space consistent indentation, no tabs) since there is no GitHub Actions runner available locally to execute it directly.

Expected: no parse errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add fmt, clippy, test, build and typecheck workflow"
```

---

### Task 10: P0 exit-gate verification

**Files:**

- None created; this task only runs verification commands and records results in `docs/superpowers/specs/2026-09-17-p0-foundation-design.md`'s history table.

**Interfaces:**

- Consumes: everything from Tasks 1-9.

- Produces: a verified PASS/FAIL record for the P0 gate defined in the spec.

- [ ] **Step 1: Run the full gate**

```bash
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo build --workspace
cargo build -p screenshot-wasm --target wasm32-unknown-unknown
(cd extension && npm run typecheck)
```

Record the exact pass/fail and test counts from the output — do not
paraphrase as "tests passed."

- [ ] **Step 2: Re-run the consistency grep from Task 4 Step 12**

Confirm it still reports no mismatches after all subsequent commits.

- [ ] **Step 3: Update the spec's history table**

Edit `docs/superpowers/specs/2026-09-17-p0-foundation-design.md`, replacing
the `(pendiente, ...)` row in the Historial table with the actual short
SHAs from `git log --oneline` for every commit made in Tasks 1-9, per
this project's global spec-sync rule.

- [ ] **Step 4: Commit the spec update**

```bash
git add docs/superpowers/specs/2026-09-17-p0-foundation-design.md
git commit -m "docs(spec): record P0 implementation commits in spec history"
```

- [ ] **Step 5: Report final `git status` and `git log --oneline` to confirm a clean tree and full commit history**

This is the evidence used in the final report to the user — do not
declare the P0 gate PASS without pasting real command output.
