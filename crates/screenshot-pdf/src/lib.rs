// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

pub mod paginator;
pub mod pdf;

pub use paginator::paginate;
pub use pdf::{compose_full_page_pdf, generate_pdf_from_rgb, Orientation, PageSize};
