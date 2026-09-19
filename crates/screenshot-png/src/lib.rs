// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use screenshot_core::CoreError;

mod stream;

pub use stream::{compose_full_page_png, encode_streaming};

pub fn encode_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, CoreError> {
    // Shares the crate-wide dimension policy (zero, overflow and budget), so
    // a long capture is accepted here on the same terms as in the compositor
    // and a hostile one is refused on the same terms too.
    let expected_len = screenshot_core::validation::rgba_byte_len(width, height)?;
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

    #[test]
    fn encodes_a_very_tall_image_without_narrowing_its_height() {
        // The PNG writer takes u32 width/height; this proves a height far
        // past any 16-bit boundary survives into the header intact. Kept
        // narrow so the test costs 320KB rather than hundreds of megabytes.
        let width = 4u32;
        let height = 20_000u32;
        let rgba = vec![7u8; (width * height * 4) as usize];
        let png_bytes = encode_rgba(width, height, &rgba).unwrap();
        // IHDR width/height are big-endian u32 at bytes 16..24.
        let declared_width = u32::from_be_bytes(png_bytes[16..20].try_into().unwrap());
        let declared_height = u32::from_be_bytes(png_bytes[20..24].try_into().unwrap());
        assert_eq!(declared_width, width);
        assert_eq!(declared_height, height);
    }
}
