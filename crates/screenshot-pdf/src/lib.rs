// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

pub mod font;
pub mod paginator;
pub mod pdf;
pub mod text_layer;
pub mod transform;

pub use paginator::paginate;
pub use pdf::{
    compose_full_page_pdf, compose_hybrid_pdf, generate_hybrid_pdf, generate_pdf_from_rgb,
    PdfMetadata, TextLayerInput, TextLayerReport,
};
pub use text_layer::{LinkRect, TextFragment, TextLayer};
pub use transform::{Orientation, PageLayout, PageSize, PlacedRect, SourceMapping, SourceRect};
