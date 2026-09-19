// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum CoreError {
    /// Dimensions that cannot describe an image at all (zero, or a buffer
    /// whose length contradicts them).
    InvalidDimensions {
        width: u32,
        height: u32,
    },
    /// Dimensions that are well-formed but beyond what can be composed
    /// safely. Kept distinct from `InvalidDimensions` so the UI can offer a
    /// way forward instead of reporting a generic failure — and so a genuine
    /// internal inconsistency is never mistaken for a size limit, which is
    /// how a perfectly ordinary 1660x8484 full-page capture came to be
    /// reported as "invalid dimensions".
    TooLarge {
        width: u32,
        height: u32,
        max_pixels: u64,
    },
    Overflow(String),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::InvalidDimensions { width, height } => {
                write!(f, "invalid dimensions: {width}x{height}")
            }
            CoreError::TooLarge {
                width,
                height,
                max_pixels,
            } => write!(
                f,
                "capture is too large: {width}x{height} exceeds the {max_pixels}-pixel composition budget"
            ),
            CoreError::Overflow(msg) => write!(f, "overflow: {msg}"),
        }
    }
}

impl std::error::Error for CoreError {}
