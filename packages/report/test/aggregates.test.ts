/**
 * World aggregates: the privacy rules and the honesty rules, asserted as
 * behaviour rather than as documentation.
 */
import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import { TRACK_IDS, type TrackRawScores } from "@ailx/session";
import {
  MIN_COHORT_SIZE,
  SHAPE_BUCKETS,
  shapeBucket,
  worldAggregates,
  type ExposureSummary,
  type WorldAggregateInput,
} from "../src/aggregates.js";

const shape = (t1: number, t2 = t1, t3 = t1, t4 = t1): TrackRawScores => ({ t1, t2, t3, t4 });

const EXPOSURE: ExposureSummary = {
  decksRecorded: 40,
  distinctItems: 120,
  totalExposures: 480,
  meanExposuresPerItem: 4,
  maxExposuresPerItem: 9,
};

function input(n: number, over: Partial<WorldAggregateInput> = {}): WorldAggregateInput {
  const shapes = Array.from({ length: n }, (_, i) => shape(5 + ((i * 7) % 90), 50 + (i % 40), 30 + (i % 60), 70 - (i % 50)));
  return {
    counts: { participants: n, attemptsStarted: n + 5, attemptsFinalized: n },
    shapes,
    exposure: EXPOSURE,
    trend: [
      { period: "2026-02-02", started: Math.ceil((n + 5) / 2), finalized: Math.ceil(n / 2) },
      { period: "2026-02-09", started: Math.floor((n + 5) / 2), finalized: Math.floor(n / 2) },
    ],
    ...over,
  };
}

describe("bucketing", () => {
  it("puts every 0-100 value in a decile, with 100 in the top bucket", () => {
    expect(shapeBucket(0)).toBe(0);
    expect(shapeBucket(9.99)).toBe(0);
    expect(shapeBucket(10)).toBe(1);
    expect(shapeBucket(99.9)).toBe(9);
    expect(shapeBucket(100)).toBe(SHAPE_BUCKETS - 1);
  });

  it("clamps out-of-range values instead of writing outside the array", () => {
    expect(shapeBucket(-40)).toBe(0);
    expect(shapeBucket(1e6)).toBe(SHAPE_BUCKETS - 1);
  });
});

describe("re-identification guard", () => {
  it("suppresses every breakdown below the minimum cohort", () => {
    const out = worldAggregates(input(MIN_COHORT_SIZE - 1));
    expect(out.suppressed).toBe(true);
    expect(out.playerTypes).toBeNull();
    expect(out.tracks).toBeNull();
    expect(out.minCohortSize).toBe(MIN_COHORT_SIZE);
    // Participation counts are population totals, not a split, so they stay.
    expect(out.participation.participants).toBe(MIN_COHORT_SIZE - 1);
  });

  it("publishes breakdowns exactly at the threshold, not one short of it", () => {
    expect(worldAggregates(input(MIN_COHORT_SIZE)).suppressed).toBe(false);
    expect(worldAggregates(input(MIN_COHORT_SIZE)).playerTypes).not.toBeNull();
    expect(worldAggregates(input(MIN_COHORT_SIZE - 1)).tracks).toBeNull();
  });

  it("suppresses a single run completely — one person is never a distribution", () => {
    const out = worldAggregates(input(1));
    expect(out.playerTypes).toBeNull();
    expect(out.tracks).toBeNull();
    expect(JSON.stringify(out)).not.toContain("MSVD");
  });

  it("gates item exposure on its own cohort of recorded decks", () => {
    const thin = { ...EXPOSURE, decksRecorded: MIN_COHORT_SIZE - 1 };
    expect(worldAggregates(input(40, { exposure: thin })).exposure).toBeNull();
    expect(worldAggregates(input(40)).exposure).toEqual(EXPOSURE);
  });

  it("gates the time trend on started attempts", () => {
    const counts = { participants: 2, attemptsStarted: 2, attemptsFinalized: 1 };
    expect(worldAggregates(input(40, { counts })).trend).toBeNull();
    expect(worldAggregates(input(40)).trend).toHaveLength(2);
  });

  it("emits no identifier of any kind — the payload is counts and nothing else", () => {
    const serialized = JSON.stringify(worldAggregates(input(40)));
    // The count KEYS legitimately say "attempts"/"participants"; what must
    // never appear is a reference to one of them.
    for (const forbidden of ["attemptId", "attempt_id", "participantId", "participant_id", "authRef", "auth_ref", "itemId", "item_id", "token", "site", "payload"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no uuid
  });

  it("never emits a percentile, composite or band — the judging pipeline does not exist", () => {
    const serialized = JSON.stringify(worldAggregates(input(40)));
    for (const forbidden of ["percentile", "composite", "band", "Distinction", "Merit", "scaled"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the numbers themselves", () => {
  it("counts a completion rate, and reports null rather than 0/0", () => {
    expect(worldAggregates(input(40)).participation.completionRate).toBeCloseTo(40 / 45, 3);
    const empty = worldAggregates(input(0, { counts: { participants: 0, attemptsStarted: 0, attemptsFinalized: 0 } }));
    expect(empty.participation.completionRate).toBeNull();
    expect(empty.cohortSize).toBe(0);
    expect(empty.suppressed).toBe(true);
  });

  it("histograms every run into exactly one decile per track", () => {
    const out = worldAggregates(input(40));
    for (const track of out.tracks!) {
      expect(track.buckets).toHaveLength(SHAPE_BUCKETS);
      expect(track.buckets.reduce((a, b) => a + b, 0)).toBe(40);
      expect(track.median).toBeGreaterThanOrEqual(0);
      expect(track.median).toBeLessThanOrEqual(100);
    }
    expect(out.tracks!.map((t) => t.track)).toEqual([...TRACK_IDS]);
  });

  it("clamps a stored out-of-range score instead of skewing the histogram", () => {
    const shapes = Array.from({ length: 12 }, () => shape(140, -20, 50, 50));
    const out = worldAggregates(input(12, { shapes }));
    expect(out.tracks![0]!.buckets[SHAPE_BUCKETS - 1]).toBe(12);
    expect(out.tracks![0]!.mean).toBe(100);
    expect(out.tracks![1]!.buckets[0]).toBe(12);
    expect(out.tracks![1]!.mean).toBe(0);
  });

  it("distributes player types, most common first, and shares sum to ~1", () => {
    const shapes = [
      ...Array.from({ length: 8 }, () => shape(95)),
      ...Array.from({ length: 4 }, () => shape(5)),
    ];
    const out = worldAggregates(input(12, { shapes }));
    expect(out.playerTypes![0]!.count).toBe(8);
    expect(out.playerTypes![0]!.code).toMatch(/^[MP][ST][VA][DE]$/);
    expect(out.playerTypes!.reduce((a, b) => a + b.count, 0)).toBe(12);
    expect(out.playerTypes!.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 2);
    expect(out.playerTypes!.every((t) => t.name.length > 0)).toBe(true);
  });

  it("orders equal counts deterministically by code", () => {
    const shapes = [shape(95), shape(5), shape(95), shape(5)].concat(
      Array.from({ length: 8 }, (_, i) => shape(i % 2 === 0 ? 95 : 5)),
    );
    const a = JSON.stringify(worldAggregates(input(12, { shapes })).playerTypes);
    const b = JSON.stringify(worldAggregates(input(12, { shapes: [...shapes].reverse() })).playerTypes);
    expect(a).toBe(b);
  });
});

describe("purity", () => {
  it("runs with no clock, no randomness and no network, byte-identically", () => {
    const once = runPure(() => JSON.stringify(worldAggregates(input(40))));
    const twice = runPure(() => JSON.stringify(worldAggregates(input(40))));
    expect(once).toBe(twice);
  });
});
