#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
# Copyright (c) 2026 ATuManera / Fernando Gallarday
#
# Assembles dist/chromium/ from the compiled TypeScript output plus
# static extension assets (manifest, HTML/CSS, icons, wasm artifact).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST_DIR="$ROOT_DIR/dist/chromium"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

(cd "$ROOT_DIR/extension" && npm run build)

cp "$ROOT_DIR/extension/manifest.base.json" "$DIST_DIR/manifest.json"
mkdir -p "$DIST_DIR/popup" "$DIST_DIR/options" "$DIST_DIR/result" "$DIST_DIR/icons" "$DIST_DIR/wasm"
cp "$ROOT_DIR/extension/src/popup/popup.html" "$DIST_DIR/popup/popup.html"
cp "$ROOT_DIR/extension/src/popup/popup.css" "$DIST_DIR/popup/popup.css"
cp "$ROOT_DIR/extension/src/options/options.html" "$DIST_DIR/options/options.html"
cp "$ROOT_DIR/extension/src/options/options.css" "$DIST_DIR/options/options.css"
cp "$ROOT_DIR/extension/src/result/result.html" "$DIST_DIR/result/result.html"
cp "$ROOT_DIR/extension/src/result/result.css" "$DIST_DIR/result/result.css"
cp "$ROOT_DIR/extension/icons/icon-16.png" "$ROOT_DIR/extension/icons/icon-32.png" "$ROOT_DIR/extension/icons/icon-48.png" "$ROOT_DIR/extension/icons/icon-128.png" "$DIST_DIR/icons/"

if [ -d "$ROOT_DIR/extension/wasm" ] && [ -f "$ROOT_DIR/extension/wasm/screenshot_wasm_bg.wasm" ]; then
  cp "$ROOT_DIR/extension/wasm/screenshot_wasm_bg.wasm" "$DIST_DIR/wasm/"
  cp "$ROOT_DIR/extension/wasm/screenshot_wasm.js" "$DIST_DIR/wasm/"
else
  echo "warning: extension/wasm/ not found — run 'cargo xtask build' (or wasm-pack build" >&2
  echo "         in crates/screenshot-wasm) before packaging for real use." >&2
fi

echo "dist/chromium assembled at $DIST_DIR"
