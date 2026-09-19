// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

//! Just enough of a PDF reader to answer the only questions these tests ask:
//! what text would a reader extract, which URIs are clickable, and how many
//! pages are there.
//!
//! Deliberately not a dependency. Pulling a full PDF parser in to check our
//! own output would be a heavyweight addition to the build for a handful of
//! assertions, and it would check the parser's tolerance as much as the
//! writer's correctness. What is here instead follows the same path a reader
//! does — `/ToUnicode` for the characters, the content stream for the order —
//! so a PDF that passes is one whose text really is reachable.

use std::collections::HashMap;
use std::io::Read;

use flate2::read::ZlibDecoder;

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Every `stream`/`endstream` payload in the file, raw.
pub fn streams(pdf: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(rel) = find(&pdf[i..], b"stream") {
        let at = i + rel;
        let mut start = at + b"stream".len();
        // "endstream" contains "stream"; skip those matches.
        if at >= 3 && &pdf[at - 3..at] == b"end" {
            i = start;
            continue;
        }
        while matches!(pdf.get(start), Some(b'\r') | Some(b'\n')) {
            start += 1;
        }
        let Some(rel_end) = find(&pdf[start..], b"endstream") else {
            break;
        };
        let mut end = start + rel_end;
        while end > start && matches!(pdf[end - 1], b'\r' | b'\n') {
            end -= 1;
        }
        out.push(pdf[start..end].to_vec());
        i = start + rel_end;
    }
    out
}

fn inflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    ZlibDecoder::new(data).read_to_end(&mut out).ok()?;
    Some(out)
}

fn is_content_stream(stream: &[u8]) -> bool {
    find(stream, b"/Im0 Do").is_some()
}

/// The `/ToUnicode` map, read the way a reader reads it: code → characters.
fn to_unicode_map(pdf: &[u8]) -> HashMap<u16, String> {
    let cmap = streams(pdf)
        .iter()
        .filter_map(|s| inflate(s))
        .find(|d| find(d, b"beginbfchar").is_some())
        .expect("a searchable PDF must carry a /ToUnicode map");
    let text = String::from_utf8_lossy(&cmap).into_owned();
    let mut map = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with('<') {
            continue;
        }
        let parts: Vec<&str> = line
            .split(['<', '>'])
            .filter(|p| !p.trim().is_empty())
            .collect();
        if parts.len() != 2 {
            continue;
        }
        let Ok(code) = u16::from_str_radix(parts[0].trim(), 16) else {
            continue;
        };
        let units: Vec<u16> = parts[1]
            .trim()
            .as_bytes()
            .chunks(4)
            .filter_map(|c| u16::from_str_radix(std::str::from_utf8(c).ok()?, 16).ok())
            .collect();
        if let Ok(value) = String::from_utf16(&units) {
            map.insert(code, value);
        }
    }
    map
}

/// Every string a `Tj` shows, decoded from PDF literal-string syntax.
fn shown_strings(stream: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < stream.len() {
        if stream[i] != b'(' {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        let mut depth = 1usize;
        let mut bytes = Vec::new();
        while j < stream.len() {
            match stream[j] {
                b'\\' => {
                    j += 1;
                    match stream.get(j) {
                        Some(b'n') => {
                            bytes.push(b'\n');
                            j += 1;
                        }
                        Some(b'r') => {
                            bytes.push(b'\r');
                            j += 1;
                        }
                        Some(b't') => {
                            bytes.push(b'\t');
                            j += 1;
                        }
                        Some(b'b') => {
                            bytes.push(0x08);
                            j += 1;
                        }
                        Some(b'f') => {
                            bytes.push(0x0C);
                            j += 1;
                        }
                        Some(&c @ b'0'..=b'7') => {
                            let mut value = u32::from(c - b'0');
                            j += 1;
                            for _ in 0..2 {
                                match stream.get(j) {
                                    Some(&d @ b'0'..=b'7') => {
                                        value = value * 8 + u32::from(d - b'0');
                                        j += 1;
                                    }
                                    _ => break,
                                }
                            }
                            bytes.push(value as u8);
                        }
                        Some(&c) => {
                            bytes.push(c);
                            j += 1;
                        }
                        None => break,
                    }
                }
                b'(' => {
                    depth += 1;
                    bytes.push(b'(');
                    j += 1;
                }
                b')' => {
                    depth -= 1;
                    j += 1;
                    if depth == 0 {
                        break;
                    }
                    bytes.push(b')');
                }
                c => {
                    bytes.push(c);
                    j += 1;
                }
            }
        }
        if stream[j..].starts_with(b" Tj") {
            out.push(bytes);
        }
        i = j;
    }
    out
}

/// Everything a reader would extract, in content-stream order, one run per
/// line.
pub fn extracted_text(pdf: &[u8]) -> String {
    let map = to_unicode_map(pdf);
    let mut out = String::new();
    for stream in streams(pdf) {
        if !is_content_stream(&stream) {
            continue;
        }
        for shown in shown_strings(&stream) {
            let (codes, _) = shown.as_chunks::<2>();
            for code in codes {
                let code = u16::from_be_bytes(*code);
                out.push_str(map.get(&code).map(String::as_str).unwrap_or("\u{FFFD}"));
            }
            out.push('\n');
        }
    }
    out
}

/// The URI of every link annotation, in file order.
pub fn annotation_uris(pdf: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(pdf);
    let mut out = Vec::new();
    let mut rest = text.as_ref();
    while let Some(at) = rest.find("/URI (") {
        rest = &rest[at + "/URI (".len()..];
        if let Some(end) = rest.find(')') {
            out.push(rest[..end].to_string());
            rest = &rest[end..];
        } else {
            break;
        }
    }
    out
}

pub fn page_count(pdf: &[u8]) -> usize {
    let text = String::from_utf8_lossy(pdf);
    text.matches("/Type /Page").count() - text.matches("/Type /Pages").count()
}

/// One link annotation, read back out of the finished file the way a reader
/// reaches it: page tree → page → `/Annots` → annotation object.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkAnnotation {
    /// Index of the page whose `/Annots` array holds it.
    pub page: usize,
    pub rect: [f32; 4],
    pub uri: String,
    pub subtype: String,
    pub has_uri_action: bool,
}

impl LinkAnnotation {
    pub fn width(&self) -> f32 {
        self.rect[2] - self.rect[0]
    }
    pub fn height(&self) -> f32 {
        self.rect[3] - self.rect[1]
    }
}

/// Every `N 0 obj … endobj` body in the file, by object number.
fn objects(pdf: &[u8]) -> HashMap<u32, String> {
    let text = String::from_utf8_lossy(pdf).into_owned();
    let mut out = HashMap::new();
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while let Some(rel) = text[i..].find(" 0 obj") {
        let at = i + rel;
        // Walk back over the object number.
        let mut start = at;
        while start > 0 && bytes[start - 1].is_ascii_digit() {
            start -= 1;
        }
        let Ok(number) = text[start..at].parse::<u32>() else {
            i = at + 6;
            continue;
        };
        let body_start = at + " 0 obj".len();
        let end = match text[body_start..].find("endobj") {
            Some(e) => body_start + e,
            None => break,
        };
        out.insert(number, text[body_start..end].to_string());
        i = end;
    }
    out
}

/// Object numbers in `/Kids`, i.e. the pages in the order the reader shows
/// them.
fn page_order(objects: &HashMap<u32, String>) -> Vec<u32> {
    let Some(tree) = objects.values().find(|b| b.contains("/Type /Pages")) else {
        return Vec::new();
    };
    let Some(start) = tree.find("/Kids") else {
        return Vec::new();
    };
    let slice = &tree[start..];
    let Some(open) = slice.find('[') else {
        return Vec::new();
    };
    let Some(close) = slice[open..].find(']') else {
        return Vec::new();
    };
    refs_in(&slice[open + 1..open + close])
}

fn refs_in(list: &str) -> Vec<u32> {
    let mut out = Vec::new();
    for chunk in list.split(" R") {
        let token = chunk.trim();
        if let Some(number) = token.split_whitespace().next() {
            if let Ok(n) = number.parse::<u32>() {
                out.push(n);
            }
        }
    }
    out
}

fn numbers_in_array(body: &str, key: &str) -> Option<Vec<f32>> {
    let start = body.find(key)?;
    let slice = &body[start + key.len()..];
    let open = slice.find('[')?;
    let close = slice[open..].find(']')?;
    slice[open + 1..open + close]
        .split_whitespace()
        .map(|n| n.parse::<f32>().ok())
        .collect()
}

fn name_after(body: &str, key: &str) -> Option<String> {
    let start = body.find(key)?;
    let rest = &body[start + key.len()..];
    let rest = rest.trim_start();
    let rest = rest.strip_prefix('/')?;
    Some(
        rest.chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect(),
    )
}

/// Reads every link annotation out of the final PDF, resolved through the
/// page tree so the reported page index is the one a reader would show it on.
pub fn link_annotations(pdf: &[u8]) -> Vec<LinkAnnotation> {
    let objects = objects(pdf);
    let mut out = Vec::new();
    for (page_index, page_number) in page_order(&objects).into_iter().enumerate() {
        let Some(page_body) = objects.get(&page_number) else {
            continue;
        };
        let Some(annots_at) = page_body.find("/Annots") else {
            continue;
        };
        let slice = &page_body[annots_at..];
        let (Some(open),) = (slice.find('['),) else {
            continue;
        };
        let Some(close) = slice[open..].find(']') else {
            continue;
        };
        for annot_number in refs_in(&slice[open + 1..open + close]) {
            let Some(body) = objects.get(&annot_number) else {
                continue;
            };
            let subtype = name_after(body, "/Subtype").unwrap_or_default();
            let rect = numbers_in_array(body, "/Rect").unwrap_or_default();
            let uri = body
                .find("/URI (")
                .and_then(|at| {
                    let rest = &body[at + "/URI (".len()..];
                    rest.find(')').map(|end| rest[..end].to_string())
                })
                .unwrap_or_default();
            out.push(LinkAnnotation {
                page: page_index,
                rect: [
                    rect.first().copied().unwrap_or(f32::NAN),
                    rect.get(1).copied().unwrap_or(f32::NAN),
                    rect.get(2).copied().unwrap_or(f32::NAN),
                    rect.get(3).copied().unwrap_or(f32::NAN),
                ],
                uri,
                subtype,
                has_uri_action: body.contains("/S /URI"),
            });
        }
    }
    out
}

/// Each page's `/MediaBox`, in page-tree order.
pub fn media_boxes(pdf: &[u8]) -> Vec<[f32; 4]> {
    let objects = objects(pdf);
    page_order(&objects)
        .into_iter()
        .filter_map(|n| objects.get(&n))
        .filter_map(|body| numbers_in_array(body, "/MediaBox"))
        .map(|v| [v[0], v[1], v[2], v[3]])
        .collect()
}
