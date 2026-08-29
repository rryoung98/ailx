/**
 * Deterministic DEMO judge + cohort constants for the static showcase.
 *
 * Where the spec calls for a model judge, this build substitutes a
 * simulator seeded by sha256 of its inputs, behind the SAME JudgeAdapter
 * interface the production system uses. Same inputs → same outputs,
 * forever, with no network. Clearly labelled `demo-*@1` in model manifests.
 *
 * NOTE (F1): the old fallback `demoScoreArtifact` is GONE. The exam path
 * scores exclusively through the real track plugins (lib/registry.ts) and
 * fails closed on malformed input.
 */

import type { JudgeAdapter, JudgeRequest, JudgeResponse } from "@ailx/core";
import {
  canonicalJson, rubricVersionOf, seededUniform, sha256Hex,
  type TrackId,
} from "@ailx/session";

export const DEMO_MODEL_ID = "demo-judge@1";

/** Demo rubric bundle — hashed into rubric_version exactly as spec §14 requires. */
export const DEMO_RUBRIC_PARTS: Record<TrackId, string[]> = {
  t1: ["ailx-2026.1/t1 rubric v1", "screening prompt: judge the artifact against the locked T1 traits"],
  t2: ["ailx-2026.1/t2 rubric v1", "no model in the loop: arithmetic on response data (SDT)"],
  t3: ["ailx-2026.1/t3 rubric v1", "screening prompt: evidence-anchored analysis rubric, three-family jury"],
  t4: ["ailx-2026.1/t4 rubric v1", "screening prompt: blind communicative-intent reading vs brief"],
};

export function demoRubricVersion(trackId: TrackId): string {
  return rubricVersionOf(DEMO_RUBRIC_PARTS[trackId]);
}

/**
 * DeterministicDemoJudge — implements the production JudgeAdapter contract.
 * The judged value is a pure function of (trackId, dimension, rubricVersion,
 * material, sample): sha256-seeded rubric band 0–4, returned NORMALIZED to
 * [0, 1] per the core JudgeResponse contract.
 */
export class DeterministicDemoJudge implements JudgeAdapter {
  async judge(req: JudgeRequest): Promise<JudgeResponse> {
    const seed = sha256Hex(
      canonicalJson({
        trackId: req.trackId,
        dimension: req.dimension,
        rubricVersion: req.rubricVersion,
        material: req.material,
        sample: req.sample,
      }),
    );
    const u = seededUniform(seed, 0);
    const band = Math.min(4, Math.floor(u * 5)); // rubric band 0–4
    return {
      value: band / 4, // normalized [0, 1] — consumers reject out-of-range
      evidence: `[demo] deterministic band ${band}/4 from sha256(${seed.slice(0, 12)}…)`,
      modelId: DEMO_MODEL_ID,
    };
  }
}

export const DEMO_COHORT_SEED = "ailx-2026.1-demo-cohort";
export const DEMO_COHORT_SIZE = 44; // + the candidate = n(45) of the pilot
