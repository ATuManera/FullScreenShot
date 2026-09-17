// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday
//
// Hand-maintained ambient declaration for the wasm-bindgen `--target web`
// package built by `wasm-pack` (see crates/screenshot-wasm and
// `cargo xtask build`). The real screenshot_wasm.js/.wasm are generated
// artifacts copied into dist/chromium/wasm/ at package time — they are
// not present under extension/src/, so this file is what lets `tsc`
// typecheck imports of "../wasm/screenshot_wasm.js" against the real
// exported API. Keep this in sync with
// crates/screenshot-wasm/src/{png,pdf,markdown,rate_limiter,tiles}.rs.

export class RateLimiter {
  free(): void;
  static defaultForCapture(): RateLimiter;
  constructor(base_delay_ms: number, max_delay_ms: number);
  nextDelayMs(now_ms: number): number;
  recordError(now_ms: number): void;
  recordSuccess(now_ms: number): void;
}

export function composeFullPagePng(
  offsets: Float64Array,
  viewport_width: number,
  viewport_height: number,
  dpr: number,
  tile_widths: Uint32Array,
  tile_heights: Uint32Array,
  tile_rgba_concat: Uint8Array,
): Uint8Array;

export function composeFullPagePdf(
  offsets: Float64Array,
  viewport_width: number,
  viewport_height: number,
  dpr: number,
  tile_widths: Uint32Array,
  tile_heights: Uint32Array,
  tile_rgba_concat: Uint8Array,
  page_size: "a4" | "letter" | "auto",
  orientation: "portrait" | "landscape",
): Uint8Array;

export function markdownFromJson(json: string, title: string, source: string, captured_at: string): string;

export function planTiles(viewport_height: number, content_height: number, overlap: number): number[];

export default function init(module_or_path?: RequestInfo | URL): Promise<unknown>;
