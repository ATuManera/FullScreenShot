// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
//! Dev-only: writes the glyphless TrueType so a real browser can vet it.
fn main() {
    let font = screenshot_pdf::font::glyphless_truetype();
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "glyphless.ttf".into());
    std::fs::write(&path, &font).unwrap();
    eprintln!("{path}: {} bytes", font.len());
}
