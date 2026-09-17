// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use screenshot_core::CoreError;

/// Splits `content_height` into non-overlapping, gap-free (start, end)
/// ranges of at most `page_height` each (same unit as `content_height` —
/// callers decide whether that's CSS px, device px, or PDF points).
pub fn paginate(content_height: f64, page_height: f64) -> Result<Vec<(f64, f64)>, CoreError> {
    if content_height < 0.0
        || page_height <= 0.0
        || !content_height.is_finite()
        || !page_height.is_finite()
    {
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
        let pages = paginate(500.0, 1000.0).unwrap();
        assert_eq!(pages, vec![(0.0, 500.0)]);
    }

    #[test]
    fn splits_into_multiple_non_overlapping_pages() {
        let pages = paginate(2500.0, 1000.0).unwrap();
        assert_eq!(
            pages,
            vec![(0.0, 1000.0), (1000.0, 2000.0), (2000.0, 2500.0)]
        );
        for w in pages.windows(2) {
            assert_eq!(
                w[0].1, w[1].0,
                "pages must be contiguous with no gap or overlap"
            );
        }
    }

    #[test]
    fn different_page_heights_produce_different_page_counts() {
        let content = 3000.0;
        let short_pages = paginate(content, 1122.24).unwrap();
        let long_pages = paginate(content, 4000.0).unwrap();
        assert!(short_pages.len() > long_pages.len());
    }

    #[test]
    fn rejects_negative_content_height() {
        assert!(paginate(-1.0, 1000.0).is_err());
    }

    #[test]
    fn rejects_non_positive_page_height() {
        assert!(paginate(100.0, 0.0).is_err());
        assert!(paginate(100.0, -10.0).is_err());
    }

    #[test]
    fn zero_content_height_yields_one_empty_page() {
        assert_eq!(paginate(0.0, 1000.0).unwrap(), vec![(0.0, 0.0)]);
    }
}
