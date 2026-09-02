import { describe, expect, it } from "vitest";
import { runPure, judgmentArrivalOrders } from "@ailx/core";
import type { Judgment } from "@ailx/core";
import { plugin, validateT3Config } from "../src/plugin.js";
import {
  adoptionCreditForClaim, relianceBand, relianceIndex, revisionChainLength, scoreT3,
  verifiedClaimIds, RELIANCE_CALIBRATED_BAND, OVER_RELIANCE_MIN_SURFACED,
} from "../src/scoring.js";
import {
  config, credulousTranscript, goodAnswer, goodTranscript,
  juryJudgments, overRejectTranscript, shortAnswer,
} from "./fixtures.js";
import { T3_DEFAULT_WEIGHTS, T3_TOTAL_POINTS, type T3Turn } from "../src/types.js";

const score = (transcript: readonly T3Turn[], finalAnswer: string, judgments: Judgment[] = juryJudgments) =>
  runPure(() =>
    plugin.score(
      { artifact: { transcript, finalAnswer }, judgments, rubricVersion: "test" },
      config,
    ),
  );

function blindShift(turns: T3Turn[]): T3Turn[] {
  return turns.map((t, i) => ({ ...t, seq: i + 1 }));
}

describe("T3 score()", () => {
  it("is pure under the purity harness and deterministic", () => {
    const a = score(goodTranscript, goodAnswer);
    const b = score(goodTranscript, goodAnswer);
    expect(a).toEqual(b);
  });

  it("strong candidate: both reliance tails full, and process; analysis from stored jury", () => {
    const s = score(goodTranscript, goodAnswer);
    expect(s.raw.overReliance).toBe(50);        // caught 3/3 surfaced planted errors
    expect(s.raw.underReliance).toBe(30);       // deliberated then adopted 2/2 correct-advice claims
    expect(s.raw.adviceDeliberated).toBe(2);
    expect(s.raw.process).toBe(35);    // 3 prompts, chain 2, 3 verifies, full deliberation
    // normalized jury mean 0.7333 -> 45 * 0.7333 = 33
    expect(s.raw.analysis).toBe(33);
    expect(s.scaled).toBe(148);
    expect(s.raw.plantedCaught).toBe(3);
    expect(s.raw.revisionChainLength).toBe(2);
  });

  it("credulous candidate: accepted planted errors score zero over-reliance points", () => {
    const s = score(credulousTranscript, goodAnswer);
    expect(s.raw.overReliance).toBe(0);              // 2 planted surfaced, 0 challenged
    expect(s.raw.plantedSurfaced).toBe(2);
    expect(s.raw.plantedCaught).toBe(0);
    expect(s.raw.verificationCount).toBe(0);
    expect(s.raw.process).toBeLessThan(config.weights.process / 2); // no verification, no revision chain
    // F5: blind instant accept of the one correct claim — HALF credit only.
    expect(s.raw.underReliance).toBe(config.weights.underReliance / 2);
    expect(s.raw.adviceDeliberated).toBe(0);
  });

  it("F5 regression: assisted followed directly by accepted earns < full adoption credit", () => {
    // The review's read-only probe: an 'assisted' event followed immediately
    // by 'accepted' used to earn the full adoption credit.
    const blind: T3Turn[] = [
      { verb: "assisted", object: "assist:1", text: "…", claimIds: ["ca-cluster"], seq: 0, clientTs: "2026-02-01T10:00:00Z" },
      { verb: "accepted", object: "claim:ca-cluster", seq: 1, clientTs: "2026-02-01T10:00:01Z" },
    ];
    const s = score(blind, goodAnswer);
    expect(s.raw.underReliance).toBeLessThan(config.weights.underReliance);
    expect(s.raw.underReliance).toBe(config.weights.underReliance / 2);
    expect(adoptionCreditForClaim(blind, "ca-cluster")).toBe(0.5);
  });

  it("F5: verifying THAT claim between surfacing and acceptance restores full credit", () => {
    const deliberate: T3Turn[] = [
      { verb: "assisted", object: "assist:1", text: "…", claimIds: ["ca-cluster"], seq: 0, clientTs: "2026-02-01T10:00:00Z" },
      { verb: "verified", object: "claim:ca-cluster", claimIds: ["ca-cluster"], seq: 1, clientTs: "2026-02-01T10:01:00Z" },
      { verb: "accepted", object: "claim:ca-cluster", seq: 2, clientTs: "2026-02-01T10:02:00Z" },
    ];
    expect(adoptionCreditForClaim(deliberate, "ca-cluster")).toBe(1);
    expect(score(deliberate, goodAnswer).raw.underReliance).toBe(config.weights.underReliance);
    // A verify that happened BEFORE the claim surfaced is not deliberation
    // on that claim.
    const staleVerify: T3Turn[] = [
      { verb: "verified", object: "claim:ca-cluster", claimIds: ["ca-cluster"], seq: 0, clientTs: "2026-02-01T09:59:00Z" },
      ...blindShift(deliberate.filter((t) => t.verb !== "verified")),
    ];
    expect(adoptionCreditForClaim(staleVerify, "ca-cluster")).toBe(0.5);
  });

  it("F5: a verification of ANOTHER claim is not deliberation on this one", () => {
    const elsewhere: T3Turn[] = [
      { verb: "assisted", object: "assist:1", text: "…", claimIds: ["ca-cluster", "ca-equity"], seq: 0, clientTs: "2026-02-01T10:00:00Z" },
      { verb: "verified", object: "claim:ca-equity", claimIds: ["ca-equity"], seq: 1, clientTs: "2026-02-01T10:01:00Z" },
      { verb: "accepted", object: "claim:ca-cluster", seq: 2, clientTs: "2026-02-01T10:02:00Z" },
    ];
    expect(adoptionCreditForClaim(elsewhere, "ca-cluster")).toBe(0.5);
  });

  it("F5: pressing an unattributed verify button buys no process points", () => {
    // The dogfood exploit: five presses of one track-wide button, with no
    // claim surfaced and no source read, used to pay a full quarter of the
    // 20-point Process component.
    const spam: T3Turn[] = [0, 1, 2, 3, 4].map((i) => ({
      verb: "verified" as const, object: "source", seq: i, clientTs: `2026-02-01T10:0${i}:00Z`,
    }));
    expect(verifiedClaimIds(spam).size).toBe(0);
    expect(score(spam, goodAnswer).raw.verificationCount).toBe(0);
    // Same run, same clicks, but nothing was checked: the verification
    // quarter of Process stays unpaid (only the deliberation term can pay,
    // and no claim was surfaced either).
    expect(score(spam, goodAnswer).raw.process).toBe(0);
  });

  it("F5: verification counts DISTINCT surfaced claims, never clicks", () => {
    const base: T3Turn[] = [
      { verb: "assisted", object: "assist:1", text: "…", claimIds: ["ca-cluster", "ca-equity"], seq: 0, clientTs: "2026-02-01T10:00:00Z" },
    ];
    const repeat: T3Turn[] = [
      ...base,
      ...[1, 2, 3].map((i) => ({
        verb: "verified" as const, object: "claim:ca-cluster", claimIds: ["ca-cluster"],
        seq: i, clientTs: `2026-02-01T10:0${i}:00Z`,
      })),
    ];
    expect([...verifiedClaimIds(repeat)]).toEqual(["ca-cluster"]);
    const two: T3Turn[] = [
      ...repeat,
      { verb: "verified", object: "claim:ca-equity", claimIds: ["ca-equity"], seq: 4, clientTs: "2026-02-01T10:04:00Z" },
    ];
    expect(verifiedClaimIds(two).size).toBe(2);
    // TEN-30: neither run pays. Checking two claims used to max out the
    // verification quarter on its own; now a check pays only once the
    // candidate resolves the claim, and neither run takes a stance.
    expect(score(two, goodAnswer).raw.process).toBe(score(repeat, goodAnswer).raw.process);
    expect(score(two, goodAnswer).raw.discriminatingVerifications).toBe(0);
    // The volume count is still recorded, and still counts claims not clicks.
    expect(score(two, goodAnswer).raw.verificationCount).toBe(2);
    expect(score(repeat, goodAnswer).raw.verificationCount).toBe(1);
  });

  it("F5: a claim that never surfaced cannot be verified", () => {
    const ghost: T3Turn[] = [
      { verb: "verified", object: "claim:never-said", claimIds: ["never-said"], seq: 0, clientTs: "2026-02-01T10:00:00Z" },
    ];
    expect(verifiedClaimIds(ghost).size).toBe(0);
  });

  it("over-rejection is a failure too: challenging correct advice pays no adoption credit", () => {
    const s = score(overRejectTranscript, goodAnswer);
    expect(s.raw.overReliance).toBe(config.weights.overReliance);
    expect(s.raw.underReliance).toBe(0);
    // The two-tailed read: perfect non-reliance, total under-reliance.
    expect(s.raw["reliance.over"]).toBe(0);
    expect(s.raw["reliance.under"]).toBe(1);
    expect(s.raw["reliance.index"]).toBe(1);
  });

  it("last stance wins: challenge then accept counts as accepted (and IS deliberation)", () => {
    const flip: T3Turn[] = [
      ...credulousTranscript,
      { verb: "challenged", object: "claim:ca-cluster", seq: 100, clientTs: "2026-02-01T10:00:00Z" },
      { verb: "accepted", object: "claim:ca-cluster", seq: 101, clientTs: "2026-02-01T10:01:00Z" },
    ];
    const s = score(flip, goodAnswer);
    expect(s.raw.adviceAdopted).toBe(1);
    // Challenged before the final accept -> resistance shown -> full credit.
    expect(s.raw.underReliance).toBe(config.weights.underReliance);
    expect(s.raw.adviceDeliberated).toBe(1);
  });

  it("F6 regression: out-of-range stored judgment values throw, never inflate", () => {
    const bad = (value: number): Judgment[] => [
      { dimension: "analysis", sample: 0, value, modelId: "evil@1" },
    ];
    // The review probe: a stored value of 50 produced 450 analysis points.
    expect(() => score(goodTranscript, goodAnswer, bad(50))).toThrow(/out of range/);
    expect(() => score(goodTranscript, goodAnswer, bad(4))).toThrow(/out of range/);
    expect(() => score(goodTranscript, goodAnswer, bad(1.001))).toThrow(/out of range/);
    expect(() => score(goodTranscript, goodAnswer, bad(-0.1))).toThrow(/out of range/);
    expect(() => score(goodTranscript, goodAnswer, bad(Number.NaN))).toThrow(/out of range/);
  });

  it("F6: analysis is capped at its 45-point allocation and the length gate at 1", () => {
    const maxed: Judgment[] = [0, 1, 2].map((sample) => ({
      dimension: "analysis", sample, value: 1, modelId: "demo-judge@1",
    }));
    const longAnswer = ("word ".repeat(config.minWords * 3)).trim(); // 3x minWords
    const s = score(goodTranscript, longAnswer, maxed);
    expect(s.raw.analysis).toBe(45);
    expect(s.raw["analysis.lengthGate"]).toBe(1); // capped: length never adds credit
  });

  it("analysis length gate is declared: reported in raw and only withholds", () => {
    const full = score(goodTranscript, goodAnswer);
    const short = score(goodTranscript, shortAnswer);
    expect(short.raw.analysis).toBeLessThan(full.raw.analysis);
    expect(short.raw.wordCount).toBe(3);
    expect(short.raw["analysis.lengthGate"]).toBeCloseTo(3 / config.minWords, 3);
    expect(full.raw["analysis.lengthGate"]).toBe(1);
  });

  it("no judgments stored -> zero analysis points (never judged here)", () => {
    const s = score(goodTranscript, goodAnswer, []);
    expect(s.raw.analysis).toBe(0);
    expect(s.raw.meanJuryBand).toBe(0);
  });

  it("empty transcript scores zero across behavioural dimensions", () => {
    const s = score([], "", []);
    expect(s.scaled).toBe(0);
  });

  it("golden fixture: strong candidate (pinned — drift fails the build)", () => {
    expect(score(goodTranscript, goodAnswer)).toMatchInlineSnapshot(`
      {
        "raw": {
          "adviceAdopted": 2,
          "adviceDeliberated": 2,
          "adviceSurfaced": 2,
          "analysis": 33,
          "analysis.lengthGate": 1,
          "condition.timeBudgetMinutes": 0,
          "deliberationRate": 1,
          "discriminatingVerificationRate": 1,
          "discriminatingVerifications": 4,
          "jurySpread": 0.2,
          "meanJuryBand": 0.733,
          "overReliance": 50,
          "overReliance.underpowered": 1,
          "plantedCaught": 3,
          "plantedSurfaced": 3,
          "process": 35,
          "promptCount": 3,
          "reliance.index": 0,
          "reliance.over": 0,
          "reliance.under": 0,
          "revisionChainLength": 2,
          "underReliance": 30,
          "verificationCount": 4,
          "verificationsChecked": 4,
          "wordCount": 192,
        },
        "scaled": 148,
      }
    `);
  });

  it("golden fixture: credulous candidate (pinned)", () => {
    expect(score(credulousTranscript, goodAnswer)).toMatchInlineSnapshot(`
      {
        "raw": {
          "adviceAdopted": 1,
          "adviceDeliberated": 0,
          "adviceSurfaced": 1,
          "analysis": 33,
          "analysis.lengthGate": 1,
          "condition.timeBudgetMinutes": 0,
          "deliberationRate": 1,
          "discriminatingVerificationRate": 0,
          "discriminatingVerifications": 0,
          "jurySpread": 0.2,
          "meanJuryBand": 0.733,
          "overReliance": 0,
          "overReliance.underpowered": 1,
          "plantedCaught": 0,
          "plantedSurfaced": 2,
          "process": 11.667,
          "promptCount": 1,
          "reliance.index": -1,
          "reliance.over": 1,
          "reliance.under": 0,
          "revisionChainLength": 0,
          "underReliance": 15,
          "verificationCount": 0,
          "verificationsChecked": 0,
          "wordCount": 192,
        },
        "scaled": 59.667,
      }
    `);
  });
});

describe("revisionChainLength", () => {
  it("follows revision_of links and ignores cycles", () => {
    expect(revisionChainLength(goodTranscript)).toBe(2);
    const cyclic: T3Turn[] = [
      { verb: "revised", object: "a", revisionOf: "b", seq: 0, clientTs: "t" },
      { verb: "revised", object: "b", revisionOf: "a", seq: 1, clientTs: "t" },
    ];
    expect(revisionChainLength(cyclic)).toBeLessThanOrEqual(2);
  });
});

describe("T3 validateConfig", () => {
  it("accepts the fixture config", () => {
    expect(() => validateT3Config(config)).not.toThrow();
  });
  it("requires planted errors — the mechanism IS the track", () => {
    expect(() => validateT3Config({ ...config, plantedErrors: [] })).toThrow(/plantedErrors/);
  });
  it("rejects duplicate claim ids across planted and advice", () => {
    const dupe = {
      ...config,
      correctAdvice: [{ id: "pe-figure", topic: "x", claim: "y" }],
    };
    expect(() => validateT3Config(dupe)).toThrow(/duplicate/);
  });
  it("defaults minWords and weights per the spec allocation", () => {
    const { minWords: _m, weights: _w, ...rest } = config as Record<string, unknown> & typeof config;
    const parsed = validateT3Config(rest);
    expect(parsed.minWords).toBe(1200);
    // Read from the ONE allocation table, so a re-weighting cannot leave the
    // validator handing out last year's defaults.
    expect(parsed.weights).toEqual(T3_DEFAULT_WEIGHTS);
    expect(parsed.weights).toEqual({ overReliance: 50, underReliance: 30, process: 35, analysis: 45 });
    expect(T3_TOTAL_POINTS).toBe(160);
  });
});

/**
 * The two-tailed reliance index — T3's named construct. Over-reliance
 * (swallowing the model's errors) and under-reliance (refusing its correct
 * help) are BOTH failures, so a one-directional scale would be wrong.
 */
describe("reliance index", () => {
  it("is zero and calibrated when both tails are clean", () => {
    expect(relianceIndex(8, 8, 4, 4)).toEqual({
      over: 0, under: 0, index: 0, band: "calibrated",
    });
  });

  it("goes NEGATIVE for over-reliance — swallowed the planted errors", () => {
    const r = relianceIndex(8, 0, 4, 4);
    expect(r.over).toBe(1);
    expect(r.under).toBe(0);
    expect(r.index).toBe(-1);
    expect(r.band).toBe("over-reliant");
  });

  it("goes POSITIVE for under-reliance — refused the correct advice", () => {
    const r = relianceIndex(8, 8, 4, 0);
    expect(r.index).toBe(1);
    expect(r.band).toBe("under-reliant");
  });

  it("is symmetric: mirrored failures give mirrored indices", () => {
    expect(relianceIndex(8, 4, 4, 4).index).toBeCloseTo(
      -relianceIndex(8, 8, 4, 2).index,
      12,
    );
  });

  /**
   * The trap in a difference score, and the reason `band` does not read the
   * index alone. Failing in BOTH directions averages to zero.
   */
  it("does not call a candidate who fails both ways 'calibrated'", () => {
    const bothWays = relianceIndex(8, 0, 4, 0);
    expect(bothWays.index).toBe(0);
    expect(bothWays.band).not.toBe("calibrated");
    expect(bothWays.band).toBe("over-reliant"); // the larger failure names it
  });

  it("names the LARGER failure when both tails are large", () => {
    expect(relianceBand(1, 0.8)).toBe("over-reliant");
    expect(relianceBand(0.8, 1)).toBe("under-reliant");
  });

  it("tolerates a small imbalance inside the declared band", () => {
    expect(RELIANCE_CALIBRATED_BAND).toBe(0.25);
    expect(relianceBand(0.25, 0)).toBe("calibrated");
    expect(relianceBand(0.26, 0)).toBe("over-reliant");
  });

  it("reads zero on a tail with nothing surfaced, rather than dividing by zero", () => {
    expect(relianceIndex(0, 0, 0, 0)).toEqual({
      over: 0, under: 0, index: 0, band: "calibrated",
    });
  });

  it("is reported in raw on every sitting, both tails and the index", () => {
    const s = score(credulousTranscript, goodAnswer);
    // 2 planted surfaced, 0 challenged -> fully over-reliant on that tail.
    expect(s.raw["reliance.over"]).toBe(1);
    expect(s.raw["reliance.index"]).toBeLessThan(0);
  });

  it("comes back from scoreT3 as a banded object, not only as raw numbers", () => {
    const r = runPure(() =>
      scoreT3({ transcript: credulousTranscript, finalAnswer: goodAnswer }, juryJudgments, config),
    );
    expect(r.reliance.band).toBe("over-reliant");
    expect(r.reliance.index).toBe(r.raw["reliance.index"]);
  });
});

/**
 * The over-reliance component carries 50 of 160 points on a subtest whose
 * item count is the number of planted errors the form surfaced. Four cannot
 * support that: catching 2 of 4 versus 3 of 4 is 12.5 points decided by one
 * event.
 */
describe("over-reliance power", () => {
  it("declares a minimum surfaced-plant count of 8", () => {
    expect(OVER_RELIANCE_MIN_SURFACED).toBe(8);
  });

  it("flags a sitting that surfaced fewer plants than the declared minimum", () => {
    const s = score(goodTranscript, goodAnswer); // fixture surfaces 3
    expect(s.raw.plantedSurfaced).toBeLessThan(OVER_RELIANCE_MIN_SURFACED);
    expect(s.raw["overReliance.underpowered"]).toBe(1);
  });

  it("clears the flag once enough plants surface", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `pe-${i}`);
    const cfg = {
      ...config,
      plantedErrors: ids.map((id) => ({ id, topic: id, claim: id, truth: id })),
    };
    const transcript: T3Turn[] = [
      { verb: "assisted", object: "assist:1", claimIds: ids, seq: 0, clientTs: "t" },
      ...ids.map((id, i) => ({
        verb: "challenged" as const, object: `claim:${id}`, seq: i + 1, clientTs: "t",
      })),
    ];
    const s = runPure(() =>
      scoreT3({ transcript, finalAnswer: goodAnswer }, juryJudgments, cfg),
    );
    expect(s.raw.plantedSurfaced).toBe(8);
    expect(s.raw["overReliance.underpowered"]).toBe(0);
    expect(s.raw.overReliance).toBe(config.weights.overReliance);
  });
});

describe("T3 plugin shape", () => {
  it("declares apiVersion 2 and a judge pipeline stage", () => {
    expect(plugin.apiVersion).toBe(2);
    expect(plugin.id).toBe("t3-reasoning");
    expect(plugin.pipeline(config)).toEqual([
      { id: "judge-t3-analysis", queue: "judge", maxAttempts: 3 },
    ]);
  });
  it("ingest is idempotent and validates verbs", async () => {
    const ctx = { attemptId: "a1", trackId: "t3-reasoning", locale: "en" as const, emit: async () => {} };
    const session = await plugin.startSession(ctx, config);
    const payload = { kind: "t3-transcript", json: { transcript: goodTranscript, finalAnswer: goodAnswer } };
    const a1 = await plugin.ingest(ctx, session, payload);
    const a2 = await plugin.ingest(ctx, session, payload);
    expect(a1).toEqual(a2);
    await expect(
      plugin.ingest(ctx, session, {
        kind: "t3-transcript",
        json: { transcript: [{ verb: "hacked", object: "x" }], finalAnswer: "" },
      }),
    ).rejects.toThrow(/unknown verb/);
  });
});

/**
 * ORDER INVARIANCE — the property that makes "byte-identically recomputable
 * from stored inputs" true for T3.
 *
 * The analysis component averages the stored jury rows, floating-point
 * addition is not associative, and a SQL read without ORDER BY has no
 * guaranteed row order. Before the fix, a permuted read of three legal values
 * moved the mean in the last bit and could move `scaled` after round3.
 */
describe("scoreT3 is order-invariant over stored jury rows", () => {
  const canonical = (s: unknown) => JSON.stringify(s);

  it("gives byte-identical output for EVERY arrival order of the real fixture", () => {
    const expected = canonical(score(goodTranscript, goodAnswer, juryJudgments));
    for (const order of judgmentArrivalOrders(juryJudgments)) {
      expect(canonical(score(goodTranscript, goodAnswer, [...order]))).toBe(expected);
    }
  });

  /**
   * KNOWN-SHARP fixture, and the one that survives round3.
   *
   * These three legal jury values sum differently by permutation AND the
   * difference crosses a rounding boundary: naively averaged they score the
   * analysis component 25.247 in two of the six arrival orders and 25.248 in
   * the other four, i.e. a sitting whose score of record depends on which
   * rows the database happened to hand back first. The first two assertions
   * PROVE the fixture is still sharp, so this test cannot go quietly blunt.
   */
  it("gives byte-identical output on values that DIVERGE past round3 naively", () => {
    const sharp = [0.69, 0.41, 0.5831666666666665];
    const naive = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
    const round3 = (x: number) => Math.round(x * 1000) / 1000;
    const naiveAnalysis = new Set(
      judgmentArrivalOrders(
        sharp.map((value, i) => ({ dimension: "analysis", sample: i, value, modelId: `m${i}@1` })),
      ).map((o) => round3(config.weights.analysis * naive(o.map((j) => j.value)))),
    );
    expect(naiveAnalysis).toEqual(new Set([25.247, 25.248]));

    const rows: Judgment[] = sharp.map((value, i) => ({
      dimension: "analysis", sample: i, value, modelId: `demo-judge-${i}@1`,
    }));
    const expected = canonical(score(goodTranscript, goodAnswer, rows));
    for (const order of judgmentArrivalOrders(rows)) {
      expect(canonical(score(goodTranscript, goodAnswer, [...order]))).toBe(expected);
    }
    // And it settles on the canonically-sorted sum, every time.
    const s = score(goodTranscript, goodAnswer, rows);
    expect(s.raw.analysis).toBe(25.248);
    expect(s.scaled).toBe(140.248);
  });

  it("does not let two rows with the same sample tie-break by arrival order", () => {
    const rows: Judgment[] = [
      { dimension: "analysis", sample: 0, value: 0.9, modelId: "b@1" },
      { dimension: "analysis", sample: 0, value: 0.1, modelId: "a@1" },
      { dimension: "analysis", sample: 1, value: 0.30000000000000004, modelId: "a@1" },
    ];
    expect(canonical(score(goodTranscript, goodAnswer, rows))).toBe(
      canonical(score(goodTranscript, goodAnswer, [...rows].reverse())),
    );
  });

  it("ignores rows from other dimensions whatever order they arrive in", () => {
    const noise: Judgment[] = [
      { dimension: "comparative", sample: 0, value: 1, modelId: "x@1" },
      ...juryJudgments,
      { dimension: "craft", sample: 0, value: 0, modelId: "y@1" },
    ];
    expect(canonical(score(goodTranscript, goodAnswer, noise))).toBe(
      canonical(score(goodTranscript, goodAnswer, juryJudgments)),
    );
    expect(canonical(score(goodTranscript, goodAnswer, [...noise].reverse()))).toBe(
      canonical(score(goodTranscript, goodAnswer, juryJudgments)),
    );
  });
});
