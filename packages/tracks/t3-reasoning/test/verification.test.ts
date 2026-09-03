import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import { plugin, t3TimeBudgetSeconds, validateT3Config } from "../src/plugin.js";
import {
  DISCRIMINATING_MIN_CHECKS, scoreT3, verificationTally,
} from "../src/scoring.js";
import { config, goodAnswer, goodTranscript, juryJudgments } from "./fixtures.js";
import type { T3Turn } from "../src/types.js";

const PLANTED = config.plantedErrors.map((e) => e.id);
const ADVICE = config.correctAdvice.map((a) => a.id);
const tally = (transcript: readonly T3Turn[]) =>
  verificationTally(transcript, PLANTED, ADVICE);

let seq = 0;
const turn = (t: Omit<T3Turn, "seq" | "clientTs">): T3Turn => ({
  ...t,
  seq: seq++,
  clientTs: "2026-02-01T10:00:00Z",
});

const surfaceAll = () =>
  turn({ verb: "assisted", object: "assist:1", claimIds: [...PLANTED, ...ADVICE] });

const score = (transcript: readonly T3Turn[], cfg = config) =>
  runPure(() => scoreT3({ transcript, finalAnswer: goodAnswer }, juryJudgments, cfg));

/** The verification term of Process, in points. */
const quarter = config.weights.process / 4;
const verificationPoints = (transcript: readonly T3Turn[]) =>
  quarter * score(transcript).raw.discriminatingVerificationRate;

/**
 * TEN-30 — DISCRIMINATING verification.
 *
 * The rule this replaced paid a quarter of Process for two distinct claims
 * checked, whatever the checks found. That rewards performative checking,
 * which is the behaviour the track exists to catch: a candidate who knows the
 * transcript is scored can check everything and learn nothing.
 */
describe("discriminating verification", () => {
  it("pays nothing when the candidate never checked anything", () => {
    const t = [surfaceAll()];
    expect(tally(t)).toEqual({ checked: 0, discriminating: 0, rate: 0 });
    expect(verificationPoints(t)).toBe(0);
  });

  it("counts a checked planted error that was then challenged", () => {
    const t = [
      surfaceAll(),
      turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
      turn({ verb: "challenged", object: "claim:pe-figure" }),
    ];
    expect(tally(t)).toMatchObject({ checked: 1, discriminating: 1 });
    // One of the two checks the term is scaled against: half the quarter.
    expect(tally(t).rate).toBe(1 / DISCRIMINATING_MIN_CHECKS);
  });

  it("counts a checked correct-advice claim that was then accepted", () => {
    const t = [
      surfaceAll(),
      turn({ verb: "verified", object: "claim:ca-cluster", claimIds: ["ca-cluster"] }),
      turn({ verb: "accepted", object: "claim:ca-cluster" }),
    ];
    expect(tally(t)).toMatchObject({ checked: 1, discriminating: 1 });
  });

  it("pays nothing for a check that swallowed the planted error anyway", () => {
    const t = [
      surfaceAll(),
      turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
      turn({ verb: "accepted", object: "claim:pe-figure" }),
    ];
    expect(tally(t)).toEqual({ checked: 1, discriminating: 0, rate: 0 });
    expect(verificationPoints(t)).toBe(0);
  });

  it("pays nothing for volume: five claims checked, none resolved", () => {
    const t = [
      surfaceAll(),
      ...[...PLANTED, ...ADVICE].map((id) =>
        turn({ verb: "verified", object: `claim:${id}`, claimIds: [id] }),
      ),
    ];
    expect(tally(t)).toMatchObject({ checked: 5, discriminating: 0, rate: 0 });
    expect(verificationPoints(t)).toBe(0);
  });

  it("dilutes: indiscriminate checking lowers the rate it is scored on", () => {
    const resolved = [
      surfaceAll(),
      turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
      turn({ verb: "challenged", object: "claim:pe-figure" }),
      turn({ verb: "verified", object: "claim:pe-causal", claimIds: ["pe-causal"] }),
      turn({ verb: "challenged", object: "claim:pe-causal" }),
    ];
    expect(tally(resolved).rate).toBe(1);
    const padded = [
      ...resolved,
      turn({ verb: "verified", object: "claim:pe-citation", claimIds: ["pe-citation"] }),
      turn({ verb: "verified", object: "claim:ca-cluster", claimIds: ["ca-cluster"] }),
    ];
    expect(tally(padded)).toMatchObject({ checked: 4, discriminating: 2 });
    expect(tally(padded).rate).toBe(0.5);
    expect(verificationPoints(padded)).toBeLessThan(verificationPoints(resolved));
  });

  it("counts repeated checks of one claim once, in both halves of the rate", () => {
    const t = [
      surfaceAll(),
      ...[0, 1, 2, 3].map(() =>
        turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
      ),
      turn({ verb: "challenged", object: "claim:pe-figure" }),
    ];
    expect(tally(t)).toMatchObject({ checked: 1, discriminating: 1 });
    expect(score(t).raw.verificationCount).toBe(1);
  });

  it("ignores a check made after the answer was final", () => {
    const t = [
      surfaceAll(),
      turn({ verb: "submitted", object: "t3-reasoning:final" }),
      turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
      turn({ verb: "challenged", object: "claim:pe-figure" }),
    ];
    expect(tally(t)).toEqual({ checked: 0, discriminating: 0, rate: 0 });
    // Still recorded as volume, so the late check stays visible in the record.
    expect(score(t).raw.verificationCount).toBe(1);
  });

  it("ignores a stance taken after the answer was final", () => {
    // The check was in time, the call came too late to change anything the
    // candidate wrote, so it buys nothing.
    const t = [
      surfaceAll(),
      turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
      turn({ verb: "submitted", object: "t3-reasoning:final" }),
      turn({ verb: "challenged", object: "claim:pe-figure" }),
    ];
    expect(tally(t)).toMatchObject({ checked: 1, discriminating: 0, rate: 0 });
    // The over-reliance component still reads the stance — that rule is
    // unchanged and not ours.
    expect(score(t).raw.plantedCaught).toBe(1);
  });

  it("ignores a claim the form knows nothing about", () => {
    const t = [
      turn({ verb: "assisted", object: "assist:1", claimIds: ["unkeyed-1"] }),
      turn({ verb: "verified", object: "claim:unkeyed-1", claimIds: ["unkeyed-1"] }),
      turn({ verb: "challenged", object: "claim:unkeyed-1" }),
    ];
    // Nothing in the record says whether there was an error to find, so the
    // check goes in neither half of the fraction.
    expect(tally(t)).toEqual({ checked: 0, discriminating: 0, rate: 0 });
  });

  it("ignores a stance the candidate took BEFORE the check", () => {
    const t = [
      surfaceAll(),
      turn({ verb: "challenged", object: "claim:pe-figure" }),
      turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
    ];
    expect(tally(t)).toMatchObject({ checked: 1, discriminating: 0 });
  });

  it("reads the FINAL stance, so a check followed by a flip is judged on the flip", () => {
    const t = [
      surfaceAll(),
      turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
      turn({ verb: "challenged", object: "claim:pe-figure" }),
      turn({ verb: "accepted", object: "claim:pe-figure" }),
    ];
    expect(tally(t)).toMatchObject({ checked: 1, discriminating: 0 });
  });

  it("ignores a check of a claim the assistant never raised", () => {
    const t = [
      turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
      turn({ verb: "challenged", object: "claim:pe-figure" }),
    ];
    expect(tally(t)).toEqual({ checked: 0, discriminating: 0, rate: 0 });
  });

  it("ignores an unattributed verify, the same as the volume rule did", () => {
    const t = [
      surfaceAll(),
      ...[0, 1, 2].map(() => turn({ verb: "verified", object: "source" })),
    ];
    expect(tally(t)).toEqual({ checked: 0, discriminating: 0, rate: 0 });
  });

  it("pays the full quarter at two discriminating checks and no more", () => {
    const two = [
      surfaceAll(),
      turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
      turn({ verb: "challenged", object: "claim:pe-figure" }),
      turn({ verb: "verified", object: "claim:ca-cluster", claimIds: ["ca-cluster"] }),
      turn({ verb: "accepted", object: "claim:ca-cluster" }),
    ];
    expect(tally(two).rate).toBe(1);
    expect(verificationPoints(two)).toBeCloseTo(quarter, 6);
    const three = [
      ...two,
      turn({ verb: "verified", object: "claim:pe-causal", claimIds: ["pe-causal"] }),
      turn({ verb: "challenged", object: "claim:pe-causal" }),
    ];
    expect(tally(three).rate).toBe(1);
    expect(verificationPoints(three)).toBeCloseTo(quarter, 6);
  });

  it("reports volume beside the scored measure, and scores only the scored one", () => {
    const s = score(goodTranscript);
    expect(s.raw.verificationCount).toBe(4);            // volume, diagnostic
    expect(s.raw.verificationsChecked).toBe(4);
    expect(s.raw.discriminatingVerifications).toBe(4);  // every check resolved
    expect(s.raw.discriminatingVerificationRate).toBe(1);
  });

  it("does not raise T3's points: process is still a quarter each", () => {
    expect(score(goodTranscript).raw.process).toBe(config.weights.process);
  });
});

/**
 * TEN-30 — the time condition as a FORM PARAMETER.
 *
 * The manipulation the review asks for is the same task at 90 minutes and at
 * 30 (docs/TRACK-REVIEW.md §7.2). It is declared by the form and copied into
 * the record, so a sitting names the condition it ran under. It is inert:
 * score() branches on nothing.
 */
describe("declared time condition", () => {
  it("defaults to today's behaviour: no declaration, recorded as 0", () => {
    const s = score(goodTranscript);
    expect(config.timeBudgetMinutes).toBeUndefined();
    expect(s.raw["condition.timeBudgetMinutes"]).toBe(0);
  });

  it("survives into the stored record when the form declares it", () => {
    const pressured = { ...config, timeBudgetMinutes: 30 };
    expect(score(goodTranscript, pressured).raw["condition.timeBudgetMinutes"]).toBe(30);
    const roomy = { ...config, timeBudgetMinutes: 90 };
    expect(score(goodTranscript, roomy).raw["condition.timeBudgetMinutes"]).toBe(90);
  });

  it("changes no score: the label is not a scoring input", () => {
    const base = score(goodTranscript);
    const pressured = score(goodTranscript, { ...config, timeBudgetMinutes: 30 });
    expect(pressured.scaled).toBe(base.scaled);
    const { "condition.timeBudgetMinutes": _c, ...rest } = pressured.raw;
    const { "condition.timeBudgetMinutes": _b, ...baseRest } = base.raw;
    expect(rest).toEqual(baseRest);
  });

  it("is carried by the plugin's score(), not only by scoreT3", () => {
    const s = runPure(() =>
      plugin.score(
        { artifact: { transcript: goodTranscript, finalAnswer: goodAnswer }, judgments: juryJudgments, rubricVersion: "test" },
        { ...config, timeBudgetMinutes: 30 },
      ),
    );
    expect(s.raw["condition.timeBudgetMinutes"]).toBe(30);
  });

  it("validates the declaration, because a nonsense budget mislabels a sitting", () => {
    expect(() => validateT3Config({ ...config, timeBudgetMinutes: 30 })).not.toThrow();
    expect(validateT3Config({ ...config, timeBudgetMinutes: 30 }).timeBudgetMinutes).toBe(30);
    // Whole minutes only: 0.001 minutes is a positive number and a
    // zero-second clock.
    for (const bad of [0, -30, 0.001, 29.5, Number.NaN, Number.POSITIVE_INFINITY, "30", null]) {
      expect(() => validateT3Config({ ...config, timeBudgetMinutes: bad })).toThrow(
        /timeBudgetMinutes/,
      );
    }
  });

  it("drops the declaration from a config that omits it, rather than inventing one", () => {
    expect(validateT3Config(config).timeBudgetMinutes).toBeUndefined();
  });

  it("converts the declared minutes to the sitting clock, in one place", () => {
    expect(t3TimeBudgetSeconds(config)).toBeUndefined();
    expect(t3TimeBudgetSeconds({ ...config, timeBudgetMinutes: 90 })).toBe(5400);
    expect(t3TimeBudgetSeconds({ ...config, timeBudgetMinutes: 30 })).toBe(1800);
  });
});
