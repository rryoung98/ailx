/**
 * T3 pure scoring — spec §T3 "Score allocation".
 *   25 RSR    planted-error detection: caught & rejected seeded wrong outputs
 *   45        analysis quality from STORED jury judgments (never called here)
 *   20        process quality from the transcript
 *   10 RAIR   appropriate reliance: adopting correct advice; over-rejection fails
 * 35 of 100 points are model-free measurement of behaviour.
 * No I/O, no clock, no randomness.
 */
import type { Judgment } from "@ailx/core";
import type { T3Artifact, T3Config, T3Turn } from "./types.js";

export const RUBRIC_BAND_MAX = 5;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export interface T3Raw {
  rsr: number;
  analysis: number;
  process: number;
  rair: number;
  /** Diagnostics */
  plantedSurfaced: number;
  plantedCaught: number;
  adviceSurfaced: number;
  adviceAdopted: number;
  promptCount: number;
  revisionChainLength: number;
  verificationCount: number;
  deliberationRate: number;
  meanJuryBand: number;
  jurySpread: number;
  wordCount: number;
}

/** Final stance per claim id: last challenged/accepted turn wins. */
function finalStances(transcript: ReadonlyArray<T3Turn>): Map<string, "challenged" | "accepted"> {
  const stance = new Map<string, "challenged" | "accepted">();
  for (const t of transcript) {
    if ((t.verb === "challenged" || t.verb === "accepted") && t.object.startsWith("claim:")) {
      stance.set(t.object.slice("claim:".length), t.verb);
    }
  }
  return stance;
}

/** Longest revision chain following revisionOf links among 'revised' turns. */
export function revisionChainLength(transcript: ReadonlyArray<T3Turn>): number {
  const parent = new Map<string, string>();
  for (const t of transcript) {
    if (t.verb === "revised" && t.revisionOf) parent.set(t.object, t.revisionOf);
  }
  let best = 0;
  for (const start of parent.keys()) {
    let len = 0;
    let cur: string | undefined = start;
    const seen = new Set<string>();
    while (cur && parent.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parent.get(cur);
      len++;
    }
    best = Math.max(best, len);
  }
  return best;
}

export function scoreT3(
  artifact: T3Artifact,
  judgments: ReadonlyArray<Judgment>,
  cfg: T3Config,
): { raw: T3Raw; scaled: number } {
  const { transcript, finalAnswer } = artifact;
  const stance = finalStances(transcript);

  const surfacedIds = new Set<string>();
  for (const t of transcript) {
    if (t.verb === "assisted" && t.claimIds) for (const id of t.claimIds) surfacedIds.add(id);
  }

  // --- RSR (25): reject the seeded wrong outputs ---------------------------
  const plantedIds = cfg.plantedErrors.map((e) => e.id);
  const plantedSurfaced = plantedIds.filter((id) => surfacedIds.has(id));
  const plantedCaught = plantedSurfaced.filter((id) => stance.get(id) === "challenged");
  const rsr =
    plantedSurfaced.length > 0
      ? cfg.weights.rsr * (plantedCaught.length / plantedSurfaced.length)
      : 0;

  // --- RAIR (10): adopt correct advice; over-rejection is a failure --------
  const adviceIds = cfg.correctAdvice.map((a) => a.id);
  const adviceSurfaced = adviceIds.filter((id) => surfacedIds.has(id));
  const adviceAdopted = adviceSurfaced.filter((id) => stance.get(id) === "accepted");
  const rair =
    adviceSurfaced.length > 0
      ? cfg.weights.rair * (adviceAdopted.length / adviceSurfaced.length)
      : 0;

  // --- Process (20): decomposition, iteration, verification, deliberation --
  const promptCount = transcript.filter((t) => t.verb === "prompted").length;
  const chain = revisionChainLength(transcript);
  const verificationCount = transcript.filter((t) => t.verb === "verified").length;
  const actedOn = [...surfacedIds].filter((id) => stance.has(id)).length;
  const deliberationRate = surfacedIds.size > 0 ? actedOn / surfacedIds.size : 0;
  const q = cfg.weights.process / 4;
  const process =
    q * clamp01(promptCount / 3) +      // decomposition into multiple prompts
    q * clamp01(chain / 2) +            // iterative revision chain (revision_of)
    q * clamp01(verificationCount / 2) + // went back to the primary source
    q * deliberationRate;               // deliberate stance on surfaced claims

  // --- Analysis (45): stored jury judgments only ---------------------------
  const analysisJ = judgments.filter((j) => j.dimension === "analysis");
  const meanJuryBand =
    analysisJ.length > 0
      ? analysisJ.reduce((s, j) => s + j.value, 0) / analysisJ.length
      : 0;
  const jurySpread =
    analysisJ.length > 0
      ? Math.max(...analysisJ.map((j) => j.value)) - Math.min(...analysisJ.map((j) => j.value))
      : 0;
  const wordCount = finalAnswer.trim().length === 0 ? 0 : finalAnswer.trim().split(/\s+/).length;
  const lengthFactor = cfg.minWords > 0 ? clamp01(wordCount / cfg.minWords) : 1;
  const analysis = cfg.weights.analysis * (meanJuryBand / RUBRIC_BAND_MAX) * lengthFactor;

  const raw: T3Raw = {
    rsr: round3(rsr),
    analysis: round3(analysis),
    process: round3(process),
    rair: round3(rair),
    plantedSurfaced: plantedSurfaced.length,
    plantedCaught: plantedCaught.length,
    adviceSurfaced: adviceSurfaced.length,
    adviceAdopted: adviceAdopted.length,
    promptCount,
    revisionChainLength: chain,
    verificationCount,
    deliberationRate: round3(deliberationRate),
    meanJuryBand: round3(meanJuryBand),
    jurySpread: round3(jurySpread),
    wordCount,
  };
  return { raw, scaled: round3(raw.rsr + raw.analysis + raw.process + raw.rair) };
}
