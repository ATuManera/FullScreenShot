// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Pure policy logic for the "Reliable" lazy-loading capture mode: how many
 * pre-scroll passes to plan, and when to treat a page as effectively
 * infinite-scrolling rather than keep waiting for it to settle. No DOM
 * access here — the DOM side (actually scrolling and re-measuring) lives
 * in the orchestrator, which calls these pure functions between steps.
 */

export const DEFAULT_MAX_PRESCROLL_PASSES = 8;
export const DEFAULT_GROWTH_TOLERANCE_RATIO = 0.02;

/**
 * True when the most recent `scrollHeight` sample grew by more than
 * `toleranceRatio` over the previous one — i.e. the page is still
 * settling (lazy content loading in) and another pre-scroll pass is
 * worth trying.
 */
export function isStillGrowing(samples: number[], toleranceRatio: number = DEFAULT_GROWTH_TOLERANCE_RATIO): boolean {
  if (samples.length < 2) {
    return false;
  }
  const prev = samples[samples.length - 2];
  const last = samples[samples.length - 1];
  if (prev === undefined || last === undefined) {
    return false;
  }
  return last > prev * (1 + toleranceRatio);
}

export type PrescrollOutcome = "settled" | "possibly-infinite";

/**
 * Given the full sequence of scrollHeight samples collected during
 * Reliable pre-scrolling (one per pass, oldest first), decides whether
 * the page settled or looks like infinite/continuously-growing content.
 * `maxPasses` matches the cap actually used by the caller — this stays a
 * pure decision so it can be tested without driving a real pre-scroll.
 */
export function classifyPrescrollOutcome(samples: number[], maxPasses: number = DEFAULT_MAX_PRESCROLL_PASSES): PrescrollOutcome {
  if (samples.length < maxPasses) {
    return "settled";
  }
  return isStillGrowing(samples) ? "possibly-infinite" : "settled";
}
