// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use screenshot_core::CoreError;

mod stream;

pub use stream::{compose_full_page_png, encode_streaming};

pub fn encode_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, CoreError> {
    if width == 0 || height == 0 {
        return Err(CoreError::InvalidDimensions { width, height });
    }
    let expected_len = (width as usize) * (height as usize) * 4;
    if rgba.len() != expected_len {
        return Err(CoreError::InvalidDimensions { width, height });
    }

    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| CoreError::Overflow(e.to_string()))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| CoreError::Overflow(e.to_string()))?;
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_a_single_pixel_png_with_valid_signature() {
        let rgba = [255u8, 0, 0, 255];
        let png_bytes = encode_rgba(1, 1, &rgba).unwrap();
        assert_eq!(
            &png_bytes[0..8],
            &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
        );
    }

    #[test]
    fn rejects_mismatched_buffer_length() {
        let rgba = [255u8, 0, 0]; // not a multiple of 4
        assert!(encode_rgba(1, 1, &rgba).is_err());
    }

    #[test]
    fn rejects_zero_dimensions() {
        assert!(encode_rgba(0, 10, &[]).is_err());
    }
}
