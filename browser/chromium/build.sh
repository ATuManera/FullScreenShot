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
mkdir -p "$DIST_DIR/popup" "$DIST_DIR/options" "$DIST_DIR/icons"
cp "$ROOT_DIR/extension/src/popup/popup.html" "$DIST_DIR/popup/popup.html"
cp "$ROOT_DIR/extension/src/popup/popup.css" "$DIST_DIR/popup/popup.css"
cp "$ROOT_DIR/extension/src/options/options.html" "$DIST_DIR/options/options.html"

echo "dist/chromium assembled at $DIST_DIR"
