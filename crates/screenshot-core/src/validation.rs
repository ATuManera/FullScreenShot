// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use std::collections::HashSet;

use crate::capture_plan::CapturePlan;
use crate::error::CoreError;

/// Ceiling on a composite's pixel count.
///
/// FullScreenShot exists to produce long images, so this is deliberately not
/// a per-axis cap — an ordinary article on a fractionally-scaled display is
/// already 8000+ device rows tall, and an arbitrary height limit would reject
/// the product's main use case. What genuinely bounds a capture is memory.
///
/// Composition streams row by row and never materialises the stitched bitmap,
/// but the tiles it reads from are held whole: on the way in they exist once
/// as a JavaScript buffer and once more copied into WASM linear memory, so the
/// working set runs to roughly 2.5x the composite's RGBA size. At this budget
/// that is ~400MB of composite and ~1GB of working set — past anything a real
/// page produces (the largest capture seen in the field is 14 megapixels, a
/// seventh of this) and comfortably inside wasm32's 32-bit addressing, which
/// every byte count here must also respect.
///
/// It is a guard against absurd or hostile geometry, not a performance
/// promise: captures far below it are the normal case.
pub const MAX_COMPOSITE_PIXELS: u64 = 100_000_000;

/// Checks that an output image is describable and composable.
///
/// All arithmetic is done in `u64` and checked. That matters more than it
/// looks: this crate compiles to wasm32, where `usize` is 32 bits, so
/// `width * height * 4` computed in `usize` would wrap silently on a hostile
/// page and let a length check pass against a buffer that could never hold
/// the image.
pub fn validate_output_dimensions(width: u32, height: u32) -> Result<(), CoreError> {
    if width == 0 || height == 0 {
        return Err(CoreError::InvalidDimensions { width, height });
    }
    let too_large = || CoreError::TooLarge {
        width,
        height,
        max_pixels: MAX_COMPOSITE_PIXELS,
    };
    let pixels = (width as u64)
        .checked_mul(height as u64)
        .ok_or_else(too_large)?;
    let bytes = pixels.checked_mul(4).ok_or_else(too_large)?;
    if pixels > MAX_COMPOSITE_PIXELS || bytes > usize::MAX as u64 {
        return Err(too_large());
    }
    Ok(())
}

/// The byte length an RGBA buffer must have for these dimensions, or an error
/// if that length cannot be represented on this target.
pub fn rgba_byte_len(width: u32, height: u32) -> Result<usize, CoreError> {
    validate_output_dimensions(width, height)?;
    let bytes = (width as u64) * (height as u64) * 4;
    usize::try_from(bytes).map_err(|_| CoreError::TooLarge {
        width,
        height,
        max_pixels: MAX_COMPOSITE_PIXELS,
    })
}

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
            return Err(CoreError::Overflow(format!(
                "duplicate tile id: {:?}",
                tile.id
            )));
        }
        let key = (
            tile.scroll_offset.x.to_bits(),
            tile.scroll_offset.y.to_bits(),
        );
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
    fn accepts_the_long_full_page_capture_that_was_rejected_in_the_field() {
        // 1660x8484 on a fractionally-scaled display: an ordinary long page,
        // not an absurd one. Only the policy is exercised here — allocating
        // 56MB of RGBA to prove a bounds check would be a waste.
        assert!(validate_output_dimensions(1660, 8484).is_ok());
    }

    #[test]
    fn accepts_long_captures_well_past_the_field_failure() {
        assert!(validate_output_dimensions(1660, 7000).is_ok());
        assert!(validate_output_dimensions(1660, 10_000).is_ok());
        assert!(validate_output_dimensions(1660, 40_000).is_ok());
        assert!(validate_output_dimensions(3840, 25_000).is_ok());
    }

    #[test]
    fn rejects_dimensions_that_cannot_describe_an_image() {
        assert!(matches!(
            validate_output_dimensions(0, 0),
            Err(CoreError::InvalidDimensions { .. })
        ));
        assert!(matches!(
            validate_output_dimensions(1660, 0),
            Err(CoreError::InvalidDimensions { .. })
        ));
        assert!(matches!(
            validate_output_dimensions(0, 8484),
            Err(CoreError::InvalidDimensions { .. })
        ));
    }

    #[test]
    fn rejects_a_pixel_count_that_overflows_its_own_multiplication() {
        // u32::MAX squared is far beyond u64's reach only in bytes, so this
        // pins the checked arithmetic rather than the budget: both must hold.
        assert!(matches!(
            validate_output_dimensions(u32::MAX, u32::MAX),
            Err(CoreError::TooLarge { .. })
        ));
    }

    #[test]
    fn rejects_a_byte_count_beyond_what_the_target_can_address() {
        // 2^32 pixels is 16GB of RGBA: representable as a pixel count, not as
        // a wasm32 byte length. Caught by the budget before the byte maths
        // can wrap.
        assert!(matches!(
            validate_output_dimensions(65_536, 65_536),
            Err(CoreError::TooLarge { .. })
        ));
    }

    #[test]
    fn rejects_a_capture_beyond_the_documented_budget() {
        let over = MAX_COMPOSITE_PIXELS / 1000 + 1;
        assert!(matches!(
            validate_output_dimensions(1000, over as u32),
            Err(CoreError::TooLarge { .. })
        ));
        // And accepts the capture one pixel row below it, so the boundary is
        // where it says it is rather than approximately there.
        assert!(validate_output_dimensions(1000, (MAX_COMPOSITE_PIXELS / 1000) as u32).is_ok());
    }

    #[test]
    fn a_too_large_capture_says_so_instead_of_reading_like_a_malformed_one() {
        let err = validate_output_dimensions(65_536, 65_536).unwrap_err();
        let text = err.to_string();
        assert!(text.contains("too large"), "unexpected message: {text}");
        assert!(
            !text.contains("invalid dimensions"),
            "unexpected message: {text}"
        );
    }

    #[test]
    fn rgba_byte_len_is_exact_for_a_long_capture() {
        assert_eq!(rgba_byte_len(1660, 8484).unwrap(), 1660 * 8484 * 4);
    }

    #[test]
    fn rejects_empty_plan() {
        let plan = CapturePlan::from_offsets(
            &[],
            Size {
                width: 800.0,
                height: 600.0,
            },
        );
        assert!(validate_plan(&plan).is_err());
    }

    #[test]
    fn accepts_well_formed_plan() {
        let plan = CapturePlan::from_offsets(
            &[0.0, 500.0],
            Size {
                width: 800.0,
                height: 600.0,
            },
        );
        assert!(validate_plan(&plan).is_ok());
    }

    #[test]
    fn rejects_duplicate_scroll_offsets() {
        let mut plan = CapturePlan::from_offsets(
            &[0.0, 500.0],
            Size {
                width: 800.0,
                height: 600.0,
            },
        );
        plan.tiles[1].scroll_offset = plan.tiles[0].scroll_offset;
        assert!(validate_plan(&plan).is_err());
    }

    #[test]
    fn rejects_zero_size_crop() {
        let mut plan = CapturePlan::from_offsets(
            &[0.0],
            Size {
                width: 800.0,
                height: 600.0,
            },
        );
        plan.tiles[0].crop.size.width = 0.0;
        assert!(validate_plan(&plan).is_err());
    }
}
