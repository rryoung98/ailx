import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import { plugin, validateT2Config } from "../src/plugin.js";
import { probit, scoreT2 } from "../src/scoring.js";
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

  it("golden fixture: mixed candidate (pinned — any drift fails the build)", () => {
    const s = score(mixedResponses);
    expect(s).toMatchInlineSnapshot(`
      {
        "raw": {
          "accuracy": 0.667,
          "brier": 0.297,
          "calibration": 10.167,
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
});

describe("T2 plugin shape", () => {
  it("declares apiVersion 2 and a model-free pipeline", () => {
    expect(plugin.apiVersion).toBe(2);
    expect(plugin.id).toBe("t2-discrimination");
    expect(plugin.pipeline(config)).toEqual([]);
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
