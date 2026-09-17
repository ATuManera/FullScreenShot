// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use std::io::Write;

use screenshot_core::capture_plan::CapturePlan;
use screenshot_core::compositor::{compose_streaming, expected_output_height, RowSink, TileImage};
use screenshot_core::CoreError;

struct PngStreamRowSink<'a, W: Write> {
    inner: png::StreamWriter<'a, W>,
}

impl<'a, W: Write> RowSink for PngStreamRowSink<'a, W> {
    fn write_row(&mut self, row: &[u8]) -> Result<(), CoreError> {
        self.inner
            .write_all(row)
            .map_err(|e| CoreError::Overflow(e.to_string()))
    }
}

/// Encodes a PNG by streaming rows produced by `write_rows` directly into
/// the PNG writer, one row at a time — the process never holds a full
/// intermediate RGBA bitmap the size of the output image.
pub fn encode_streaming<F>(width: u32, height: u32, write_rows: F) -> Result<Vec<u8>, CoreError>
where
    F: FnOnce(&mut dyn RowSink) -> Result<(), CoreError>,
{
    if width == 0 || height == 0 {
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
        let stream_writer = writer
            .stream_writer()
            .map_err(|e| CoreError::Overflow(e.to_string()))?;
        let mut sink = PngStreamRowSink {
            inner: stream_writer,
        };
        write_rows(&mut sink)?;
        sink.inner
            .finish()
            .map_err(|e| CoreError::Overflow(e.to_string()))?;
    }
    Ok(buf)
}

/// Composes `tiles` per `plan`/`dpr` (see `screenshot_core::compositor`)
/// and streams the result straight into a PNG, without ever materializing
/// the full stitched RGBA bitmap.
pub fn compose_full_page_png(
    plan: &CapturePlan,
    dpr: f64,
    tiles: &[TileImage<'_>],
) -> Result<Vec<u8>, CoreError> {
    let height = expected_output_height(plan, dpr)?;
    let width = tiles
        .first()
        .map(|t| t.meta.width)
        .ok_or(CoreError::InvalidDimensions {
            width: 0,
            height: 0,
        })?;

    encode_streaming(width, height, |sink| {
        compose_streaming(plan, dpr, tiles, sink).map(|_| ())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use screenshot_core::compositor::TileImageMeta;
    use screenshot_core::geometry::Size;
    use screenshot_core::tile::TileId;

    fn solid_tile(id: u64, width: u32, height: u32, color: [u8; 4]) -> (TileImageMeta, Vec<u8>) {
        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..(width * height) {
            rgba.extend_from_slice(&color);
        }
        (
            TileImageMeta {
                tile_id: TileId(id),
                width,
                height,
            },
            rgba,
        )
    }

    #[test]
    fn compose_full_page_png_produces_a_valid_png_with_correct_dimensions() {
        let viewport = Size {
            width: 4.0,
            height: 3.0,
        };
        let plan = CapturePlan::from_offsets(&[0.0, 2.0], viewport);
        let (meta_a, rgba_a) = solid_tile(0, 4, 3, [10, 20, 30, 255]);
        let (meta_b, rgba_b) = solid_tile(1, 4, 3, [40, 50, 60, 255]);
        let tiles = [
            TileImage {
                meta: meta_a,
                rgba: &rgba_a,
            },
            TileImage {
                meta: meta_b,
                rgba: &rgba_b,
            },
        ];

        let png_bytes = compose_full_page_png(&plan, 1.0, &tiles).unwrap();

        assert_eq!(
            &png_bytes[0..8],
            &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
        );

        let decoder = png::Decoder::new(png_bytes.as_slice());
        let mut reader = decoder.read_info().unwrap();
        let info = reader.info();
        assert_eq!(info.width, 4);
        assert_eq!(info.height, 5); // content height = 2 (offset) + 3 (viewport) = 5
        let mut buf = vec![0u8; reader.output_buffer_size()];
        reader.next_frame(&mut buf).unwrap();
        // First band (tile A) contributes rows [0,2), second (tile B) rows [0,3) of its own image.
        assert_eq!(&buf[0..4], &[10, 20, 30, 255]);
        assert_eq!(&buf[buf.len() - 4..], &[40, 50, 60, 255]);
    }

    #[test]
    fn encode_streaming_rejects_zero_dimensions() {
        assert!(encode_streaming(0, 10, |_| Ok(())).is_err());
        assert!(encode_streaming(10, 0, |_| Ok(())).is_err());
    }

    #[test]
    fn compose_full_page_png_rejects_empty_tiles() {
        let viewport = Size {
            width: 4.0,
            height: 3.0,
        };
        let plan = CapturePlan::from_offsets(&[0.0], viewport);
        let tiles: [TileImage<'_>; 0] = [];
        assert!(compose_full_page_png(&plan, 1.0, &tiles).is_err());
    }
}
