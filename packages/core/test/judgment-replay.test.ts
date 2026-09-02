/**
 * THE CONTRACT AROUND A STORED JUDGE OUTPUT — spec §14, AGENTS.md.
 *
 * "Any score ever issued is byte-identically recomputable from stored inputs"
 * is TRUE for T1/T3/T4 only because a judge's output is one of the stored
 * inputs. An LLM judge is not reproducible even at temperature 0, so the
 * honest pair of claims is: re-SCORING reproduces, re-JUDGING does not.
 *
 * WHAT THIS FILE DOES AND DOES NOT PROVE. It pins `judgmentId` — the content
 * address the whole scheme rests on. It proves NOTHING about any real track,
 * and it used to pretend otherwise: it scored a toy `replayScore` defined
 * inside this file, which could not fail when the real system broke, and the
 * real system was broken at the time (`judgmentId` had no production caller
 * anywhere, and a judge-resolved track could be scored with `judgments: []`).
 * That toy is gone. The claims it seemed to make are now made where they can
 * fail for the right reason:
 *
 *   packages/session/test/recomputability.test.ts
 *     the machine refuses a score that is not attested, and a tampered stored
 *     log truncates on load;
 *   apps/web/test/recomputability.test.ts
 *     the REAL T1-T4 plugins replay their REAL stored rows byte-identically,
 *     ignore a drifted judge, and are invariant to stored row order;
 *   packages/core/test/judgments.test.ts
 *     the aggregation those rows feed is order-invariant by construction;
 *   packages/core/test/purity.test.ts
 *     what the purity harness does and does not catch.
 */
import { describe, it, expect } from "vitest";
import type { Judgment } from "../src/plugin.js";
import { judgmentId } from "../src/content-address.js";
import { canonicalJson } from "../src/hash.js";

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
    value: (60 + (drift++ % 7)) / 100,
    evidence: `cited from ${artifact}`,
    modelId: "test-judge@20260101",
  });
}

function collect(judge: ReturnType<typeof unstableJudge>, artifact: string): Judgment[] {
  return ["clarity", "control"].flatMap((d) => [0, 1, 2].map((s) => judge(artifact, d, s)));
}

describe("re-JUDGING is not reproducible — the weaker half, stated on purpose", () => {
  it("two collections over one artifact disagree, and that is expected", () => {
    const judge = unstableJudge();
    expect(canonicalJson(collect(judge, "artifact-a")))
      .not.toBe(canonicalJson(collect(judge, "artifact-a")));
  });

  it("...so a re-judged row gets a DIFFERENT content address, loudly", () => {
    const judge = unstableJudge();
    const first = collect(judge, "artifact-a");
    const second = collect(judge, "artifact-a");
    // Not one id in common: an auditor comparing ids against the score of
    // record sees a re-judge as a re-judge, never as a silent agreement.
    const ids = new Set(first.map(judgmentId));
    expect(second.filter((j) => ids.has(judgmentId(j)))).toHaveLength(0);
  });
});

describe("judgmentId content-addresses the stored judge output", () => {
  const base: Judgment = {
    dimension: "clarity",
    sample: 0,
    value: 0.62,
    evidence: "cited from artifact-a",
    modelId: "test-judge@20260101",
  };

  it("is locked byte-for-byte", () => {
    // Independently produced by node:crypto over JSON.stringify of the
    // key-sorted object; see test/hash.test.ts for the same discipline.
    expect(judgmentId(base)).toBe(
      "ad1122c157f4ad128e48fc175914549c4a67344552687d5a08e2aa74c73f5972",
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
      { ...base, value: 0.620001 },
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

  it("is not fooled by the values JSON cannot represent", () => {
    // The title above used to be false: JSON.stringify collapses -0 with 0,
    // NaN and Infinity with null, and an explicit `undefined` property with
    // its absence, so four different judgments hashed the same. The encoder
    // now REFUSES them, which is the loud failure a judgment carrying NaN
    // deserves. `evidence: undefined` throws; an ABSENT evidence still hashes.
    for (const bad of [-0, NaN, Infinity, -Infinity]) {
      expect(() => judgmentId({ ...base, value: bad }), String(bad)).toThrow(/canonicalJson/);
    }
    expect(() => judgmentId({ ...base, evidence: undefined })).toThrow(/canonicalJson/);
  });

  it("separates the samples of an ensemble, so a median cannot be forged from one call", () => {
    const ids = [0, 1, 2].map((sample) => judgmentId({ ...base, sample }));
    expect(new Set(ids).size).toBe(3);
  });
});
