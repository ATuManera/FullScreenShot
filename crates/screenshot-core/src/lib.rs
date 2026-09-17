// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

pub mod capture_plan;
pub mod compositor;
pub mod error;
pub mod geometry;
pub mod rate_limiter;
pub mod tile;
pub mod validation;

pub use error::CoreError;
pub use geometry::{DevicePixelRatio, Point, Rect, Size};
pub use rate_limiter::RateLimiter;
