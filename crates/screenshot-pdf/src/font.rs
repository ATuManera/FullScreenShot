// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

//! The font the invisible text layer is written in.
//!
//! The text over a FullScreenShot capture is never drawn — the screenshot is
//! the visible truth — so glyph *shapes* are worthless here and glyph
//! *metrics* are everything: they decide where a reader's selection highlight
//! lands and how wide a found word appears. That inverts the usual trade-off,
//! and it is why this module ships a **glyphless** font: a single blank glyph
//! that every character maps onto, with the run's real width supplied per
//! fragment by horizontal scaling. It is the same shape of solution scanned-
//! PDF text layers have used for years, for the same reason.
//!
//! Three consequences follow, all of them wanted:
//!
//! * **Full Unicode, not a codepage.** A `Type0`/`Identity-H` font addressed
//!   by two-byte codes, with a `/ToUnicode` map from code to character, can
//!   carry anything a DOM can hold — Spanish accents and `ñ` certainly, but
//!   also Greek, Cyrillic, CJK and emoji. Picking a base-14 font like
//!   Helvetica instead would have silently truncated the text layer to
//!   Windows-1252.
//! * **No third-party font file, and nothing to download.** The ~1 KB
//!   TrueType below is generated here, byte by byte, so there is no font
//!   licence to honour, no binary blob in the repository, and nothing fetched
//!   at runtime.
//! * **Predictable metrics.** Every glyph is exactly `GLYPH_ADVANCE_UNITS`
//!   wide, so the scale factor that makes a run match the width the DOM
//!   measured is arithmetic rather than a metrics table lookup.

use std::collections::HashMap;

/// Font design units per em. 1000 is the value PDF text-space arithmetic
/// assumes, which keeps the width calculation free of a conversion factor.
pub const FONT_UNITS_PER_EM: u16 = 1000;
/// Every glyph's advance, in design units — half an em.
pub const GLYPH_ADVANCE_UNITS: u16 = 500;
/// The same advance as a fraction of the font size.
pub const GLYPH_ADVANCE_EM: f64 = GLYPH_ADVANCE_UNITS as f64 / FONT_UNITS_PER_EM as f64;

/// Two-byte codes, so this is all a `Type0` font can address.
const MAX_CODES: usize = u16::MAX as usize;

fn push_u16(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_be_bytes());
}

fn push_i16(buf: &mut Vec<u8>, v: i16) {
    buf.extend_from_slice(&v.to_be_bytes());
}

fn push_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_be_bytes());
}

/// TrueType's table checksum: the sum of the table's big-endian `u32` words,
/// over the data zero-padded to a multiple of four, wrapping.
fn table_checksum(data: &[u8]) -> u32 {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i < data.len() {
        let mut word = [0u8; 4];
        let take = (data.len() - i).min(4);
        word[..take].copy_from_slice(&data[i..i + take]);
        sum = sum.wrapping_add(u32::from_be_bytes(word));
        i += 4;
    }
    sum
}

fn head_table() -> Vec<u8> {
    let mut t = Vec::with_capacity(54);
    push_u32(&mut t, 0x0001_0000); // version 1.0
    push_u32(&mut t, 0x0001_0000); // fontRevision 1.0
    push_u32(&mut t, 0); // checkSumAdjustment, patched once the file exists
    push_u32(&mut t, 0x5F0F_3CF5); // magicNumber
    push_u16(&mut t, 0x0003); // flags: baseline at y=0, lsb at x=0
    push_u16(&mut t, FONT_UNITS_PER_EM);
    t.extend_from_slice(&[0u8; 8]); // created
    t.extend_from_slice(&[0u8; 8]); // modified
    push_i16(&mut t, 0); // xMin
    push_i16(&mut t, 0); // yMin
    push_i16(&mut t, 0); // xMax
    push_i16(&mut t, 0); // yMax
    push_u16(&mut t, 0); // macStyle
    push_u16(&mut t, 8); // lowestRecPPEM
    push_i16(&mut t, 2); // fontDirectionHint
    push_i16(&mut t, 0); // indexToLocFormat: short
    push_i16(&mut t, 0); // glyphDataFormat
    t
}

fn hhea_table() -> Vec<u8> {
    let mut t = Vec::with_capacity(36);
    push_u32(&mut t, 0x0001_0000);
    push_i16(&mut t, 800); // ascender
    push_i16(&mut t, -200); // descender
    push_i16(&mut t, 0); // lineGap
    push_u16(&mut t, GLYPH_ADVANCE_UNITS); // advanceWidthMax
    push_i16(&mut t, 0); // minLeftSideBearing
    push_i16(&mut t, 0); // minRightSideBearing
    push_i16(&mut t, 0); // xMaxExtent
    push_i16(&mut t, 1); // caretSlopeRise
    push_i16(&mut t, 0); // caretSlopeRun
    push_i16(&mut t, 0); // caretOffset
    t.extend_from_slice(&[0u8; 8]); // four reserved int16
    push_i16(&mut t, 0); // metricDataFormat
    push_u16(&mut t, 1); // numberOfHMetrics
    t
}

fn maxp_table() -> Vec<u8> {
    let mut t = Vec::with_capacity(32);
    push_u32(&mut t, 0x0001_0000);
    push_u16(&mut t, 1); // numGlyphs
    push_u16(&mut t, 0); // maxPoints
    push_u16(&mut t, 0); // maxContours
    push_u16(&mut t, 0); // maxCompositePoints
    push_u16(&mut t, 0); // maxCompositeContours
    push_u16(&mut t, 2); // maxZones
    for _ in 0..8 {
        push_u16(&mut t, 0);
    }
    t
}

fn hmtx_table() -> Vec<u8> {
    let mut t = Vec::with_capacity(4);
    push_u16(&mut t, GLYPH_ADVANCE_UNITS); // advanceWidth[0]
    push_i16(&mut t, 0); // leftSideBearing[0]
    t
}

/// One glyph description with no contours — a blank of the declared advance.
fn glyf_table() -> Vec<u8> {
    let mut t = Vec::with_capacity(12);
    push_i16(&mut t, 0); // numberOfContours: 0 = empty outline
    push_i16(&mut t, 0); // xMin
    push_i16(&mut t, 0); // yMin
    push_i16(&mut t, 0); // xMax
    push_i16(&mut t, 0); // yMax
    push_u16(&mut t, 0); // pad to a 4-byte boundary
    t
}

/// Short-format offsets: glyph 0 spans the whole (12-byte) `glyf` table.
fn loca_table() -> Vec<u8> {
    let mut t = Vec::with_capacity(4);
    push_u16(&mut t, 0);
    push_u16(&mut t, 6); // short loca stores offset / 2
    t
}

/// A format-4 subtable covering nothing but the required final segment. The
/// PDF addresses glyphs through `CIDToGIDMap`, never through `cmap`, but a
/// TrueType file without one is malformed.
fn cmap_table() -> Vec<u8> {
    let mut sub = Vec::with_capacity(24);
    push_u16(&mut sub, 4); // format
    push_u16(&mut sub, 24); // length
    push_u16(&mut sub, 0); // language
    push_u16(&mut sub, 2); // segCountX2 (one segment)
    push_u16(&mut sub, 2); // searchRange
    push_u16(&mut sub, 0); // entrySelector
    push_u16(&mut sub, 0); // rangeShift
    push_u16(&mut sub, 0xFFFF); // endCode[0]
    push_u16(&mut sub, 0); // reservedPad
    push_u16(&mut sub, 0xFFFF); // startCode[0]
    push_u16(&mut sub, 1); // idDelta[0]
    push_u16(&mut sub, 0); // idRangeOffset[0]

    let mut t = Vec::with_capacity(12 + sub.len());
    push_u16(&mut t, 0); // version
    push_u16(&mut t, 1); // numTables
    push_u16(&mut t, 3); // platformID: Windows
    push_u16(&mut t, 1); // encodingID: Unicode BMP
    push_u32(&mut t, 12); // offset to the subtable
    t.extend_from_slice(&sub);
    t
}

/// A `name` table with no records. Legal, and nothing here has a name worth
/// putting in front of a user.
fn name_table() -> Vec<u8> {
    let mut t = Vec::with_capacity(6);
    push_u16(&mut t, 0); // format
    push_u16(&mut t, 0); // count
    push_u16(&mut t, 6); // stringOffset
    t
}

/// Version 3.0: glyph names are not stored, which is exactly right for a font
/// with one nameless blank glyph.
fn post_table() -> Vec<u8> {
    let mut t = Vec::with_capacity(32);
    push_u32(&mut t, 0x0003_0000);
    push_u32(&mut t, 0); // italicAngle
    push_i16(&mut t, -100); // underlinePosition
    push_i16(&mut t, 50); // underlineThickness
    push_u32(&mut t, 1); // isFixedPitch
    for _ in 0..4 {
        push_u32(&mut t, 0);
    }
    t
}

fn os2_table() -> Vec<u8> {
    let mut t = Vec::with_capacity(96);
    push_u16(&mut t, 4); // version
    push_i16(&mut t, GLYPH_ADVANCE_UNITS as i16); // xAvgCharWidth
    push_u16(&mut t, 400); // usWeightClass
    push_u16(&mut t, 5); // usWidthClass
    push_u16(&mut t, 0); // fsType: installable
    push_i16(&mut t, 650); // ySubscriptXSize
    push_i16(&mut t, 600); // ySubscriptYSize
    push_i16(&mut t, 0); // ySubscriptXOffset
    push_i16(&mut t, 75); // ySubscriptYOffset
    push_i16(&mut t, 650); // ySuperscriptXSize
    push_i16(&mut t, 600); // ySuperscriptYSize
    push_i16(&mut t, 0); // ySuperscriptXOffset
    push_i16(&mut t, 350); // ySuperscriptYOffset
    push_i16(&mut t, 50); // yStrikeoutSize
    push_i16(&mut t, 250); // yStrikeoutPosition
    push_i16(&mut t, 0); // sFamilyClass
    t.extend_from_slice(&[0u8; 10]); // panose
    for _ in 0..4 {
        push_u32(&mut t, 0); // ulUnicodeRange1..4
    }
    t.extend_from_slice(b"FSS\x00"); // achVendID
    push_u16(&mut t, 0x0040); // fsSelection: regular
    push_u16(&mut t, 0); // usFirstCharIndex
    push_u16(&mut t, 0xFFFF); // usLastCharIndex
    push_i16(&mut t, 800); // sTypoAscender
    push_i16(&mut t, -200); // sTypoDescender
    push_i16(&mut t, 0); // sTypoLineGap
    push_u16(&mut t, 800); // usWinAscent
    push_u16(&mut t, 200); // usWinDescent
    push_u32(&mut t, 1); // ulCodePageRange1: Latin 1
    push_u32(&mut t, 0); // ulCodePageRange2
    push_i16(&mut t, 500); // sxHeight
    push_i16(&mut t, 700); // sCapHeight
    push_u16(&mut t, 0); // usDefaultChar
    push_u16(&mut t, 0); // usBreakChar
    push_u16(&mut t, 1); // usMaxContext
    t
}

/// Builds the glyphless TrueType font, ready for `/FontFile2`.
///
/// Around a kilobyte, deterministic, and dependency-free. Should a reader
/// somehow refuse it, nothing visible breaks: the text is drawn in rendering
/// mode 3, and search and copy read `/ToUnicode`, not the glyphs.
pub fn glyphless_truetype() -> Vec<u8> {
    // Sorted by tag, as the table directory requires.
    let tables: Vec<(&[u8; 4], Vec<u8>)> = vec![
        (b"OS/2", os2_table()),
        (b"cmap", cmap_table()),
        (b"glyf", glyf_table()),
        (b"head", head_table()),
        (b"hhea", hhea_table()),
        (b"hmtx", hmtx_table()),
        (b"loca", loca_table()),
        (b"maxp", maxp_table()),
        (b"name", name_table()),
        (b"post", post_table()),
    ];

    let num_tables = tables.len() as u16;
    // `searchRange` is 16 * 2^floor(log2(numTables)).
    let entry_selector = (u16::BITS - 1 - num_tables.leading_zeros()) as u16;
    let search_range = 16u16 << entry_selector;
    let range_shift = num_tables * 16 - search_range;

    let mut font = Vec::new();
    push_u32(&mut font, 0x0001_0000); // sfntVersion: TrueType outlines
    push_u16(&mut font, num_tables);
    push_u16(&mut font, search_range);
    push_u16(&mut font, entry_selector);
    push_u16(&mut font, range_shift);

    let directory_len = 12 + tables.len() * 16;
    let mut offset = directory_len as u32;
    let mut head_offset = 0usize;
    for (tag, data) in &tables {
        font.extend_from_slice(*tag);
        push_u32(&mut font, table_checksum(data));
        push_u32(&mut font, offset);
        push_u32(&mut font, data.len() as u32);
        if *tag == b"head" {
            head_offset = offset as usize;
        }
        offset += (data.len() as u32).next_multiple_of(4);
    }
    for (_, data) in &tables {
        font.extend_from_slice(data);
        while font.len() % 4 != 0 {
            font.push(0);
        }
    }

    // `head.checkSumAdjustment` is defined against the finished file, so it
    // can only be written now.
    let adjustment = 0xB1B0_AFBAu32.wrapping_sub(table_checksum(&font));
    font[head_offset + 8..head_offset + 12].copy_from_slice(&adjustment.to_be_bytes());
    font
}

/// Assigns a two-byte code to every distinct character the document uses, and
/// encodes runs into those codes.
///
/// The codes are dense and document-local rather than being the characters'
/// own values, which keeps `/ToUnicode` to one entry per distinct character —
/// a few hundred for a real page — instead of a map over the whole codespace.
#[derive(Debug, Default)]
pub struct CodeAssignment {
    codes: HashMap<char, u16>,
    /// Code `n` describes `order[n - 1]`; code 0 is left as `.notdef`.
    order: Vec<char>,
}

impl CodeAssignment {
    pub fn new() -> CodeAssignment {
        CodeAssignment::default()
    }

    fn code_for(&mut self, c: char) -> Option<u16> {
        if let Some(&code) = self.codes.get(&c) {
            return Some(code);
        }
        if self.order.len() >= MAX_CODES {
            return None;
        }
        let code = (self.order.len() + 1) as u16;
        self.order.push(c);
        self.codes.insert(c, code);
        Some(code)
    }

    /// Encodes `text` as the big-endian two-byte codes an `Identity-H` string
    /// is made of, and reports how many characters it placed — the count the
    /// width calculation needs, which is not `text.len()` for any text with an
    /// accent in it.
    pub fn encode(&mut self, text: &str) -> (Vec<u8>, usize) {
        let mut out = Vec::with_capacity(text.len() * 2);
        let mut placed = 0usize;
        for c in text.chars() {
            if let Some(code) = self.code_for(c) {
                out.extend_from_slice(&code.to_be_bytes());
                placed += 1;
            }
        }
        (out, placed)
    }

    /// Every (code, character) pair assigned so far, in code order.
    pub fn pairs(&self) -> impl Iterator<Item = (u16, char)> + '_ {
        self.order
            .iter()
            .enumerate()
            .map(|(i, &c)| ((i + 1) as u16, c))
    }

    /// The highest code in use, which is how many entries `CIDToGIDMap` needs.
    pub fn max_code(&self) -> u16 {
        self.order.len() as u16
    }

    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }
}

/// `CIDToGIDMap` as a stream: two bytes per CID, every one of them glyph 0.
///
/// All zeros, so it costs a couple of hundred bytes before compression and
/// almost nothing after — and it is what lets any character map onto the one
/// blank glyph the font actually contains.
pub fn cid_to_gid_map(max_code: u16) -> Vec<u8> {
    vec![0u8; (max_code as usize + 1) * 2]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table<'a>(font: &'a [u8], tag: &[u8; 4]) -> Option<&'a [u8]> {
        let num_tables = u16::from_be_bytes([font[4], font[5]]) as usize;
        for i in 0..num_tables {
            let rec = 12 + i * 16;
            if &font[rec..rec + 4] == tag {
                let offset =
                    u32::from_be_bytes(font[rec + 8..rec + 12].try_into().unwrap()) as usize;
                let len = u32::from_be_bytes(font[rec + 12..rec + 16].try_into().unwrap()) as usize;
                return Some(&font[offset..offset + len]);
            }
        }
        None
    }

    #[test]
    fn font_is_a_well_formed_truetype_file() {
        let font = glyphless_truetype();
        assert_eq!(&font[0..4], &[0x00, 0x01, 0x00, 0x00], "sfnt version");
        assert_eq!(u16::from_be_bytes([font[4], font[5]]), 10, "table count");
        for tag in [
            b"OS/2", b"cmap", b"glyf", b"head", b"hhea", b"hmtx", b"loca", b"maxp", b"name",
            b"post",
        ] {
            assert!(table(&font, tag).is_some(), "missing table {:?}", tag);
        }
        assert_eq!(font.len() % 4, 0, "file must end on a 4-byte boundary");
    }

    #[test]
    fn table_records_are_sorted_by_tag_as_the_format_requires() {
        let font = glyphless_truetype();
        let num_tables = u16::from_be_bytes([font[4], font[5]]) as usize;
        let tags: Vec<&[u8]> = (0..num_tables)
            .map(|i| &font[12 + i * 16..12 + i * 16 + 4])
            .collect();
        let mut sorted = tags.clone();
        sorted.sort_unstable();
        assert_eq!(tags, sorted);
    }

    #[test]
    fn head_declares_the_metrics_the_width_calculation_assumes() {
        let font = glyphless_truetype();
        let head = table(&font, b"head").unwrap();
        assert_eq!(
            u32::from_be_bytes(head[12..16].try_into().unwrap()),
            0x5F0F_3CF5,
            "magic number"
        );
        assert_eq!(u16::from_be_bytes([head[18], head[19]]), FONT_UNITS_PER_EM);
        // indexToLocFormat must agree with the short `loca` written above.
        assert_eq!(i16::from_be_bytes([head[50], head[51]]), 0);
    }

    #[test]
    fn every_glyph_advance_is_the_one_the_scale_factor_assumes() {
        let font = glyphless_truetype();
        let hmtx = table(&font, b"hmtx").unwrap();
        assert_eq!(u16::from_be_bytes([hmtx[0], hmtx[1]]), GLYPH_ADVANCE_UNITS);
        let hhea = table(&font, b"hhea").unwrap();
        assert_eq!(
            u16::from_be_bytes([hhea[34], hhea[35]]),
            1,
            "numberOfHMetrics must cover the single glyph"
        );
    }

    #[test]
    fn the_only_glyph_is_blank() {
        let font = glyphless_truetype();
        let glyf = table(&font, b"glyf").unwrap();
        assert_eq!(
            i16::from_be_bytes([glyf[0], glyf[1]]),
            0,
            "numberOfContours must be zero — the glyph draws nothing"
        );
        let maxp = table(&font, b"maxp").unwrap();
        assert_eq!(u16::from_be_bytes([maxp[4], maxp[5]]), 1, "numGlyphs");
    }

    #[test]
    fn the_checksum_adjustment_is_computed_over_the_finished_file() {
        let mut font = glyphless_truetype();
        let head_rec = (0..10)
            .map(|i| 12 + i * 16)
            .find(|&r| &font[r..r + 4] == b"head")
            .unwrap();
        let head_offset =
            u32::from_be_bytes(font[head_rec + 8..head_rec + 12].try_into().unwrap()) as usize;
        let stored =
            u32::from_be_bytes(font[head_offset + 8..head_offset + 12].try_into().unwrap());
        font[head_offset + 8..head_offset + 12].copy_from_slice(&0u32.to_be_bytes());
        assert_eq!(stored, 0xB1B0_AFBAu32.wrapping_sub(table_checksum(&font)));
    }

    #[test]
    fn codes_are_assigned_once_per_distinct_character() {
        let mut codes = CodeAssignment::new();
        let (a, n) = codes.encode("aba");
        assert_eq!(n, 3);
        assert_eq!(a, vec![0, 1, 0, 2, 0, 1], "'a' keeps the code it was given");
        assert_eq!(codes.max_code(), 2);
    }

    #[test]
    fn codes_cover_accents_and_astral_characters_alike() {
        let mut codes = CodeAssignment::new();
        // Four characters, one of which is outside the BMP — six UTF-8 bytes
        // for the accented ones and four for the emoji, but one code each.
        let (bytes, placed) = codes.encode("ñÜ€🙂");
        assert_eq!(placed, 4);
        assert_eq!(
            bytes.len(),
            8,
            "two bytes per character, whatever its plane"
        );
        let chars: Vec<char> = codes.pairs().map(|(_, c)| c).collect();
        assert_eq!(chars, vec!['ñ', 'Ü', '€', '🙂']);
    }

    #[test]
    fn spanish_text_round_trips_through_the_code_table() {
        let mut codes = CodeAssignment::new();
        let source = "información auditoría Perú señal";
        let (bytes, _) = codes.encode(source);
        let table: HashMap<u16, char> = codes.pairs().collect();
        let (pairs, _) = bytes.as_chunks::<2>();
        let decoded: String = pairs
            .iter()
            .map(|c| table[&u16::from_be_bytes(*c)])
            .collect();
        assert_eq!(decoded, source);
    }

    #[test]
    fn cid_to_gid_map_sends_every_code_to_the_blank_glyph() {
        let map = cid_to_gid_map(3);
        assert_eq!(map, vec![0u8; 8]);
    }
}
