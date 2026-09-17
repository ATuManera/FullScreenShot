// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

fn normalize_scheme_check(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase()
}

/// Returns `None` for links that must not be rendered as clickable
/// Markdown links: `javascript:` URLs (arbitrary code execution) and
/// `data:` URLs (can themselves carry executable HTML/script content,
/// e.g. `data:text/html,<script>...`, when opened directly). `Some(href)`
/// otherwise.
pub fn sanitize_href(href: &str) -> Option<String> {
    let normalized = normalize_scheme_check(href);
    if normalized.starts_with("javascript:") || normalized.starts_with("data:") {
        None
    } else {
        Some(href.trim().to_string())
    }
}

/// Returns `None` for image sources that must not be embedded:
/// `javascript:` URLs, and `data:` URLs whose declared MIME type is not
/// `image/*` (a `data:text/html` or `data:application/javascript` "image"
/// src is never legitimate). Ordinary `data:image/...` URLs — the common
/// case for inline SVG/PNG — are allowed, unlike in `sanitize_href`.
pub fn sanitize_image_src(src: &str) -> Option<String> {
    let normalized = normalize_scheme_check(src);
    if normalized.starts_with("javascript:") {
        return None;
    }
    if let Some(rest) = normalized.strip_prefix("data:") {
        if !rest.starts_with("image/") {
            return None;
        }
    }
    Some(src.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_https_links() {
        assert_eq!(
            sanitize_href("https://example.com"),
            Some("https://example.com".to_string())
        );
    }

    #[test]
    fn blocks_javascript_urls() {
        assert_eq!(sanitize_href("javascript:alert(1)"), None);
    }

    #[test]
    fn blocks_javascript_urls_with_whitespace_obfuscation() {
        assert_eq!(sanitize_href(" \tjava\nscript:alert(1)"), None);
    }

    #[test]
    fn blocks_javascript_urls_case_insensitively() {
        assert_eq!(sanitize_href("JavaScript:alert(1)"), None);
    }

    #[test]
    fn allows_relative_links() {
        assert_eq!(sanitize_href("/about"), Some("/about".to_string()));
    }

    #[test]
    fn blocks_data_urls_as_links() {
        assert_eq!(
            sanitize_href("data:text/html,<script>alert(1)</script>"),
            None
        );
    }

    #[test]
    fn image_src_allows_https() {
        assert_eq!(
            sanitize_image_src("https://example.com/x.png"),
            Some("https://example.com/x.png".to_string())
        );
    }

    #[test]
    fn image_src_allows_inline_image_data_urls() {
        let src = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
        assert_eq!(sanitize_image_src(src), Some(src.to_string()));
    }

    #[test]
    fn image_src_blocks_non_image_data_urls() {
        assert_eq!(
            sanitize_image_src("data:text/html,<script>alert(1)</script>"),
            None
        );
        assert_eq!(
            sanitize_image_src("data:application/javascript,alert(1)"),
            None
        );
    }

    #[test]
    fn image_src_blocks_javascript_urls() {
        assert_eq!(sanitize_image_src("javascript:alert(1)"), None);
    }
}
