# Third-Party Notices

FullScreenShot uses the following third-party open-source components.
This file is updated whenever a new runtime dependency is added.

| Component | License | Purpose |
|---|---|---|
| [`png`](https://crates.io/crates/png) | MIT OR Apache-2.0 | Lossless PNG encoding (`screenshot-png`) |
| [`wasm-bindgen`](https://crates.io/crates/wasm-bindgen) | MIT OR Apache-2.0 | Rust/JS interop for the WASM bridge (`screenshot-wasm`) |
| [`js-sys`](https://crates.io/crates/js-sys) | MIT OR Apache-2.0 | JS type bindings for the WASM bridge (`screenshot-wasm`) |
| [`proptest`](https://crates.io/crates/proptest) | MIT OR Apache-2.0 | Property-based testing (dev-dependency only, not shipped) |
| [`pdf-writer`](https://crates.io/crates/pdf-writer) | MIT OR Apache-2.0 | Low-level PDF document generation (`screenshot-pdf`) |
| [`flate2`](https://crates.io/crates/flate2) | MIT OR Apache-2.0 | DEFLATE/zlib compression for PDF image streams (`screenshot-pdf`) |
| [`serde`](https://crates.io/crates/serde) | MIT OR Apache-2.0 | (De)serialization framework for the Markdown AST JSON boundary (`screenshot-md`) |
| [`serde_json`](https://crates.io/crates/serde_json) | MIT OR Apache-2.0 | JSON parsing for the untrusted Markdown AST boundary (`screenshot-md`) |

None of the above components are modified from their published form;
they are used as unmodified dependencies via Cargo/crates.io. No
component's license requires source redistribution beyond what MPL-2.0
already provides for this project's own code.

Design reference (not a code or asset dependency): FullScreenShot used
[mrcoles/full-page-screen-capture-chrome-extension](https://github.com/mrcoles/full-page-screen-capture-chrome-extension)
([license](https://github.com/mrcoles/full-page-screen-capture-chrome-extension/blob/master/LICENSE))
purely as a functional/behavioral reference during design. No source
code, architecture, or assets from that project are included here.
