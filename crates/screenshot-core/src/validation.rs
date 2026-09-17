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
