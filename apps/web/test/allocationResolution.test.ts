/**
 * The allocation table is checked against the REAL score() paths.
 *
 * `packages/core/src/allocation.ts` carries two hand-maintained flags per
 * component — `resolvedBy` and `implemented` — and every claim the spec makes
 * about judge exposure is derived from them. `packages/core/test/spec-allocation.test.ts`
 * checks that the SPEC agrees with those flags, which is worth doing and is
 * not enough: it compares prose to metadata, so a component mislabelled
 * `model-free` when its points really come from a stored judgment passes
 * both, silently, and the published safety bound is wrong by that component.
 *
 * This file closes that hole empirically. For each track it runs the REAL
 * plugin `score()` over the real fixture artifact, then varies ONLY the
 * stored judgments and observes which `raw` components move. A component that
 * moves is judge-resolved whatever the table says; a component that does not
 * move under any judgment substitution is model-free. The observed partition
 * is asserted equal to the table's.
 *
 * It lives in `apps/web` rather than `packages/core` on purpose: core is the
 * package the track plugins import, so a core test importing the plugins
 * would invert the layering. `apps/web` already depends on all four plugins
 * (`apps/web/lib/instrument/registry.ts`), which makes it the lowest place in the graph
 * that can see the real scorers at once.
 *
 * "Does not move" is proved, not assumed: the judgment substitutions used
 * here are asserted to move the tracks' judge-resolved components, so a
 * substitution that had quietly become a no-op fails rather than declaring
 * the whole instrument model-free.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOCATED_TRACK_IDS,
  SCORE_ALLOCATION,
  type AllocatedTrackId,
  type Judgment,
} from "@ailx/core";
import { judgeT1, judgeT3, judgeT4 } from "@ailx/report";
import { t1Plugin } from "@ailx/track-t1";
import { plugin as t2Plugin, validateT2Config } from "@ailx/track-t2";
import { plugin as t3Plugin, validateT3Config } from "@ailx/track-t3";
import { t4Plugin } from "@ailx/track-t4";
import { fixtureArtifact } from "../lib/instrument/sampleAttempt";
import { trackConfig } from "../lib/instrument/instrument";

const RUBRIC_VERSION = "test";

/** One track's real scorer, its real config, and its real baseline judgments. */
interface Probe {
  /** Score the fixture with a substituted judgment set. */
  score(judgments: Judgment[]): Record<string, number>;
  /** What the demo judge actually stores for this fixture. */
  baseline: Judgment[];
}

/**
 * The judgment dimensions a track's scorer can read. Substituting a value
 * needs the dimension to exist, so T2 — which stores none — gets a synthetic
 * set built from its own component keys: if T2 ever started reading
 * judgments, that is the set it would read.
 */
function syntheticJudgments(dimensions: readonly string[], value: number): Judgment[] {
  return dimensions.flatMap((dimension) =>
    [0, 1, 2].map(
      (sample): Judgment => ({ dimension, sample, value, modelId: "synthetic-probe" }),
    ),
  );
}

function probeFor(trackId: AllocatedTrackId): Probe {
  switch (trackId) {
    case "t1": {
      const artifact = fixtureArtifact("t1") as Parameters<typeof judgeT1>[0];
      const cfg = t1Plugin.validateConfig(trackConfig("t1"));
      return {
        baseline: judgeT1(artifact),
        score: (judgments) =>
          t1Plugin.score({ artifact: artifact as never, judgments, rubricVersion: RUBRIC_VERSION }, cfg)
            .raw as Record<string, number>,
      };
    }
    case "t2": {
      const artifact = fixtureArtifact("t2");
      const cfg = validateT2Config(trackConfig("t2"));
      return {
        baseline: [],
        score: (judgments) =>
          t2Plugin.score({ artifact: artifact as never, judgments, rubricVersion: RUBRIC_VERSION }, cfg)
            .raw as unknown as Record<string, number>,
      };
    }
    case "t3": {
      const artifact = fixtureArtifact("t3") as Parameters<typeof judgeT3>[0];
      const cfg = validateT3Config(trackConfig("t3"));
      return {
        baseline: judgeT3(artifact),
        score: (judgments) =>
          t3Plugin.score({ artifact: artifact as never, judgments, rubricVersion: RUBRIC_VERSION }, cfg)
            .raw as unknown as Record<string, number>,
      };
    }
    case "t4": {
      const artifact = fixtureArtifact("t4") as Parameters<typeof judgeT4>[0];
      const cfg = t4Plugin.validateConfig(trackConfig("t4"));
      return {
        baseline: judgeT4(artifact),
        score: (judgments) =>
          t4Plugin.score({ artifact: artifact as never, judgments, rubricVersion: RUBRIC_VERSION }, cfg)
            .raw as Record<string, number>,
      };
    }
  }
}

/** Every dimension either the demo judge stores or the table allocates. */
function dimensionsFor(trackId: AllocatedTrackId, baseline: readonly Judgment[]): string[] {
  return [
    ...new Set([
      ...baseline.map((j) => j.dimension),
      ...SCORE_ALLOCATION[trackId].components.map((c) => c.key),
    ]),
  ];
}

/**
 * Component keys whose `raw` value changes when only the stored judgments
 * change. Several substitutions are tried because a single one can collide
 * with the baseline by arithmetic accident (a clamp, a floor, a median that
 * lands on the same number); a component counts as judge-resolved if ANY of
 * them moves it.
 */
function judgeResolvedKeys(trackId: AllocatedTrackId): Set<string> {
  const probe = probeFor(trackId);
  const dimensions = dimensionsFor(trackId, probe.baseline);
  const substitutions: Judgment[][] = [
    probe.baseline.map((j) => ({ ...j, value: j.value > 0.5 ? 0 : 1 })),
    syntheticJudgments(dimensions, 0),
    syntheticJudgments(dimensions, 1),
    [],
  ];
  const base = probe.score(probe.baseline);
  const moved = new Set<string>();
  for (const judgments of substitutions) {
    const other = probe.score(judgments);
    for (const key of Object.keys(base)) {
      if (other[key] !== base[key]) moved.add(key);
    }
  }
  // Only allocated components are the subject of the claim; `raw` also
  // carries diagnostics (`process.signal`, `meanJuryBand`, counts) that earn
  // no points.
  const allocated = new Set(SCORE_ALLOCATION[trackId].components.map((c) => c.key));
  return new Set([...moved].filter((k) => allocated.has(k)));
}

/** What the table says: judge-resolved = an LLM jury, or no measurement yet. */
function tableJudgeResolvedKeys(trackId: AllocatedTrackId): Set<string> {
  return new Set(
    SCORE_ALLOCATION[trackId].components
      .filter((c) => c.resolvedBy === "llm-judge" || !c.implemented)
      .map((c) => c.key),
  );
}

const sorted = (s: Set<string>): string[] => [...s].sort();

describe("the allocation table's resolution flags match the real score() paths", () => {
  it("probes every track that allocates points", () => {
    // A track that gains components later cannot be silently skipped.
    for (const t of ALLOCATED_TRACK_IDS) {
      const n = SCORE_ALLOCATION[t].components.length;
      if (n > 0) expect(Object.keys(probeFor(t).score(probeFor(t).baseline)).length).toBeGreaterThan(0);
    }
    expect(SCORE_ALLOCATION.t4.components).toHaveLength(0); // showcase: no points to resolve
  });

  it.each(ALLOCATED_TRACK_IDS.filter((t) => SCORE_ALLOCATION[t].components.length > 0))(
    "%s: the components that move when stored judgments change are exactly the ones the table calls judge-resolved",
    (trackId) => {
      expect(sorted(judgeResolvedKeys(trackId))).toEqual(sorted(tableJudgeResolvedKeys(trackId)));
    },
  );

  it.each(ALLOCATED_TRACK_IDS.filter((t) => SCORE_ALLOCATION[t].components.length > 0))(
    "%s: every component the table calls model-free is byte-identical under any judgment substitution",
    (trackId) => {
      const observed = judgeResolvedKeys(trackId);
      for (const c of SCORE_ALLOCATION[trackId].components) {
        if (c.resolvedBy === "model-free" && c.implemented) {
          expect(observed.has(c.key), `${trackId}.${c.key} moved with the judgments`).toBe(false);
        }
      }
    },
  );

  it("reproduces the published 180-of-400 implemented judge exposure from the score() paths", () => {
    let observed = 0;
    for (const t of ALLOCATED_TRACK_IDS) {
      if (SCORE_ALLOCATION[t].components.length === 0) continue;
      const moved = judgeResolvedKeys(t);
      for (const c of SCORE_ALLOCATION[t].components) if (moved.has(c.key)) observed += c.points;
    }
    // The number docs/TRACK-REVIEW.md §6 and AILX-Spec-2026.1.md §04 quote.
    expect(observed).toBe(180);
  });

  it("uses substitutions that actually perturb the judged tracks", () => {
    // Guards the negative half: a no-op substitution would make every
    // component look model-free and every assertion above pass vacuously.
    for (const t of ["t1", "t3"] as const) {
      expect(judgeResolvedKeys(t).size, t).toBeGreaterThan(0);
    }
  });
});
