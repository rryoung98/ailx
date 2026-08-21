import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import type { Judgment } from "@ailx/core";
import { plugin, validateT3Config } from "../src/plugin.js";
import { rairCreditForClaim, revisionChainLength, scoreT3 } from "../src/scoring.js";
import {
  config, credulousTranscript, goodAnswer, goodTranscript,
  juryJudgments, overRejectTranscript, shortAnswer,
} from "./fixtures.js";
import type { T3Turn } from "../src/types.js";

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

  it("strong candidate: full RSR, RAIR and process; analysis from stored jury", () => {
    const s = score(goodTranscript, goodAnswer);
    expect(s.raw.rsr).toBe(25);        // caught 3/3 surfaced planted errors
    expect(s.raw.rair).toBe(10);       // deliberated then adopted 2/2 correct-advice claims
    expect(s.raw.adviceDeliberated).toBe(2);
    expect(s.raw.process).toBe(20);    // 3 prompts, chain 2, 3 verifies, full deliberation
    // normalized jury mean 0.7333 -> 45 * 0.7333 = 33
    expect(s.raw.analysis).toBe(33);
    expect(s.scaled).toBe(88);
    expect(s.raw.plantedCaught).toBe(3);
    expect(s.raw.revisionChainLength).toBe(2);
  });

  it("credulous candidate: accepted planted errors score zero RSR", () => {
    const s = score(credulousTranscript, goodAnswer);
    expect(s.raw.rsr).toBe(0);              // 2 planted surfaced, 0 challenged
    expect(s.raw.plantedSurfaced).toBe(2);
    expect(s.raw.plantedCaught).toBe(0);
    expect(s.raw.verificationCount).toBe(0);
    expect(s.raw.process).toBeLessThan(10); // no verification, no revision chain
    // F5: blind instant accept of the one correct claim — HALF credit only.
    expect(s.raw.rair).toBe(5);
    expect(s.raw.adviceDeliberated).toBe(0);
  });

  it("F5 regression: assisted followed directly by accepted earns < full RAIR", () => {
    // The review's read-only probe: an 'assisted' event followed immediately
    // by 'accepted' used to earn the full 10 RAIR points.
    const blind: T3Turn[] = [
      { verb: "assisted", object: "assist:1", text: "…", claimIds: ["ca-cluster"], seq: 0, clientTs: "2026-02-01T10:00:00Z" },
      { verb: "accepted", object: "claim:ca-cluster", seq: 1, clientTs: "2026-02-01T10:00:01Z" },
    ];
    const s = score(blind, goodAnswer);
    expect(s.raw.rair).toBeLessThan(config.weights.rair);
    expect(s.raw.rair).toBe(config.weights.rair / 2);
    expect(rairCreditForClaim(blind, "ca-cluster")).toBe(0.5);
  });

  it("F5: verification between surfacing and acceptance restores full credit", () => {
    const deliberate: T3Turn[] = [
      { verb: "assisted", object: "assist:1", text: "…", claimIds: ["ca-cluster"], seq: 0, clientTs: "2026-02-01T10:00:00Z" },
      { verb: "verified", object: "source", seq: 1, clientTs: "2026-02-01T10:01:00Z" },
      { verb: "accepted", object: "claim:ca-cluster", seq: 2, clientTs: "2026-02-01T10:02:00Z" },
    ];
    expect(rairCreditForClaim(deliberate, "ca-cluster")).toBe(1);
    expect(score(deliberate, goodAnswer).raw.rair).toBe(config.weights.rair);
    // A verify that happened BEFORE the claim surfaced is not deliberation
    // on that claim.
    const staleVerify: T3Turn[] = [
      { verb: "verified", object: "source", seq: 0, clientTs: "2026-02-01T09:59:00Z" },
      ...blindShift(deliberate.filter((t) => t.verb !== "verified")),
    ];
    expect(rairCreditForClaim(staleVerify, "ca-cluster")).toBe(0.5);
  });

  it("over-rejection is a failure too: challenging correct advice zeroes RAIR", () => {
    const s = score(overRejectTranscript, goodAnswer);
    expect(s.raw.rsr).toBe(25);
    expect(s.raw.rair).toBe(0);
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
    expect(s.raw.rair).toBe(10);
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
          "deliberationRate": 1,
          "jurySpread": 0.2,
          "meanJuryBand": 0.733,
          "plantedCaught": 3,
          "plantedSurfaced": 3,
          "process": 20,
          "promptCount": 3,
          "rair": 10,
          "revisionChainLength": 2,
          "rsr": 25,
          "verificationCount": 3,
          "wordCount": 180,
        },
        "scaled": 88,
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
          "deliberationRate": 1,
          "jurySpread": 0.2,
          "meanJuryBand": 0.733,
          "plantedCaught": 0,
          "plantedSurfaced": 2,
          "process": 6.667,
          "promptCount": 1,
          "rair": 5,
          "revisionChainLength": 0,
          "rsr": 0,
          "verificationCount": 0,
          "wordCount": 180,
        },
        "scaled": 44.667,
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
    expect(parsed.weights).toEqual({ rsr: 25, analysis: 45, process: 20, rair: 10 });
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
