// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/// Returns `None` for links that must not be rendered as clickable
/// Markdown links (javascript: URLs), `Some(href)` otherwise.
pub fn sanitize_href(href: &str) -> Option<String> {
    let normalized: String = href
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    if normalized.starts_with("javascript:") {
        None
    } else {
        Some(href.trim().to_string())
    }
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
}
