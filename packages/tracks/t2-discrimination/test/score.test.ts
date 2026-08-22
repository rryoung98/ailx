import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import { plugin, validateT2Config } from "../src/plugin.js";
import { maxAttainableDPrime, probit, scoreT2 } from "../src/scoring.js";
import { config, items, mixedResponses, perfectResponses, truthBiasResponses } from "./fixtures.js";

const score = (responses: typeof perfectResponses) =>
  runPure(() =>
    plugin.score({ artifact: { responses }, judgments: [], rubricVersion: "test" }, config),
  );

describe("probit", () => {
  it("matches known quantiles", () => {
    expect(probit(0.5)).toBeCloseTo(0, 9);
    expect(probit(0.975)).toBeCloseTo(1.959964, 4);
    expect(probit(0.025)).toBeCloseTo(-1.959964, 4);
    expect(probit(0.841344746)).toBeCloseTo(1.0, 5);
  });
  it("throws outside (0,1)", () => {
    expect(() => probit(0)).toThrow();
    expect(() => probit(1)).toThrow();
  });
});

describe("T2 score()", () => {
  it("is pure under the purity harness (fetch/Date.now/Math.random throw)", () => {
    const s = score(perfectResponses);
    expect(s.scaled).toBeGreaterThan(0);
  });

  it("is deterministic: same inputs, same score", () => {
    expect(score(mixedResponses)).toEqual(score(mixedResponses));
  });

  it("perfect candidate maxes sensitivity and provenance; calibration near-max", () => {
    const s = score(perfectResponses);
    // Log-linear correction (+0.5 every cell, always) caps H at 0.9 and
    // floors F at 0.167 on this small bank: d' = z(.9) - z(.1667) = 2.249.
    expect(s.raw.dPrime).toBeCloseTo(2.249, 3);
    expect(s.raw.sensitivity).toBeCloseTo(44.979, 3);
    expect(s.raw.provenance).toBe(15);
    // confidence 90 -> f = 0.95, all correct -> Brier 0.0025 -> 25 * 0.995
    expect(s.raw.calibration).toBeCloseTo(24.875, 3);
    expect(s.raw.accuracy).toBe(1);
  });

  it("truth bias (call everything authentic) yields zero d-prime, not mid accuracy credit", () => {
    const s = score(truthBiasResponses);
    // Never says "signal": hits = 0 and falseAlarms = 0 -> both rates at the
    // corrected floor -> d' <= 0 (slightly negative on an unbalanced bank),
    // clamped to zero points. Criterion is reported as diagnostic.
    expect(s.raw.dPrime).toBeLessThanOrEqual(0);
    expect(s.raw.sensitivity).toBe(0);
    expect(s.raw.criterion).toBeGreaterThan(0); // conservative criterion
    // Confidently wrong on every signal item hurts Brier hard.
    expect(s.raw.calibration).toBeLessThan(10);
  });

  it("difficulty weights the provenance block", () => {
    // Miss only the HARD provenance item (difficulty 0.8) vs only the
    // MEDIUM one (0.5): the hard miss must cost more.
    const prov = items.filter((i) => i.type === "provenance");
    const hard = prov.find((i) => i.difficulty === 0.8)!;
    const med = prov.find((i) => i.difficulty === 0.5)!;
    const withMiss = (missId: string) =>
      items.map((i) => ({
        itemId: i.id,
        choice: i.id === missId ? (i.key + 1) % i.options.length : i.key,
        confidence: 50,
        latencyMs: 500,
      }));
    const missHard = score(withMiss(hard.id));
    const missMed = score(withMiss(med.id));
    expect(missHard.raw.provenance).toBeLessThan(missMed.raw.provenance);
  });

  it("confidently wrong costs more than uncertainly wrong (Brier)", () => {
    const binary = items.filter((i) => i.type !== "provenance");
    const wrongAt = (conf: number) =>
      items.map((i) => ({
        itemId: i.id,
        choice: i.type === "provenance" ? i.key : (i.key + 1) % 2,
        confidence: i.type === "provenance" ? 50 : conf,
        latencyMs: 500,
      }));
    const sure = score(wrongAt(100));
    const unsure = score(wrongAt(0));
    expect(sure.raw.calibration).toBeLessThan(unsure.raw.calibration);
    expect(binary.length).toBeGreaterThan(0);
  });

  it("missing responses are scored as lapses, deterministically", () => {
    const s = score([]);
    expect(s.raw.accuracy).toBe(0);
    expect(s.scaled).toBeGreaterThanOrEqual(0);
    expect(score([])).toEqual(s);
  });

  it("F7 regression: a fully unanswered deck earns ZERO calibration credit", () => {
    const s = score([]);
    expect(s.raw.answeredBinary).toBe(0);
    expect(s.raw.calibrationCoverage).toBe(0);
    expect(s.raw.calibration).toBe(0);
    // Lapse-only responses (choice -1) are equally unanswered.
    const lapses = items.map((i) => ({ itemId: i.id, choice: -1, confidence: 0, latencyMs: 0 }));
    expect(score(lapses).raw.calibration).toBe(0);
  });

  it("F7: lapsed items are excluded from the Brier mean, not scored as 0.5 forecasts", () => {
    const binary = items.filter((i) => i.type !== "provenance");
    // Answer every binary item correctly at confidence 90, but lapse on one.
    const lapsedId = binary[0].id;
    const responses = items.map((i) =>
      i.id === lapsedId
        ? { itemId: i.id, choice: -1, confidence: 0, latencyMs: 0 }
        : { itemId: i.id, choice: i.key, confidence: 90, latencyMs: 500 },
    );
    const s = score(responses);
    expect(s.raw.answeredBinary).toBe(binary.length - 1);
    // Brier reflects only the answered forecasts: (0.95-1)^2 = 0.0025
    // (reported rounded to 3 decimals).
    expect(s.raw.brier).toBe(0.003);
    // Coverage is full (>= 50% answered), so no extra penalty beyond exclusion.
    expect(s.raw.calibrationCoverage).toBe(1);
  });

  it("F7: answering under half the deck scales calibration weight linearly", () => {
    const binary = items.filter((i) => i.type !== "provenance");
    // Answer exactly 2 of the binary items perfectly, lapse the rest.
    const answered = new Set(binary.slice(0, 2).map((i) => i.id));
    const responses = items
      .filter((i) => i.type !== "provenance")
      .map((i) =>
        answered.has(i.id)
          ? { itemId: i.id, choice: i.key, confidence: 90, latencyMs: 500 }
          : { itemId: i.id, choice: -1, confidence: 0, latencyMs: 0 },
      );
    const s = score(responses);
    const frac = 2 / binary.length;
    expect(frac).toBeLessThan(0.5);
    expect(s.raw.calibrationCoverage).toBeCloseTo(frac / 0.5, 3);
    // Points = weight * (1 - 2*brier) * coverage, strictly below the
    // same-Brier full-coverage score.
    expect(s.raw.calibration).toBeCloseTo(25 * (1 - 2 * 0.0025) * (frac / 0.5), 3);
  });

  it("golden fixture: mixed candidate (pinned — any drift fails the build)", () => {
    const s = score(mixedResponses);
    expect(s).toMatchInlineSnapshot(`
      {
        "raw": {
          "accuracy": 0.667,
          "answeredBinary": 6,
          "brier": 0.297,
          "calibration": 10.167,
          "calibrationCoverage": 1,
          "criterion": 0.484,
          "dPrime": 0.967,
          "falseAlarms": 0,
          "hits": 2,
          "nNoise": 2,
          "nSignal": 4,
          "provenance": 8.182,
          "sensitivity": 19.348,
          "weightedAccuracy": 0.545,
        },
        "scaled": 37.697,
      }
    `);
  });

  it("scoreT2 matches plugin.score", () => {
    const direct = runPure(() => scoreT2({ responses: mixedResponses }, config));
    const viaPlugin = score(mixedResponses);
    expect(viaPlugin.scaled).toBe(direct.scaled);
  });
});

describe("T2 validateConfig", () => {
  it("accepts the fixture config", () => {
    expect(() => validateT2Config(config)).not.toThrow();
  });
  it("rejects empty items", () => {
    expect(() => validateT2Config({ items: [] })).toThrow(/non-empty/);
  });
  it("rejects duplicate ids (content-addressing invariant)", () => {
    expect(() => validateT2Config({ items: [items[0], items[0]] })).toThrow(/duplicate/);
  });
  it("rejects out-of-range keys and difficulty", () => {
    const bad = { ...items[0], key: 9 };
    expect(() => validateT2Config({ items: [bad] })).toThrow(/key/);
    const bad2 = { ...items[0], difficulty: 2 };
    expect(() => validateT2Config({ items: [bad2] })).toThrow(/difficulty/);
  });
  it("rejects binary items without exactly two options", () => {
    const bad = { ...items[0], options: ["a", "b", "c"], key: 0 };
    expect(() => validateT2Config({ items: [bad] })).toThrow(/2 options/);
  });
  it("accepts a positive dPrimeCeiling and rejects non-positive ones", () => {
    expect(validateT2Config({ items: [...items], dPrimeCeiling: 1.9 }).dPrimeCeiling).toBe(1.9);
    expect(validateT2Config({ items: [...items] }).dPrimeCeiling).toBeUndefined();
    expect(() => validateT2Config({ items: [...items], dPrimeCeiling: 0 })).toThrow(/dPrimeCeiling/);
    expect(() => validateT2Config({ items: [...items], dPrimeCeiling: Infinity })).toThrow(/dPrimeCeiling/);
  });
});

describe("lapse rule: silence earns the bad cell in both classes", () => {
  const binary = items.filter((i) => i.type !== "provenance");
  const noise = binary.filter((i) => i.signal !== i.key);
  it("lapsing a noise item is a false alarm, never a free correct rejection", () => {
    const lapseNoise = items.map((i) =>
      i.id === noise[0].id
        ? { itemId: i.id, choice: -1, confidence: 0, latencyMs: 0 }
        : { itemId: i.id, choice: i.key, confidence: 60, latencyMs: 500 },
    );
    const s = score(lapseNoise);
    expect(s.raw.falseAlarms).toBe(1);
    // Strictly worse than answering that item correctly.
    expect(s.raw.sensitivity).toBeLessThan(score(perfectResponses).raw.sensitivity);
  });
  it("lapsing every noise item cannot beat answering the full deck", () => {
    const lapseAllNoise = items.map((i) =>
      noise.some((n) => n.id === i.id)
        ? { itemId: i.id, choice: -1, confidence: 0, latencyMs: 0 }
        : { itemId: i.id, choice: i.key, confidence: 100, latencyMs: 500 },
    );
    expect(score(lapseAllNoise).scaled).toBeLessThan(score(perfectResponses).scaled);
  });
});

describe("deck-aware d′ ceiling", () => {
  it("maxAttainableDPrime matches the corrected cells of a flawless run", () => {
    // 2 signal / 2 noise: H = 2.5/3, F = 0.5/3 → z(.8333) - z(.1667) = 1.935.
    expect(maxAttainableDPrime(2, 2)).toBeCloseTo(1.935, 3);
    expect(maxAttainableDPrime(0, 5)).toBe(0);
  });
  it("cfg.dPrimeCeiling restores full sensitivity points for a perfect run", () => {
    const withCeiling = validateT2Config({
      ...config,
      dPrimeCeiling: maxAttainableDPrime(
        items.filter((i) => i.type !== "provenance" && i.signal === i.key).length,
        items.filter((i) => i.type !== "provenance" && i.signal !== i.key).length,
      ),
    });
    const s = runPure(() =>
      plugin.score({ artifact: { responses: perfectResponses }, judgments: [], rubricVersion: "test" }, withCeiling),
    );
    expect(s.raw.sensitivity).toBeCloseTo(withCeiling.weights.sensitivity, 3);
    // Default (no ceiling) behaviour is unchanged: same run scores lower.
    expect(score(perfectResponses).raw.sensitivity).toBeLessThan(s.raw.sensitivity);
  });
});

describe("T2 plugin shape", () => {
  it("declares apiVersion 2 and a model-free pipeline", () => {
    expect(plugin.apiVersion).toBe(2);
    expect(plugin.id).toBe("t2-discrimination");
    expect(plugin.pipeline(config)).toEqual([]);
  });
  it("exposes a lazy ui() loader resolving to the Runner (F11)", async () => {
    expect(typeof plugin.ui).toBe("function");
    const mod = await plugin.ui!();
    expect(typeof mod.Runner).toBe("function");
  });
  it("ingest is idempotent over the same payload", async () => {
    const ctx = { attemptId: "a1", trackId: "t2-discrimination", locale: "en" as const, emit: async () => {} };
    const session = await plugin.startSession(ctx, config);
    const payload = { kind: "t2-responses", json: { responses: mixedResponses } };
    const a1 = await plugin.ingest(ctx, session, payload);
    const a2 = await plugin.ingest(ctx, session, payload);
    expect(a1).toEqual(a2);
  });
});
