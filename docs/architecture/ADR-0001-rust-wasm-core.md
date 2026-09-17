# ADR-0001: Rust/WebAssembly core with a minimal JS/TS shell

## Status

Accepted (P0)

## Context

FullScreenShot needs complex, testable logic (capture geometry, tile
planning, stitching/compositing, PNG/PDF/Markdown generation) plus
access to browser-only WebExtension APIs (`captureVisibleTab`,
`scripting`, messaging, DOM interaction). These two concerns have very
different quality bars: the WebExtension surface is small and mostly
glue; the processing logic benefits from strong typing, unit and
property-based testing, and memory-safety guarantees under adversarial
input (hostile page DOM, huge dimensions).

## Decision

Implement all browser-dependent glue in a small, auditable
JavaScript/TypeScript shell (`extension/`). Implement all reusable,
non-trivial logic in Rust crates under `crates/`, compiled to
WebAssembly via `screenshot-wasm` and consumed by the shell. The core
must never reference browser APIs; the shell must never contain
capture-geometry, stitching, or file-format logic.

## Alternatives considered

- **"100% Rust" extension (e.g. via a full Rust-to-JS framework):**
  rejected — WebExtension APIs are fundamentally JS/browser-provided;
  forcing everything through Rust would add an opaque translation
  layer without removing the JS dependency, hurting auditability.
- **Pure JavaScript/TypeScript, no Rust:** rejected — full-page capture
  correctness (DPR/zoom math, seam-free stitching, streaming
  composition to bound memory) benefits materially from Rust's type
  system, testing ecosystem (proptest), and predictable performance
  under memory pressure; a privacy-first tool with security-sensitive
  parsing (untrusted DOM → Markdown AST) also benefits from Rust's
  memory safety.

## Consequences

- Two toolchains to maintain (Rust + TypeScript), coordinated via
  `cargo xtask`.
- Clear code-review boundary: browser-API changes review differently
  than core-logic changes.
- The WASM bridge (`screenshot-wasm`) becomes a deliberate, minimal,
  versioned interface — see ADR entries for capture strategy (P1) and
  streaming compositor (P1) for how that interface grows.
