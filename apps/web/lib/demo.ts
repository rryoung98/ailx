/**
 * Deterministic DEMO simulators for the static showcase.
 *
 * Everywhere the spec calls for a model (judge jury, scoring pipeline), this
 * build substitutes a simulator seeded by sha256 of its inputs, behind the
 * SAME interfaces the production system uses. Same inputs → same outputs,
 * forever, with no network. Clearly labelled `demo-*@1` in model manifests.
 */

import type { JudgeAdapter, JudgeRequest, JudgeResponse } from "@ailx/core";
import {
  canonicalJson, rubricVersionOf, seededUniform, sha256Hex,
  type TrackId, type TrackScoreValue,
} from "@ailx/session";
import { TRACK_META } from "./tracks";

export const DEMO_MODEL_ID = "demo-judge@1";

/** Demo rubric bundle — hashed into rubric_version exactly as spec §14 requires. */
export const DEMO_RUBRIC_PARTS: Record<TrackId, string[]> = {
  t1: ["ailx-2026.1/t1 rubric v1", "screening prompt: judge the artefact against the locked T1 traits"],
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
 * material, sample): sha256-seeded, banded 0–4.
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
    const value = Math.min(4, Math.floor(u * 5)); // rubric band 0–4
    return {
      value,
      evidence: `[demo] deterministic band ${value} from sha256(${seed.slice(0, 12)}…)`,
      modelId: DEMO_MODEL_ID,
    };
  }
}

/** Digest of the demo scoring implementation — stands in for hash(score.ts build output). */
export const DEMO_SCORING_DIGEST = sha256Hex("ailx-web demo scorer v1");

export function demoModelManifest(trackId: TrackId): Record<string, string> {
  return trackId === "t2"
    ? { note: "no model in the loop (SDT arithmetic)" }
    : { screening: DEMO_MODEL_ID, jury: `${DEMO_MODEL_ID},${DEMO_MODEL_ID},${DEMO_MODEL_ID}` };
}

/**
 * PURE demo scorer for placeholder tracks. Subscores are a deterministic
 * function of sha256(canonical_json(artifact)) per rubric component, biased
 * upward slightly when the artifact shows more interaction effort.
 */
export function demoScoreArtifact(trackId: TrackId, artifact: unknown): TrackScoreValue {
  const meta = TRACK_META[trackId];
  const seed = sha256Hex(`${trackId}:${demoRubricVersion(trackId)}:${canonicalJson(artifact ?? null)}`);
  const effort = artifactEffort(artifact);
  const raw: Record<string, number> = {};
  let total = 0;
  meta.components.forEach((c, i) => {
    const u = seededUniform(seed, i);
    const frac = Math.min(1, 0.35 + 0.45 * u + 0.25 * effort);
    const pts = Math.round(c.points * frac * 10) / 10;
    raw[c.key] = pts;
    total += pts;
  });
  return { raw, scaled: Math.round(total * 10) / 10 };
}

/** Effort in [0,1] from the demo artifact shape (interactions + response length). */
function artifactEffort(artifact: unknown): number {
  if (artifact === null || typeof artifact !== "object") return 0;
  const a = artifact as { interactions?: unknown; response?: unknown };
  const n = Array.isArray(a.interactions) ? a.interactions.length : 0;
  const len = typeof a.response === "string" ? a.response.length : 0;
  return Math.min(1, n / 8) * 0.6 + Math.min(1, len / 400) * 0.4;
}

export const DEMO_COHORT_SEED = "ailx-2026.1-demo-cohort";
export const DEMO_COHORT_SIZE = 44; // + the candidate = n(45) of the pilot
