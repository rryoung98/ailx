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
  it("totals 400 points, the number every report and the spec quote", () => {
    expect(TOTAL_POINTS).toBe(400);
  });

  it("allocates 160/80/160 to the three scored tracks and 0 to the showcase", () => {
    expect(trackPoints("t1")).toBe(160);
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

  it("partitions all 400 points across the four resolution mechanisms", () => {
    const by = pointsByResolution();
    expect(RESOLUTIONS.reduce((s, r) => s + by[r], 0)).toBe(TOTAL_POINTS);
  });

  /**
   * §04's design principle, as a number. Model-free measurement is the
   * majority of the instrument and the LLM jury is a fifth of it; a change
   * that inverts either of those is a change to what AILX claims.
   */
  it("bounds LLM-jury exposure at 80 of 400 and keeps 220 model-free", () => {
    const by = pointsByResolution();
    expect(by["llm-judge"]).toBe(80);
    expect(by["model-free"]).toBe(220);
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
});
