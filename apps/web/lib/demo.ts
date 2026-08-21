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
 * PURE demo scorer for the showcase runners. When the artifact carries the
 * structured payload of a demo runner (t1..t4 keys) the subscores reflect the
 * candidate's actual behaviour (correctness, traps caught, quota discipline,
 * disclosure). Anything else falls back to a sha256-seeded score. Either way:
 * same inputs → same score.
 */
export function demoScoreArtifact(trackId: TrackId, artifact: unknown): TrackScoreValue {
  const a = (artifact ?? {}) as Record<string, unknown>;
  const seed = sha256Hex(`${trackId}:${demoRubricVersion(trackId)}:${canonicalJson(artifact ?? null)}`);
  const u = (i: number) => seededUniform(seed, i);
  let fracs: Record<string, number> | null = null;

  if (trackId === "t1" && isObj(a.t1)) {
    const t1 = a.t1 as { headline?: string; rationale?: string; iterations?: number };
    const headline = typeof t1.headline === "string" ? t1.headline.trim().length : 0;
    const rationale = typeof t1.rationale === "string" ? t1.rationale.trim().length : 0;
    const iters = typeof t1.iterations === "number" ? t1.iterations : 0;
    fracs = {
      gates: 0.55 + (headline > 0 ? 0.3 : 0) + 0.15 * u(0),
      comparative: 0.35 + 0.35 * u(1) + Math.min(0.3, iters * 0.04),
      ambition: 0.3 + 0.4 * u(2) + Math.min(0.3, iters * 0.05),
      rationale: Math.min(1, 0.2 + rationale / 220 + 0.15 * u(3)),
    };
  } else if (trackId === "t2" && isObj(a.t2)) {
    const rs = (a.t2 as { responses?: Array<{ correct?: boolean; confident?: boolean }> }).responses ?? [];
    const n = Math.max(1, rs.length);
    const nCorrect = rs.filter((r) => r.correct === true).length;
    const acc = nCorrect / n;
    // Brier-like: confident+right great, confident+wrong costly.
    const brier = rs.reduce((s, r) => {
      const p = r.confident ? 0.9 : 0.6;
      const o = r.correct ? 1 : 0;
      return s + (p - o) ** 2;
    }, 0) / n;
    fracs = {
      dprime: Math.min(1, Math.max(0.05, acc * 1.05 - 0.05)),
      calibration: Math.min(1, Math.max(0.05, 1 - brier * 1.6)),
      provenance: 0.45 + 0.45 * u(0),
    };
  } else if (trackId === "t3" && isObj(a.t3)) {
    const t3 = a.t3 as { caught?: number; plantedTotal?: number; overRejected?: number; analysis?: string };
    const caught = typeof t3.caught === "number" ? t3.caught : 0;
    const planted = Math.max(1, typeof t3.plantedTotal === "number" ? t3.plantedTotal : 2);
    const over = typeof t3.overRejected === "number" ? t3.overRejected : 0;
    const alen = typeof t3.analysis === "string" ? t3.analysis.trim().length : 0;
    fracs = {
      rsr: caught / planted,
      analysis: Math.min(1, 0.25 + alen / 260 + 0.2 * u(0)),
      process: Math.min(1, 0.35 + 0.25 * (caught / planted) + 0.2 * u(1)),
      rair: Math.max(0.1, 1 - over * 0.3),
    };
  } else if (trackId === "t4" && isObj(a.t4)) {
    const t4 = a.t4 as { prompts?: string[]; generations?: number; quota?: number; disclosed?: boolean; selectedSeed?: string };
    const gens = typeof t4.generations === "number" ? t4.generations : 0;
    const quota = Math.max(1, typeof t4.quota === "number" ? t4.quota : 6);
    const distinctPrompts = new Set(t4.prompts ?? []).size;
    const iterated = gens >= 2 ? 1 : 0;
    fracs = {
      brief: 0.4 + 0.4 * u(0) + (distinctPrompts >= 2 ? 0.2 : 0),
      comparative: 0.35 + 0.45 * u(1),
      direction: Math.min(1, 0.25 + 0.3 * iterated + 0.25 * Math.min(1, distinctPrompts / 3) + 0.2 * (gens <= quota ? 1 : 0)),
      provenance: t4.disclosed === true ? 0.9 + 0.1 * u(2) : 0.25,
    };
  }

  const meta = TRACK_META[trackId];
  const effort = artifactEffort(artifact);
  const raw: Record<string, number> = {};
  let total = 0;
  meta.components.forEach((c, i) => {
    const frac = fracs
      ? Math.min(1, Math.max(0, fracs[c.key] ?? 0))
      : Math.min(1, 0.35 + 0.45 * u(i) + 0.25 * effort);
    const pts = Math.round(c.points * frac * 10) / 10;
    raw[c.key] = pts;
    total += pts;
  });
  return { raw, scaled: Math.round(total * 10) / 10 };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/** Effort in [0,1] from a generic demo artifact shape (fallback path). */
function artifactEffort(artifact: unknown): number {
  if (artifact === null || typeof artifact !== "object") return 0;
  const a = artifact as { interactions?: unknown; response?: unknown };
  const n = Array.isArray(a.interactions) ? a.interactions.length : 0;
  const len = typeof a.response === "string" ? a.response.length : 0;
  return Math.min(1, n / 8) * 0.6 + Math.min(1, len / 400) * 0.4;
}

export const DEMO_COHORT_SEED = "ailx-2026.1-demo-cohort";
export const DEMO_COHORT_SIZE = 44; // + the candidate = n(45) of the pilot
