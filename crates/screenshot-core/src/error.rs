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
