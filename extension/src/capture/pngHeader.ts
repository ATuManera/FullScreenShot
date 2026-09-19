// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Reads the dimensions a composed PNG actually declares.
 *
 * The capture pipeline used to report `round(content_height * dpr)` as the
 * result's size — a prediction made from CSS geometry. On a fractionally
 * scaled display that can be a pixel away from the image the compositor
 * really produced, which then reached the user as the wrong number on the
 * result page and in the stored metadata. The PNG header is the only thing
 * that knows for certain, and it costs four bytes each to read.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_WIDTH_OFFSET = 16;

export interface PngDimensions {
  width: number;
  height: number;
}

function readBigEndianU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) << 24 |
      (bytes[offset + 1] as number) << 16 |
      (bytes[offset + 2] as number) << 8 |
      (bytes[offset + 3] as number)) >>>
    0
  );
}

/** Returns the PNG's declared dimensions, or `null` if `bytes` is not a PNG. */
export function readPngDimensions(bytes: Uint8Array): PngDimensions | null {
  if (bytes.length < IHDR_WIDTH_OFFSET + 8) {
    return null;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return null;
    }
  }
  const width = readBigEndianU32(bytes, IHDR_WIDTH_OFFSET);
  const height = readBigEndianU32(bytes, IHDR_WIDTH_OFFSET + 4);
  if (width === 0 || height === 0) {
    return null;
  }
  return { width, height };
}
