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

## Full transitive dependency inventory (generated, P5 hardening)

The table above lists direct dependencies with their purpose; the full
transitive dependency graph (`cargo deny list`, run 2026-09-17 against
the real `Cargo.lock`) is machine-verified on every CI run via
`cargo deny check licenses` (`deny.toml`) rather than hand-maintained
here, since a hand-maintained transitive list goes stale the moment any
direct dependency bumps a minor version. The full license breakdown at
the time of this P5 pass:

| License | Count | Crates |
|---|---|---|
| MIT | 36 | adler2, bitflags (2 versions), bumpalo, cfg-if, crc32fast, fdeflate, flate2, futures-core, futures-task, futures-util, itoa, js-sys, memchr, miniz_oxide (2 versions), once_cell, pdf-writer, pin-project-lite, png, proc-macro2, quote, rustversion, serde, serde_core, serde_derive, serde_json, simd-adler32, slab, syn, unicode-ident, wasm-bindgen, wasm-bindgen-macro, wasm-bindgen-macro-support, wasm-bindgen-shared, zmij |
| Apache-2.0 | 33 | (same set as MIT, minus memchr/simd-adler32/zmij, plus rustversion) — see `cargo deny list` for the exact per-crate breakdown |
| MPL-2.0 | 6 | screenshot-core, screenshot-md, screenshot-pdf, screenshot-png, screenshot-wasm, xtask (this project's own crates) |
| Unicode-3.0 | 1 | unicode-ident |
| BSL-1.0 | 1 | ryu |
| 0BSD | 1 | adler2 |
| Zlib | 2 | miniz_oxide (2 versions) |
| Unlicense | 1 | memchr |

Every one of these is a standard permissive OSS license already
compatible with MPL-2.0 for this project's purposes (dual/triple-OR
licensed crates chose whichever allowed license applied; see
`deny.toml`'s `[licenses]` section for the exact allow-list `cargo deny
check licenses` enforces). `cargo audit` (RustSec advisory database)
found 0 vulnerabilities across all 77 dependencies as of this pass.

Design reference (not a code or asset dependency): FullScreenShot used
[mrcoles/full-page-screen-capture-chrome-extension](https://github.com/mrcoles/full-page-screen-capture-chrome-extension)
([license](https://github.com/mrcoles/full-page-screen-capture-chrome-extension/blob/master/LICENSE))
purely as a functional/behavioral reference during design. No source
code, architecture, or assets from that project are included here.
