// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/// Spaces out calls to a rate-limited API (e.g. `captureVisibleTab()`).
/// Pure and clock-injected: the caller supplies the current timestamp in
/// milliseconds and gets back how long to wait before the next call.
/// Consecutive errors trigger exponential backoff, capped at `max_delay_ms`.
#[derive(Debug, Clone, PartialEq)]
pub struct RateLimiter {
    base_delay_ms: u64,
    max_delay_ms: u64,
    last_call_at_ms: Option<u64>,
    consecutive_errors: u32,
}

impl RateLimiter {
    pub fn new(base_delay_ms: u64, max_delay_ms: u64) -> Self {
        Self {
            base_delay_ms,
            max_delay_ms: max_delay_ms.max(base_delay_ms),
            last_call_at_ms: None,
            consecutive_errors: 0,
        }
    }

    /// FullScreenShot's default: ~550ms between captures.
    pub fn default_for_capture() -> Self {
        Self::new(550, 8_000)
    }

    fn current_interval_ms(&self) -> u64 {
        let backoff_multiplier = 1u64 << self.consecutive_errors.min(8);
        (self.base_delay_ms.saturating_mul(backoff_multiplier)).min(self.max_delay_ms)
    }

    /// Returns the number of milliseconds the caller should wait, given
    /// the current time, before it is allowed to make the next call.
    /// Does not mutate state — call `record_call` once the call is made.
    pub fn next_delay_ms(&self, now_ms: u64) -> u64 {
        match self.last_call_at_ms {
            None => 0,
            Some(last) => {
                let elapsed = now_ms.saturating_sub(last);
                self.current_interval_ms().saturating_sub(elapsed)
            }
        }
    }

    /// Records that a call was made at `now_ms`, succeeding.
    pub fn record_success(&mut self, now_ms: u64) {
        self.last_call_at_ms = Some(now_ms);
        self.consecutive_errors = 0;
    }

    /// Records that a call was made at `now_ms` but failed; the next
    /// `next_delay_ms` will apply exponential backoff.
    pub fn record_error(&mut self, now_ms: u64) {
        self.last_call_at_ms = Some(now_ms);
        self.consecutive_errors = self.consecutive_errors.saturating_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_call_needs_no_wait() {
        let limiter = RateLimiter::new(550, 8_000);
        assert_eq!(limiter.next_delay_ms(0), 0);
    }

    #[test]
    fn immediate_second_call_must_wait_full_interval() {
        let mut limiter = RateLimiter::new(550, 8_000);
        limiter.record_success(1_000);
        assert_eq!(limiter.next_delay_ms(1_000), 550);
    }

    #[test]
    fn waiting_long_enough_needs_no_further_delay() {
        let mut limiter = RateLimiter::new(550, 8_000);
        limiter.record_success(1_000);
        assert_eq!(limiter.next_delay_ms(1_600), 0);
    }

    #[test]
    fn partial_wait_returns_remaining_time() {
        let mut limiter = RateLimiter::new(550, 8_000);
        limiter.record_success(1_000);
        assert_eq!(limiter.next_delay_ms(1_300), 250);
    }

    #[test]
    fn errors_trigger_exponential_backoff() {
        let mut limiter = RateLimiter::new(550, 8_000);
        limiter.record_error(0);
        assert_eq!(limiter.next_delay_ms(0), 1_100); // 550 * 2^1
        limiter.record_error(0);
        assert_eq!(limiter.next_delay_ms(0), 2_200); // 550 * 2^2
    }

    #[test]
    fn backoff_is_capped_at_max_delay() {
        let mut limiter = RateLimiter::new(550, 2_000);
        for _ in 0..10 {
            limiter.record_error(0);
        }
        assert_eq!(limiter.next_delay_ms(0), 2_000);
    }

    #[test]
    fn success_after_errors_resets_backoff() {
        let mut limiter = RateLimiter::new(550, 8_000);
        limiter.record_error(0);
        limiter.record_error(0);
        limiter.record_success(1_000);
        assert_eq!(limiter.next_delay_ms(1_000), 550);
    }

    #[test]
    fn max_delay_is_never_below_base_delay() {
        let limiter = RateLimiter::new(1_000, 500);
        assert_eq!(limiter.max_delay_ms, 1_000);
    }
}
