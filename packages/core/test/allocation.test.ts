/**
 * The score allocation is the instrument's point budget and §04's safety
 * claim. Both are numbers, so both get pinned here.
 *
 * These assertions are deliberately blunt. A change to the allocation that
 * breaks one of them is a change somebody should have to defend in a review,
 * not something that lands because a component looked light.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOCATED_TRACK_IDS,
  RESOLUTIONS,
  SCORE_ALLOCATION,
  SCORED_TRACK_IDS,
  TOTAL_POINTS,
  pointsByResolution,
  trackPoints,
  trackPointsByResolution,
  unimplementedPoints,
  weightsFor,
} from "../src/allocation.js";

describe("score allocation", () => {
  it("totals 375 points, the number every report and the spec quote", () => {
    expect(TOTAL_POINTS).toBe(375);
  });

  /**
   * T1 is 135, not 160. The 25-point prompt-log process component was removed
   * on 2026-09-02 (TEN-80): it was monotone in prompt volume, and no published
   * study validates such a score against an independent outcome. The points
   * were removed rather than redistributed — see the T1 comment in
   * `src/allocation.ts`.
   */
  it("allocates 135/80/160 to the three scored tracks and 0 to the showcase", () => {
    expect(trackPoints("t1")).toBe(135);
    expect(trackPoints("t2")).toBe(80);
    expect(trackPoints("t3")).toBe(160);
    expect(trackPoints("t4")).toBe(0);
  });

  it("scores exactly t1, t2 and t3; t4 is a showcase", () => {
    expect([...SCORED_TRACK_IDS]).toEqual(["t1", "t2", "t3"]);
    expect(SCORE_ALLOCATION.t4.scored).toBe(false);
  });

  it("gives every track a composite weight equal to its share of the points", () => {
    for (const t of ALLOCATED_TRACK_IDS) {
      expect(SCORE_ALLOCATION[t].compositeWeight).toBeCloseTo(
        trackPoints(t) / TOTAL_POINTS,
        10,
      );
    }
  });

  it("has scored composite weights summing to exactly 1", () => {
    const sum = SCORED_TRACK_IDS.reduce(
      (s, t) => s + SCORE_ALLOCATION[t].compositeWeight,
      0,
    );
    expect(sum).toBeCloseTo(1, 12);
  });

  it("partitions all 375 points across the four resolution mechanisms", () => {
    const by = pointsByResolution();
    expect(RESOLUTIONS.reduce((s, r) => s + by[r], 0)).toBe(TOTAL_POINTS);
  });

  /**
   * §04's design principle, as a number. Model-free measurement is the
   * majority of the instrument and the LLM jury is a fifth of it; a change
   * that inverts either of those is a change to what AILX claims.
   */
  it("bounds LLM-jury exposure at 80 of 375 and keeps 195 model-free", () => {
    const by = pointsByResolution();
    expect(by["llm-judge"]).toBe(80);
    expect(by["model-free"]).toBe(195);
    expect(by["human-cj"]).toBe(60);
    expect(by["machine-gate"]).toBe(40);
    expect(by["model-free"]).toBeGreaterThan(TOTAL_POINTS / 2);
  });

  it("keeps single-track LLM-jury exposure at or below 45 points", () => {
    for (const t of ALLOCATED_TRACK_IDS) {
      expect(trackPointsByResolution(t, "llm-judge")).toBeLessThanOrEqual(45);
    }
  });

  it("resolves T2 entirely without a model or a rater", () => {
    for (const c of SCORE_ALLOCATION.t2.components) {
      expect(c.resolvedBy).toBe("model-free");
    }
  });

  it("keeps T3's model-free majority — the reliance construct is the track", () => {
    expect(trackPointsByResolution("t3", "model-free")).toBe(115);
    expect(trackPointsByResolution("t3", "model-free")).toBeGreaterThan(
      trackPoints("t3") / 2,
    );
  });

  it("names every unimplemented measurement and the 145 points they cover", () => {
    const missing = ALLOCATED_TRACK_IDS.flatMap((t) =>
      SCORE_ALLOCATION[t].components
        .filter((c) => !c.implemented)
        .map((c) => `${t}.${c.key}`),
    );
    expect(missing.sort()).toEqual([
      "t1.comparative",
      "t1.functional",
      "t3.analysis",
    ]);
    expect(unimplementedPoints()).toBe(145);
  });

  it("requires a note explaining every unimplemented component", () => {
    for (const t of ALLOCATED_TRACK_IDS) {
      for (const c of SCORE_ALLOCATION[t].components) {
        if (!c.implemented) expect(c.note && c.note.length > 20).toBe(true);
      }
    }
  });

  it("uses unique, non-empty component keys within a track", () => {
    for (const t of ALLOCATED_TRACK_IDS) {
      const keys = SCORE_ALLOCATION[t].components.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(k.length).toBeGreaterThan(0);
    }
  });

  it("has no zero-point or negative component", () => {
    for (const t of ALLOCATED_TRACK_IDS) {
      for (const c of SCORE_ALLOCATION[t].components) {
        expect(c.points).toBeGreaterThan(0);
      }
    }
  });

  it("derives track weights keyed by component", () => {
    expect(weightsFor("t2")).toEqual({
      sensitivity: 25,
      criterion: 15,
      calibration: 25,
      provenance: 15,
    });
    expect(weightsFor("t4")).toEqual({});
  });

  /**
   * T1 has no component keyed on the prompt log, and it may not grow one
   * again without this test being deleted in front of a reviewer. The signal
   * itself is still computed and still reported — see the T1 score test's
   * "volume invariance" block.
   */
  it("gives T1 no process component: the prompt log is a diagnostic (TEN-80)", () => {
    expect(weightsFor("t1")).toEqual({
      functional: 40,
      comparative: 60,
      ambition: 20,
      rationale: 15,
    });
  });
});
