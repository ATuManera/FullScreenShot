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
        let pages = paginate(
            500.0,
            PageSize::Auto(Size {
                width: 800.0,
                height: 1000.0,
            }),
        )
        .unwrap();
        assert_eq!(pages, vec![(0.0, 500.0)]);
    }

    #[test]
    fn splits_into_multiple_non_overlapping_pages() {
        let page = PageSize::Auto(Size {
            width: 800.0,
            height: 1000.0,
        });
        let pages = paginate(2500.0, page).unwrap();
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
