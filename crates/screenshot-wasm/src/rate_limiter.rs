// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use wasm_bindgen::prelude::*;

/// JS-facing wrapper around `screenshot_core::RateLimiter`. Timestamps are
/// `f64` milliseconds to match `Date.now()`/`performance.now()` directly.
#[wasm_bindgen]
pub struct RateLimiter {
    inner: screenshot_core::RateLimiter,
}

#[wasm_bindgen]
impl RateLimiter {
    #[wasm_bindgen(constructor)]
    pub fn new(base_delay_ms: u32, max_delay_ms: u32) -> RateLimiter {
        RateLimiter {
            inner: screenshot_core::RateLimiter::new(base_delay_ms as u64, max_delay_ms as u64),
        }
    }

    #[wasm_bindgen(js_name = "defaultForCapture")]
    pub fn default_for_capture() -> RateLimiter {
        RateLimiter {
            inner: screenshot_core::RateLimiter::default_for_capture(),
        }
    }

    #[wasm_bindgen(js_name = "nextDelayMs")]
    pub fn next_delay_ms(&self, now_ms: f64) -> f64 {
        self.inner.next_delay_ms(now_ms as u64) as f64
    }

    #[wasm_bindgen(js_name = "recordSuccess")]
    pub fn record_success(&mut self, now_ms: f64) {
        self.inner.record_success(now_ms as u64);
    }

    #[wasm_bindgen(js_name = "recordError")]
    pub fn record_error(&mut self, now_ms: f64) {
        self.inner.record_error(now_ms as u64);
    }
}
