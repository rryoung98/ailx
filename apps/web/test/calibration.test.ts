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
    expect(bins).toHaveLength(5);
    expect(bins[4]).toMatchObject({ lo: 80, hi: 100, n: 2, accuracy: 0.5 });
    expect(bins[4].meanConfidence).toBeCloseTo(0.875);
    expect(bins[0]).toMatchObject({ lo: 0, hi: 20, n: 1, accuracy: 1 });
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
