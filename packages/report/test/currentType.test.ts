/**
 * `currentType()` — the derivation the profile page reads, and the arithmetic
 * the ADR's §7.2 claims rest on.
 *
 * The cases that matter are the counts: nobody with zero readings gets a type,
 * one and two readings are the reading itself (two points do not average into
 * a trend), and three or more take the mean of the last three with a
 * disagreeing newest run flagged `moving` and rendered undecided.
 */
import { describe, expect, it } from "vitest";
import { TRACK_IDS, type TrackId } from "@ailx/session";

import { CURRENT_TYPE_WINDOW, currentType, type AxisReading, type TypeReading } from "../src/currentType.js";
import { cohortMedians, POLE_UNDECIDED_STRENGTH, isUndecided, playerType, poleAt, poleValue } from "../src/playerType.js";
import { demoCohortRows } from "../src/demo.js";

const axis = (track: TrackId, high: boolean, strength: number): AxisReading => ({
  track,
  high,
  strength,
  evidence: `${track} evidence`,
});

/** A full four-axis reading, every axis on the same side and equally firm. */
const full = (at: string, high: boolean, strength = 70): TypeReading => ({
  at,
  axes: TRACK_IDS.map((t) => axis(t, high, strength)),
});

describe("currentType over a history", () => {
  it("has no answer for a person with no readings", () => {
    expect(currentType([])).toBeNull();
  });

  it("reads ONE full run back unchanged, and says it read one run", () => {
    const current = currentType([full("2026-03-01T00:00:00.000Z", true, 72)]);
    expect(current).not.toBeNull();
    expect(current?.runCount).toBe(1);
    expect(current?.code).toBe("MSVD");
    expect(current?.partial).toBe(false);
    expect(current?.axes.map((a) => a.strength)).toEqual([72, 72, 72, 72]);
    expect(current?.movingAxes).toEqual([]);
    expect(current?.at).toBe("2026-03-01T00:00:00.000Z");
  });

  it("does NOT smooth two runs — the newest one stands, and nothing is flagged", () => {
    const current = currentType([
      full("2026-03-01T00:00:00.000Z", true, 80),
      full("2026-02-01T00:00:00.000Z", false, 80),
    ]);
    expect(current?.runCount).toBe(1);
    expect(current?.code).toBe("MSVD");
    expect(current?.movingAxes).toEqual([]);
    // Movement is still VISIBLE without being averaged: the axis says what it
    // held last time.
    expect(current?.axes.every((a) => a.previousLetter !== a.letter)).toBe(true);
  });

  it("takes the mean of the last THREE, and lets an older run move the letter", () => {
    // Two firm low runs and one weak high run: the mean is low, so the letter
    // is the low one and the newest run disagrees.
    const readings: TypeReading[] = [
      { at: "2026-03-03T00:00:00.000Z", axes: TRACK_IDS.map((t) => axis(t, true, 52)) },
      { at: "2026-03-02T00:00:00.000Z", axes: TRACK_IDS.map((t) => axis(t, false, 90)) },
      { at: "2026-03-01T00:00:00.000Z", axes: TRACK_IDS.map((t) => axis(t, false, 90)) },
    ];
    const current = currentType(readings);
    expect(current?.runCount).toBe(CURRENT_TYPE_WINDOW);
    expect(current?.code).toBe("PTAE");
    // mean position = (0.52 + 0.10 + 0.10) / 3 = 0.24 -> strength 76 on the low pole
    expect(current?.axes.map((a) => a.strength)).toEqual([76, 76, 76, 76]);
  });

  it("flags a disagreeing NEWEST run as moving, and renders it undecided whatever its strength", () => {
    const readings: TypeReading[] = [
      { at: "2026-03-03T00:00:00.000Z", axes: TRACK_IDS.map((t) => axis(t, true, 52)) },
      { at: "2026-03-02T00:00:00.000Z", axes: TRACK_IDS.map((t) => axis(t, false, 90)) },
      { at: "2026-03-01T00:00:00.000Z", axes: TRACK_IDS.map((t) => axis(t, false, 90)) },
    ];
    const current = currentType(readings);
    expect(current?.movingAxes).toEqual([...TRACK_IDS]);
    // The mean reads 76 — comfortably over the threshold — and the axis is
    // STILL undecided, because the newest run said the other letter.
    for (const pole of current?.axes ?? []) {
      expect(pole.strength).toBeGreaterThan(POLE_UNDECIDED_STRENGTH);
      expect(pole.moving).toBe(true);
      expect(pole.undecided).toBe(true);
    }
  });

  it("flags nothing when three runs agree", () => {
    const current = currentType([
      full("2026-03-03T00:00:00.000Z", true, 80),
      full("2026-03-02T00:00:00.000Z", true, 70),
      full("2026-03-01T00:00:00.000Z", true, 90),
    ]);
    expect(current?.movingAxes).toEqual([]);
    expect(current?.axes.every((a) => a.moving)).toBe(false);
    expect(current?.axes.map((a) => a.strength)).toEqual([80, 80, 80, 80]);
  });

  it("reads FOUR runs from the newest three, and forgets the fourth", () => {
    const window3 = [
      full("2026-03-04T00:00:00.000Z", true, 80),
      full("2026-03-03T00:00:00.000Z", true, 80),
      full("2026-03-02T00:00:00.000Z", true, 80),
    ];
    const withOldOutlier = [...window3, full("2026-01-01T00:00:00.000Z", false, 100)];
    expect(currentType(withOldOutlier)).toEqual(currentType(window3));
  });

  it("sorts the history itself rather than trusting the order it was handed", () => {
    const ordered = [
      full("2026-03-03T00:00:00.000Z", true, 80),
      full("2026-03-02T00:00:00.000Z", false, 60),
      full("2026-03-01T00:00:00.000Z", true, 70),
    ];
    const shuffled = [ordered[1], ordered[2], ordered[0]];
    expect(currentType(shuffled)).toEqual(currentType(ordered));
  });

  it("marks a weak axis undecided without any disagreement at all", () => {
    const weak = currentType([
      {
        at: "2026-03-01T00:00:00.000Z",
        axes: [axis("t1", true, 51), axis("t2", true, 80), axis("t3", true, 80), axis("t4", true, 80)],
      },
    ]);
    expect(weak?.axes[0]).toMatchObject({ track: "t1", undecided: true, moving: false });
    expect(weak?.axes[1].undecided).toBe(false);
  });
});

describe("a PARTIAL reading is a different object", () => {
  const partial: TypeReading = {
    at: "2026-03-01T00:00:00.000Z",
    axes: [axis("t2", true, 80), axis("t3", false, 70)],
  };

  it("carries no code and no character name, and is never invented into four", () => {
    const current = currentType([partial]);
    expect(current?.partial).toBe(true);
    expect(current?.axisCount).toBe(2);
    expect(current?.code).toBeNull();
    expect(current?.name).toBeNull();
    expect(current?.tagline).toBeNull();
    expect(current?.axes.map((a) => a.track)).toEqual(["t2", "t3"]);
  });

  it("never outranks a full reading, however new it is", () => {
    const current = currentType([
      { ...partial, at: "2026-06-01T00:00:00.000Z" },
      full("2026-03-01T00:00:00.000Z", true, 70),
    ]);
    expect(current?.partial).toBe(false);
    expect(current?.code).toBe("MSVD");
    expect(current?.runCount).toBe(1);
  });

  it("is not counted into the three-run window", () => {
    const current = currentType([
      { ...partial, at: "2026-03-04T00:00:00.000Z" },
      full("2026-03-03T00:00:00.000Z", true, 80),
      full("2026-03-02T00:00:00.000Z", true, 80),
    ]);
    expect(current?.runCount).toBe(1);
    expect(current?.partial).toBe(false);
  });
});

describe("readings that are not readings", () => {
  it("drops an axis with no usable strength, and a reading with no usable axis", () => {
    expect(currentType([{ at: "2026-03-01T00:00:00.000Z", axes: [] }])).toBeNull();
    const broken = { at: "2026-03-01T00:00:00.000Z", axes: [{ track: "t9", high: true, strength: 70, evidence: "" }] };
    expect(currentType([broken as unknown as TypeReading])).toBeNull();
  });

  it("reads a duplicated track once, and never averages an axis with itself", () => {
    const current = currentType([
      { at: "2026-03-01T00:00:00.000Z", axes: [axis("t2", true, 80), axis("t2", false, 90)] },
    ]);
    expect(current?.axisCount).toBe(1);
    expect(current?.axes[0]).toMatchObject({ track: "t2", letter: "S", strength: 80 });
  });
});

describe("the undecided threshold", () => {
  /**
   * The number in the ADR, recomputed from the cohort it was derived on. On
   * the fallback path `strength = 50 + (score - median) / 2`, so a quarter of
   * a standard deviation maps to a strength per track; 55 must cover all four.
   * If the demo cohort ever moves under this, the threshold is wrong and this
   * fails rather than the document quietly ageing.
   */
  it("covers 0.25 SD on every track, with one number instead of four", () => {
    const rows = demoCohortRows();
    const med = cohortMedians();
    for (const track of TRACK_IDS) {
      const values = rows.map((r) => r[track]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sd = Math.sqrt(
        values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1),
      );
      const strengthAtQuarterSd = 50 + (0.25 * sd) / 2;
      expect(strengthAtQuarterSd).toBeLessThan(POLE_UNDECIDED_STRENGTH);
      expect(med[track]).toBeGreaterThan(0);
    }
  });

  it("reads a pole with NO strength as undecided, never as 50", () => {
    expect(isUndecided({ strength: undefined })).toBe(true);
    expect(isUndecided({ strength: null })).toBe(true);
    expect(isUndecided({ strength: POLE_UNDECIDED_STRENGTH - 1 })).toBe(true);
    expect(isUndecided({ strength: POLE_UNDECIDED_STRENGTH })).toBe(false);
  });
});

describe("poleAt and poleValue", () => {
  it("are the one place a position becomes a letter, and they round-trip", () => {
    for (const value of [0, 0.1, 0.25, 0.5, 0.62, 0.9, 1]) {
      const pole = poleAt("t2", value, "e");
      expect(poleValue(pole)).toBeCloseTo(value, 2);
    }
  });

  it("decide the same letters `playerType` decides", () => {
    const type = playerType({ t1: 88.24, t2: 79.5, t3: 71.06, t4: 66.9 });
    for (const pole of type.poles) {
      expect(poleAt(pole.track, poleValue(pole), pole.evidence)).toEqual(pole);
    }
  });
});
