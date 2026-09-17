#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
# Copyright (c) 2026 ATuManera / Fernando Gallarday
#
# Converts dist/chromium/ into a Safari App Extension Xcode project via
# `xcrun safari-web-extension-converter`. Requires full Xcode (not just
# the Command Line Tools) — see browser/safari/README.md for exactly
# what this does and does not verify. The converter's flags below match
# Apple's documented CLI for this tool, but the actual conversion run
# itself has NOT been exercised in this repo's dev environment (no full
# Xcode installed here) — verify the flags still match the installed
# Xcode's tool version if this fails.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/dist/chromium"
BUILD_DIR="$ROOT_DIR/browser/safari/build"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "error: $SOURCE_DIR does not exist — run 'cargo xtask build' first." >&2
  exit 1
fi

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "error: 'xcrun safari-web-extension-converter' is not available." >&2
  echo "       This tool ships with full Xcode.app, not the Command Line" >&2
  echo "       Tools alone. Install Xcode from the App Store, run" >&2
  echo "       'sudo xcode-select -s /Applications/Xcode.app', then retry." >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"

xcrun safari-web-extension-converter "$SOURCE_DIR" \
  --project-location "$BUILD_DIR" \
  --app-name "FullScreenShot" \
  --bundle-identifier "org.atumanera.fullscreenshot" \
  --swift \
  --no-open \
  --force

echo "Safari Xcode project generated at $BUILD_DIR"
echo "Open it in Xcode to build, sign, and run — see browser/safari/README.md."
