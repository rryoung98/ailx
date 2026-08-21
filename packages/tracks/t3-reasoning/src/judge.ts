/**
 * DEMO judge — deterministic JudgeAdapter for the static showcase.
 * Plays the role of one member of the heterogeneous jury (§T3): pipeline
 * stages call it, its outputs are STORED as Judgment rows, and score()
 * only ever consumes the stored rows. Seeded by sha256 of the request, so
 * re-judging identical material yields identical values.
 */
import type { JudgeAdapter, JudgeRequest, JudgeResponse } from "@ailx/core";
import { seededIndex, sha256Hex } from "./sha256.js";

const EVIDENCE = [
  "Position is explicit and traced to the source; counter-argument acknowledged.",
  "Claims mostly anchored; one figure used without a source reference.",
  "Structure is sound but the recommendation understates implementation risk.",
  "Analysis engages the stakeholder's constraints directly.",
  "Argument leans on assistant phrasing in places; verification visible elsewhere.",
];

/** Rubric bands 0..5 (AI Assessment Scale 3-4 anchored language upstream). */
export class DemoJudge implements JudgeAdapter {
  async judge(req: JudgeRequest): Promise<JudgeResponse> {
    const material = typeof req.material === "string" ? req.material : JSON.stringify(req.material);
    const seed = sha256Hex(
      `${req.trackId}|${req.dimension}|${req.rubricVersion}|${req.sample}|${material}`,
    );
    // Longer, denser answers land in higher bands in this DEMO heuristic;
    // a real deployment replaces this class with a Vertex adapter.
    const lengthBand = Math.min(3, Math.floor(material.length / 400));
    const jitter = seededIndex(seed, 3) - 1; // -1, 0, +1
    const value = Math.max(0, Math.min(5, 2 + lengthBand + jitter));
    return {
      value,
      evidence: `[DEMO] ${EVIDENCE[seededIndex(seed + "|e", EVIDENCE.length)]}`,
      modelId: `demo-judge-${(req.sample % 3) + 1}@1`,
    };
  }
}
