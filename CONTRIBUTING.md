# Contributing to FullScreenShot

Thank you for your interest in contributing.

## Ground rules

- All contributions are licensed under this project's license,
  MPL-2.0 ("Incompatible With Secondary Licenses") — see `LICENSE`.
- Keep privacy-first principles intact: no telemetry, no analytics, no
  network calls in the capture/export path, no remote code execution.
- Prefer the minimal browser permission set; justify any new permission
  in your pull request description and, if it changes architecture, in
  an ADR under `docs/architecture/`.

## Development setup

1. Install Rust (stable) and the `wasm32-unknown-unknown` target:
   `rustup target add wasm32-unknown-unknown`
2. Install Node.js (for the extension's TypeScript typecheck).
3. Build everything: `cargo xtask build`
4. Run tests: `cargo xtask test`

## Before opening a pull request

- `cargo fmt --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace`
- Keep commits small and scoped (one logical change per commit).
- Update `CHANGELOG.md` under "Unreleased" for user-facing changes.
- If your change affects a documented design in `docs/superpowers/specs/`
  or `docs/architecture/`, update that document in the same change.

## Code style

- Rust: rely on `cargo fmt` and `cargo clippy` defaults; no unsafe code
  without a comment explaining why it's necessary and sound.
- TypeScript: keep the extension shell minimal and auditable; no new
  frontend framework without discussion in an issue first.
