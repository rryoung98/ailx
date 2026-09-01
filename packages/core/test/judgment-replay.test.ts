/**
 * The recomputability invariant, at the point where it is easiest to break —
 * spec §14, AGENTS.md "Core invariants".
 *
 * "Any score ever issued is byte-identically recomputable from stored inputs"
 * is TRUE for T3/T4 only because a judge's output is one of the stored inputs.
 * An LLM judge is not reproducible even at temperature 0, so the honest pair of
 * claims is: re-SCORING reproduces, re-JUDGING does not. These tests assert
 * both halves — including the one that admits the weakness — so that a future
 * judging pipeline cannot quietly re-invoke a judge on the recompute path and
 * still pass.
 *
 * The judging pipeline does not exist yet. This locks the CONTRACT before it
 * is built, which is the cheap end of that fix.
 */
import { describe, it, expect } from "vitest";
import type { Judgment, ScoreInputs, TrackScore } from "../src/plugin.js";
import { judgmentId } from "../src/content-address.js";
import { canonicalJson } from "../src/hash.js";
import { runPure } from "../src/purity.js";

// ---------------------------------------------------------------------------
// A stand-in for an LLM judge: same artifact, same prompt, different number.
// Not random — a counter — so the test itself stays deterministic while still
// modelling the property that matters (a second call disagrees with the first).
// ---------------------------------------------------------------------------
function unstableJudge(): (artifact: string, dimension: string, sample: number) => Judgment {
  let drift = 0;
  return (artifact, dimension, sample) => ({
    dimension,
    sample,
    value: 60 + (drift++ % 7),
    evidence: `cited from ${artifact}`,
    modelId: "test-judge@20260101",
  });
}

function collect(judge: ReturnType<typeof unstableJudge>, artifact: string): Judgment[] {
  return ["clarity", "control"].flatMap((d) => [0, 1, 2].map((s) => judge(artifact, d, s)));
}

/** A track's score(): PURE, and reads nothing but its stored inputs. */
function replayScore(inputs: ScoreInputs<string>): TrackScore {
  const raw: Record<string, number> = {};
  for (const j of [...inputs.judgments].sort((a, b) =>
    a.dimension === b.dimension ? a.sample - b.sample : a.dimension < b.dimension ? -1 : 1,
  )) {
    raw[j.dimension] = (raw[j.dimension] ?? 0) + j.value;
  }
  const dims = Object.keys(raw).sort();
  for (const d of dims) raw[d] = raw[d] / 3;
  return { raw, scaled: dims.reduce((t, d) => t + raw[d], 0) / dims.length };
}

describe("stored judge output is an INPUT to score(), not something score() re-derives", () => {
  it("re-JUDGING is not reproducible — the weaker claim, stated on purpose", () => {
    const judge = unstableJudge();
    const first = collect(judge, "artifact-a");
    const second = collect(judge, "artifact-a");

    expect(canonicalJson(second)).not.toBe(canonicalJson(first));
    expect(replayScore({ artifact: "artifact-a", judgments: second, rubricVersion: "r1" }).scaled).not.toBe(
      replayScore({ artifact: "artifact-a", judgments: first, rubricVersion: "r1" }).scaled,
    );
  });

  it("re-SCORING from the STORED judgments is byte-identical, however far the judge has drifted", () => {
    const judge = unstableJudge();
    const stored: ReadonlyArray<Judgment> = Object.freeze(collect(judge, "artifact-a"));
    const inputs: ScoreInputs<string> = { artifact: "artifact-a", judgments: stored, rubricVersion: "r1" };

    const ofRecord = canonicalJson(replayScore(inputs));
    for (let i = 0; i < 5; i++) {
      collect(judge, "artifact-a"); // the judge keeps moving; the score must not
      expect(canonicalJson(replayScore(inputs))).toBe(ofRecord);
    }
  });

  it("is invariant to the order rows come back from the store in", () => {
    const stored = collect(unstableJudge(), "artifact-a");
    const shuffled = [stored[3], stored[0], stored[5], stored[1], stored[4], stored[2]];
    expect(canonicalJson(replayScore({ artifact: "a", judgments: shuffled, rubricVersion: "r1" }))).toBe(
      canonicalJson(replayScore({ artifact: "a", judgments: stored, rubricVersion: "r1" })),
    );
  });

  it("a score() that reaches for the judge instead of the stored row is a purity violation", () => {
    const stored = collect(unstableJudge(), "artifact-a");
    // Positive control: this is the mistake the contract exists to prevent.
    const reJudgingScore = (inputs: ScoreInputs<string>): TrackScore => {
      void (globalThis as { fetch: unknown }).fetch;
      (globalThis as { fetch: () => unknown }).fetch();
      return replayScore(inputs);
    };
    expect(() =>
      runPure(() => reJudgingScore({ artifact: "a", judgments: stored, rubricVersion: "r1" })),
    ).toThrow(/Purity violation/);
    expect(
      runPure(() => replayScore({ artifact: "a", judgments: stored, rubricVersion: "r1" })).scaled,
    ).toBeGreaterThan(0);
  });
});

describe("judgmentId content-addresses the stored judge output", () => {
  const base: Judgment = {
    dimension: "clarity",
    sample: 0,
    value: 62,
    evidence: "cited from artifact-a",
    modelId: "test-judge@20260101",
  };

  it("is locked byte-for-byte", () => {
    // Independently produced by node:crypto over JSON.stringify of the
    // key-sorted object; see test/hash.test.ts for the same discipline.
    expect(judgmentId(base)).toBe(
      "350123c5a538e5b6bdd7d75b3931624f478f3df5e9e265f4a76ce1a88ed4a0cb",
    );
  });

  it("does not depend on key order", () => {
    const reordered = {
      modelId: base.modelId,
      value: base.value,
      evidence: base.evidence,
      sample: base.sample,
      dimension: base.dimension,
    } as Judgment;
    expect(judgmentId(reordered)).toBe(judgmentId(base));
  });

  it("changes when ANY field of the stored judgment changes", () => {
    const mutations: Judgment[] = [
      { ...base, value: 62.0001 },
      { ...base, dimension: "control" },
      { ...base, sample: 1 },
      { ...base, modelId: "test-judge@20260102" },
      { ...base, evidence: "cited from artifact-b" },
    ];
    for (const m of mutations) expect(judgmentId(m)).not.toBe(judgmentId(base));
    // dropping the evidence span is a change too — an unevidenced judgment is
    // discarded, not silently equal to an evidenced one (spec §10).
    const { evidence: _drop, ...withoutEvidence } = base;
    expect(judgmentId(withoutEvidence as Judgment)).not.toBe(judgmentId(base));
  });

  it("separates the samples of an ensemble, so a median cannot be forged from one call", () => {
    const ids = [0, 1, 2].map((sample) => judgmentId({ ...base, sample }));
    expect(new Set(ids).size).toBe(3);
  });
});
