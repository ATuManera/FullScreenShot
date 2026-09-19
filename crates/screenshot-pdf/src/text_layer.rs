// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

//! The semantic half of a hybrid PDF: text runs and hyperlinks measured off
//! the live DOM, crossing the WASM boundary as JSON.
//!
//! Everything here arrives from a web page, so it is untrusted in exactly the
//! sense `screenshot_md::ast::Document::from_untrusted_json` means: a hostile
//! page can put anything in a text node, an `href`, or the numbers a
//! `getClientRects()` shim returns. Parsing is therefore total — it rejects
//! rather than panics, and it rejects *here*, once, instead of leaving each
//! consumer to wonder whether a width can be negative.
//!
//! Coordinates are **source CSS pixels**: document coordinates for a full-page
//! capture, and the scroll container's own content coordinates for a scroll
//! area. Which of the two it is, is the caller's business; `transform` maps
//! either onto the composited image using the compositor's band map.

use screenshot_core::CoreError;
use serde::Deserialize;

/// Caps chosen to bound memory and PDF size on a hostile or simply enormous
/// page, well above what a real document produces (a long Wikipedia article
/// yields a few thousand fragments).
const MAX_FRAGMENTS: usize = 200_000;
const MAX_LINKS: usize = 50_000;
const MAX_TEXT_CHARS: usize = 4096;
const MAX_URI_BYTES: usize = 2048;
/// A rectangle larger than this in CSS px is not a line of text; it is a
/// measurement gone wrong, and placing it would paint selection over the page.
const MAX_RECT_CSS_PX: f64 = 1_000_000.0;

/// One visual line of text, with the box it occupies in source CSS px.
///
/// One line, not one text node: a wrapped paragraph arrives as several
/// fragments, because a single rectangle around a three-line paragraph would
/// put the whole string on the first line and make selection nonsense.
#[derive(Debug, Clone, PartialEq)]
pub struct TextFragment {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// The element's computed `font-size` in CSS px. Read from the DOM rather
    /// than inferred from `height`, which is the font's ascent+descent box and
    /// differs from the font size by a ratio that varies per typeface.
    pub font_size: f64,
}

/// One rendered rectangle of one `<a href>`. A link wrapped across two lines
/// contributes two of these, each becoming its own PDF annotation.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkRect {
    pub uri: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TextLayer {
    pub fragments: Vec<TextFragment>,
    pub links: Vec<LinkRect>,
}

#[derive(Deserialize)]
struct RawLayer {
    #[serde(default)]
    fragments: Vec<RawFragment>,
    #[serde(default)]
    links: Vec<RawLink>,
}

#[derive(Deserialize)]
struct RawFragment {
    text: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    size: f64,
}

#[derive(Deserialize)]
struct RawLink {
    uri: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

fn reject(what: &str) -> CoreError {
    CoreError::Overflow(format!("invalid text layer: {what}"))
}

/// A rectangle a PDF can actually be given: finite, positive, and not so
/// large that it could only have come from a broken measurement.
fn valid_rect(x: f64, y: f64, w: f64, h: f64) -> bool {
    [x, y, w, h].iter().all(|v| v.is_finite())
        && w > 0.0
        && h > 0.0
        && w <= MAX_RECT_CSS_PX
        && h <= MAX_RECT_CSS_PX
        && x.abs() <= MAX_RECT_CSS_PX
        && y.abs() <= MAX_RECT_CSS_PX
}

/// Whether a resolved URL may become a clickable annotation.
///
/// HTTP and HTTPS only, deliberately. `javascript:` and `data:` are the ones
/// that matter — a PDF reader that follows them runs page-supplied code in the
/// reader's context — but `blob:`, `file:` and `chrome-extension:` are refused
/// too, because none of them can mean anything on the machine that opens the
/// PDF, and a link that silently does nothing is worse than no link. `mailto:`
/// is safe but is not offered in V1; see the P7 design spec.
///
/// The scheme is compared before any whitespace the page may have wrapped it
/// in, and case-insensitively, since `JavaScript:` is the same scheme.
pub fn is_supported_uri(uri: &str) -> bool {
    let trimmed = uri.trim();
    if trimmed.len() > MAX_URI_BYTES || trimmed.is_empty() {
        return false;
    }
    // A control character in a URI cannot survive into a PDF string intact and
    // is a smuggling attempt more often than a typo.
    if trimmed.chars().any(|c| c.is_control()) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

impl TextLayer {
    pub fn is_empty(&self) -> bool {
        self.fragments.is_empty() && self.links.is_empty()
    }

    /// Parses a text layer produced by the in-page extractor.
    ///
    /// Malformed *entries* are dropped, malformed *structure* is an error: a
    /// page that manages to emit one unmeasurable line should still get a
    /// searchable PDF, but JSON that is not a text layer at all is a bug in
    /// the extension and must not be papered over.
    pub fn from_untrusted_json(json: &str) -> Result<TextLayer, CoreError> {
        let raw: RawLayer =
            serde_json::from_str(json).map_err(|e| reject(&format!("not a text layer ({e})")))?;
        if raw.fragments.len() > MAX_FRAGMENTS {
            return Err(reject("too many text fragments"));
        }
        if raw.links.len() > MAX_LINKS {
            return Err(reject("too many links"));
        }

        let mut fragments = Vec::with_capacity(raw.fragments.len());
        for f in raw.fragments {
            if !valid_rect(f.x, f.y, f.w, f.h) {
                continue;
            }
            if !f.size.is_finite() || f.size <= 0.0 || f.size > MAX_RECT_CSS_PX {
                continue;
            }
            // Whitespace-only runs carry no search or selection value and
            // would only add PDF objects.
            if f.text.trim().is_empty() {
                continue;
            }
            let text: String = f.text.chars().take(MAX_TEXT_CHARS).collect();
            fragments.push(TextFragment {
                text,
                x: f.x,
                y: f.y,
                width: f.w,
                height: f.h,
                font_size: f.size,
            });
        }

        let mut links = Vec::with_capacity(raw.links.len());
        for l in raw.links {
            if !valid_rect(l.x, l.y, l.w, l.h) || !is_supported_uri(&l.uri) {
                continue;
            }
            links.push(LinkRect {
                uri: l.uri.trim().to_string(),
                x: l.x,
                y: l.y,
                width: l.w,
                height: l.h,
            });
        }

        Ok(TextLayer { fragments, links })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_fragment_and_a_link() {
        let layer = TextLayer::from_untrusted_json(
            r#"{"fragments":[{"text":"Hola","x":1,"y":2,"w":30,"h":18,"size":16}],
                "links":[{"uri":"https://example.com/a","x":1,"y":2,"w":30,"h":18}]}"#,
        )
        .unwrap();
        assert_eq!(layer.fragments.len(), 1);
        assert_eq!(layer.fragments[0].text, "Hola");
        assert_eq!(layer.fragments[0].font_size, 16.0);
        assert_eq!(layer.links[0].uri, "https://example.com/a");
    }

    #[test]
    fn missing_sections_parse_as_empty_rather_than_failing() {
        assert!(TextLayer::from_untrusted_json("{}").unwrap().is_empty());
    }

    #[test]
    fn json_that_is_not_a_text_layer_is_an_error() {
        assert!(TextLayer::from_untrusted_json("[1,2,3]").is_err());
        assert!(TextLayer::from_untrusted_json("not json").is_err());
    }

    #[test]
    fn unicode_survives_parsing_unchanged() {
        let layer = TextLayer::from_untrusted_json(
            r#"{"fragments":[{"text":"información señal Perú ñÑüÜ — «»","x":0,"y":0,"w":10,"h":10,"size":10}]}"#,
        )
        .unwrap();
        assert_eq!(layer.fragments[0].text, "información señal Perú ñÑüÜ — «»");
    }

    #[test]
    fn dom_order_is_preserved() {
        let layer = TextLayer::from_untrusted_json(
            r#"{"fragments":[
                {"text":"third","x":0,"y":900,"w":10,"h":10,"size":10},
                {"text":"first","x":0,"y":0,"w":10,"h":10,"size":10},
                {"text":"second","x":0,"y":400,"w":10,"h":10,"size":10}]}"#,
        )
        .unwrap();
        // Parsing never re-sorts: the extractor walks the DOM in document
        // order, and that order is the reading order the PDF gets.
        let texts: Vec<&str> = layer.fragments.iter().map(|f| f.text.as_str()).collect();
        assert_eq!(texts, ["third", "first", "second"]);
    }

    #[test]
    fn unmeasurable_fragments_are_dropped_without_failing_the_capture() {
        let layer = TextLayer::from_untrusted_json(
            r#"{"fragments":[
                {"text":"zero width","x":0,"y":0,"w":0,"h":10,"size":10},
                {"text":"zero height","x":0,"y":0,"w":10,"h":0,"size":10},
                {"text":"   ","x":0,"y":0,"w":10,"h":10,"size":10},
                {"text":"no size","x":0,"y":0,"w":10,"h":10,"size":0},
                {"text":"kept","x":0,"y":0,"w":10,"h":10,"size":10}]}"#,
        )
        .unwrap();
        let texts: Vec<&str> = layer.fragments.iter().map(|f| f.text.as_str()).collect();
        assert_eq!(texts, ["kept"]);
    }

    #[test]
    fn non_finite_numbers_are_dropped() {
        // serde rejects bare NaN/Infinity, so a hostile page reaches this
        // through a number large enough to become infinite, or a huge one.
        let layer = TextLayer::from_untrusted_json(
            r#"{"fragments":[{"text":"huge","x":0,"y":0,"w":1e308,"h":10,"size":10},
                             {"text":"kept","x":0,"y":0,"w":10,"h":10,"size":10}]}"#,
        )
        .unwrap();
        assert_eq!(layer.fragments.len(), 1);
        assert_eq!(layer.fragments[0].text, "kept");
    }

    #[test]
    fn only_http_and_https_become_clickable() {
        for uri in [
            "https://example.com",
            "http://example.com",
            "HTTPS://EXAMPLE.COM",
        ] {
            assert!(is_supported_uri(uri), "{uri} should be supported");
        }
        for uri in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "data:text/html,<script>",
            "blob:https://example.com/x",
            "chrome-extension://abc/page.html",
            "file:///etc/passwd",
            "mailto:someone@example.com",
            "ftp://example.com",
            "",
            "   ",
            "https://exa\u{0000}mple.com",
        ] {
            assert!(!is_supported_uri(uri), "{uri} must not be clickable");
        }
    }

    #[test]
    fn rejected_schemes_are_dropped_from_the_layer_not_rewritten() {
        let layer = TextLayer::from_untrusted_json(
            r#"{"links":[
                {"uri":"javascript:alert(1)","x":0,"y":0,"w":10,"h":10},
                {"uri":"data:text/html,x","x":0,"y":0,"w":10,"h":10},
                {"uri":"https://example.com/ok","x":0,"y":0,"w":10,"h":10}]}"#,
        )
        .unwrap();
        assert_eq!(layer.links.len(), 1);
        assert_eq!(layer.links[0].uri, "https://example.com/ok");
    }

    #[test]
    fn overlong_text_is_truncated_on_a_character_boundary() {
        let long = "ñ".repeat(MAX_TEXT_CHARS + 100);
        let json =
            format!(r#"{{"fragments":[{{"text":"{long}","x":0,"y":0,"w":10,"h":10,"size":10}}]}}"#);
        let layer = TextLayer::from_untrusted_json(&json).unwrap();
        assert_eq!(layer.fragments[0].text.chars().count(), MAX_TEXT_CHARS);
    }

    #[test]
    fn an_absurd_number_of_fragments_is_refused_outright() {
        let one = r#"{"text":"x","x":0,"y":0,"w":1,"h":1,"size":1}"#;
        let many = vec![one; MAX_FRAGMENTS + 1].join(",");
        assert!(TextLayer::from_untrusted_json(&format!(r#"{{"fragments":[{many}]}}"#)).is_err());
    }
}
