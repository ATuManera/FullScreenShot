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
    if viewport_height <= 0.0
        || content_height < 0.0
        || !viewport_height.is_finite()
        || !content_height.is_finite()
    {
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
