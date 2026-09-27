// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Pure ranking/deduplication over the raw candidate geometry produced by
 * `scrollDetectionInjectable.ts`'s `detectScrollCandidates` (which runs
 * in-page via executeScript and can't itself import this module — see
 * that file's header). No DOM access here, so this is directly unit
 * testable with plain data (see the P2 physical-vs-pure split described
 * in the UX design doc).
 */
export interface ScrollCandidateGeometry {
  /** Document-order position among the detector's candidates, and the value it marks that element with. */
  index: number;
  /** The part of the element's box that is actually on screen, clipped by the viewport and by clipping ancestors. */
  top: number;
  left: number;
  width: number;
  height: number;
  scrollHeight: number;
  clientHeight: number;
}

/** How much of `a`'s area falls inside `b`'s box, in [0, 1]. */
function overlapRatio(a: ScrollCandidateGeometry, b: ScrollCandidateGeometry): number {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  const overlapWidth = Math.max(0, right - left);
  const overlapHeight = Math.max(0, bottom - top);
  const overlapArea = overlapWidth * overlapHeight;
  const aArea = a.width * a.height;
  if (aArea <= 0) {
    return 0;
  }
  return overlapArea / aArea;
}

function scrollDelta(c: ScrollCandidateGeometry): number {
  return Math.max(0, c.scrollHeight - c.clientHeight);
}

function visibleArea(c: ScrollCandidateGeometry): number {
  return Math.max(0, c.width) * Math.max(0, c.height);
}

/** Candidates smaller/shallower than this are treated as decorative, not meaningful scroll regions. */
export const MIN_CANDIDATE_WIDTH_PX = 40;
export const MIN_CANDIDATE_HEIGHT_PX = 40;
export const MIN_SCROLL_DELTA_PX = 24;

/** True when `c` is large and scrollable enough to be worth surfacing at all. */
export function isMeaningfulCandidate(c: ScrollCandidateGeometry): boolean {
  return c.width >= MIN_CANDIDATE_WIDTH_PX && c.height >= MIN_CANDIDATE_HEIGHT_PX && scrollDelta(c) >= MIN_SCROLL_DELTA_PX;
}

const NEAR_IDENTICAL_OVERLAP_THRESHOLD = 0.9;

/**
 * Ranks candidates by how likely they are to be the "real" scrollable
 * content (larger visible area first, larger scroll delta as tiebreak),
 * drops candidates below the minimum-size thresholds, and deduplicates
 * near-identical nested boxes (e.g. a wrapper div and its one scrollable
 * child reporting almost the same rectangle) by keeping the smaller of
 * the two — in nested-scroll-wrapper markup the inner element is
 * typically the actual meaningful region, and the outer one is
 * incidental. Distinct, non-overlapping regions are never merged.
 *
 * "Near-identical" has to hold in both directions. Testing only whether one
 * box lies inside the other also swallowed a page's main scrolling column
 * whenever it contained a small scrollable block, leaving the popup to offer
 * the block as the page's only region.
 *
 * Uncapped by default: the picker outlines every region, so the count the
 * popup shows before it opens has to be the same number.
 */
export function rankAndDeduplicate(candidates: ScrollCandidateGeometry[], maxResults = Number.POSITIVE_INFINITY): ScrollCandidateGeometry[] {
  const meaningful = candidates.filter(isMeaningfulCandidate);

  // Dedup pass processes smallest-first: when two boxes are near-
  // identical, the smaller one gets added to `kept` first, and the
  // larger near-duplicate (typically an incidental outer wrapper) is
  // then recognized as a duplicate of it and dropped. Processing
  // largest-first would do the opposite (keep the outer wrapper).
  const dedupOrder = [...meaningful].sort((a, b) => visibleArea(a) - visibleArea(b));

  const kept: ScrollCandidateGeometry[] = [];
  for (const candidate of dedupOrder) {
    const isNearDuplicateOfKept = kept.some((existing) => overlapRatio(candidate, existing) >= NEAR_IDENTICAL_OVERLAP_THRESHOLD && overlapRatio(existing, candidate) >= NEAR_IDENTICAL_OVERLAP_THRESHOLD);
    if (!isNearDuplicateOfKept) {
      kept.push(candidate);
    }
  }

  // Presentation order (and what maxResults caps) is largest-first —
  // independent of the dedup pass's own ordering.
  kept.sort((a, b) => {
    const areaDiff = visibleArea(b) - visibleArea(a);
    if (areaDiff !== 0) {
      return areaDiff;
    }
    return scrollDelta(b) - scrollDelta(a);
  });
  return kept.slice(0, maxResults);
}

export type ScrollAreaUiState = { kind: "none" } | { kind: "single" } | { kind: "multiple"; count: number };

/** Maps a deduplicated candidate count to the UX-P2 popup decision (section 7.3). */
export function classifyScrollAreaUiState(deduplicatedCandidates: ScrollCandidateGeometry[]): ScrollAreaUiState {
  if (deduplicatedCandidates.length === 0) {
    return { kind: "none" };
  }
  if (deduplicatedCandidates.length === 1) {
    return { kind: "single" };
  }
  return { kind: "multiple", count: deduplicatedCandidates.length };
}
