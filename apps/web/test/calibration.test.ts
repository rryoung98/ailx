/**
 * Regression tests for the T2 calibration curve (report §13 visual):
 * bins must be computed ONLY from persisted, answered, known-item
 * responses — lapses and unknown items earn no calibration presence
 * (mirror of codex F7's missing-response rule) and nothing is imputed.
 */
import { describe, expect, it } from "vitest";
import { calibrationBins, t2ResponsesFromArtifact } from "../lib/calibration";

const KEYS = { a: 0, b: 1, c: 0 };

describe("t2ResponsesFromArtifact", () => {
  it("returns [] for non-artifact shapes", () => {
    expect(t2ResponsesFromArtifact(null)).toEqual([]);
    expect(t2ResponsesFromArtifact("junk")).toEqual([]);
    expect(t2ResponsesFromArtifact({ responses: "junk" })).toEqual([]);
  });

  it("drops malformed rows and keeps valid ones", () => {
    const rs = t2ResponsesFromArtifact({
      responses: [
        { itemId: "a", choice: 0, confidence: 80, latencyMs: 900 },
        { itemId: 42, choice: 0, confidence: 80 },
        { itemId: "b", choice: "x", confidence: 80 },
        { itemId: "b", choice: 1, confidence: NaN },
        null,
      ],
    });
    expect(rs).toEqual([{ itemId: "a", choice: 0, confidence: 80 }]);
  });
});

describe("calibrationBins", () => {
  it("bins answered responses and measures accuracy per bin", () => {
    const bins = calibrationBins(
      [
        { itemId: "a", choice: 0, confidence: 90 }, // correct, top bin
        { itemId: "b", choice: 0, confidence: 85 }, // wrong, top bin
        { itemId: "c", choice: 0, confidence: 10 }, // correct, bottom bin
      ],
      KEYS,
    );
    // Scored-forecast domain: p = 0.5 + conf/200, bins span [0.5, 1].
    expect(bins).toHaveLength(5);
    expect(bins[4]).toMatchObject({ lo: 0.9, hi: 1, n: 2, accuracy: 0.5 });
    // conf 90 -> p .95, conf 85 -> p .925 → mean .9375
    expect(bins[4].meanConfidence).toBeCloseTo(0.9375);
    // conf 10 -> p .55 lands in the bottom [0.5, 0.6) bin
    expect(bins[0]).toMatchObject({ lo: 0.5, hi: 0.6, n: 1, accuracy: 1 });
    expect(bins[1].n + bins[2].n + bins[3].n).toBe(0);
  });

  it("excludes lapses (choice -1): no calibration credit for silence", () => {
    const bins = calibrationBins([{ itemId: "a", choice: -1, confidence: 0 }], KEYS);
    expect(bins.every((b) => b.n === 0)).toBe(true);
  });

  it("excludes responses for items the instrument does not know", () => {
    const bins = calibrationBins([{ itemId: "ghost", choice: 0, confidence: 99 }], KEYS);
    expect(bins.every((b) => b.n === 0)).toBe(true);
  });

  it("clamps confidence and puts 100 in the top bin (no out-of-range bin)", () => {
    const bins = calibrationBins(
      [
        { itemId: "a", choice: 0, confidence: 100 },
        { itemId: "b", choice: 1, confidence: 250 },
        { itemId: "c", choice: 0, confidence: -5 },
      ],
      KEYS,
    );
    expect(bins[4].n).toBe(2);
    expect(bins[0].n).toBe(1);
    expect(bins[4].meanConfidence).toBeLessThanOrEqual(1);
  });

  it("rejects nonsense bin counts", () => {
    expect(() => calibrationBins([], KEYS, 0)).toThrow();
    expect(() => calibrationBins([], KEYS, 2.5)).toThrow();
  });
});
