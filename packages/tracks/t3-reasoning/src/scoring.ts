/**
 * T3 pure scoring — spec §T3 "Score allocation".
 *   25 RSR    planted-error detection: caught & rejected seeded wrong outputs
 *   45        analysis quality from STORED jury judgments (never called here)
 *   20        process quality from the transcript
 *   10 RAIR   appropriate reliance: adopting correct advice AFTER deliberation
 * 35 of 100 points are model-free measurement of behaviour.
 * No I/O, no clock, no randomness.
 *
 * RAIR (F5): appropriate reliance is a SEQUENCE, not a final stance. A claim
 * must first be deliberated — challenged, or THAT claim checked against the
 * source after it surfaced — before its acceptance earns full credit. A blind
 * instant accept of correct advice earns half credit: the candidate happened
 * to be right, but exhibited the same behaviour that swallows planted errors.
 *
 * Analysis (F6): stored jury judgment values are NORMALIZED [0,1] by contract
 * (JudgeResponse.value); out-of-range stored values throw. The word-count
 * length gate against cfg.minWords is a DECLARED rubric device: it multiplies
 * the jury score, is capped at 1 (it can only withhold credit for an
 * under-length answer, never add), and is reported in raw as
 * 'analysis.lengthGate'. The component is clamped to [0, weights.analysis].
 */
import type { Judgment } from "@ailx/core";
import type { T3Artifact, T3Config, T3Turn } from "./types.js";

/** Demo jury band scale — DemoJudge normalizes bands 0..5 to [0,1] by /5. */
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
  /** Advice claims accepted only after deliberation (full RAIR credit). */
  adviceDeliberated: number;
  promptCount: number;
  revisionChainLength: number;
  /** DISTINCT surfaced claims checked against the source (`verifiedClaimIds`). */
  verificationCount: number;
  deliberationRate: number;
  meanJuryBand: number;
  jurySpread: number;
  wordCount: number;
  /** Declared length gate multiplier applied to the analysis component. */
  "analysis.lengthGate": number;
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

/**
 * Distinct claims the candidate checked against the primary source.
 *
 * A `verified` turn only counts when it names the claim it checked
 * (`object: 'claim:<id>'`) and that claim was actually surfaced by the
 * assistant first. Repeat presses on the same claim count once (F5: the old
 * rule paid a quarter of the Process component for two presses of one
 * button, with no claim involved and no source read). An unattributed
 * `verified` turn — the old `object: 'source'` shape — earns nothing: it is
 * evidence that a panel was opened, not that anything was checked.
 */
export function verifiedClaimIds(transcript: ReadonlyArray<T3Turn>): Set<string> {
  const surfaced = new Set<string>();
  const out = new Set<string>();
  for (const t of transcript) {
    if (t.verb === "assisted" && t.claimIds) for (const id of t.claimIds) surfaced.add(id);
    if (t.verb === "verified" && t.object.startsWith("claim:")) {
      const id = t.object.slice("claim:".length);
      if (surfaced.has(id)) out.add(id);
    }
  }
  return out;
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

/**
 * RAIR credit for one correct-advice claim, in {0, 0.5, 1} — F5.
 * Order is read from transcript array position (the transcript is
 * append-only; array order is event order).
 */
export function rairCreditForClaim(
  transcript: ReadonlyArray<T3Turn>,
  claimId: string,
): number {
  const obj = `claim:${claimId}`;
  let surfacedAt = -1;
  let finalStance: "challenged" | "accepted" | null = null;
  let finalStanceAt = -1;
  let challengedBeforeFinal = false;
  const verifiedAt: number[] = [];
  transcript.forEach((t, i) => {
    if (t.verb === "assisted" && t.claimIds?.includes(claimId) && surfacedAt < 0) surfacedAt = i;
    if (t.verb === "verified" && t.object === obj) verifiedAt.push(i);
    if ((t.verb === "challenged" || t.verb === "accepted") && t.object === obj) {
      finalStance = t.verb;
      finalStanceAt = i;
    }
  });
  if (surfacedAt < 0 || finalStance !== "accepted") return 0;
  // Recompute: was this claim ever challenged before the FINAL accept?
  transcript.forEach((t, i) => {
    if (t.verb === "challenged" && t.object === obj && i < finalStanceAt) {
      challengedBeforeFinal = true;
    }
  });
  const verifiedBetween = verifiedAt.some((v) => v > surfacedAt && v < finalStanceAt);
  const deliberated = challengedBeforeFinal || verifiedBetween;
  return deliberated ? 1 : 0.5;
}

function validatedAnalysisValues(judgments: ReadonlyArray<Judgment>): number[] {
  return judgments
    .filter((j) => j.dimension === "analysis")
    .map((j) => {
      if (!Number.isFinite(j.value) || j.value < 0 || j.value > 1) {
        throw new Error(
          `t3 judgment out of range: dimension=${j.dimension} sample=${j.sample} value=${j.value} (expected normalized [0,1])`,
        );
      }
      return j.value;
    });
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

  // --- RAIR (10): deliberate adoption of correct advice — F5 ---------------
  const adviceIds = cfg.correctAdvice.map((a) => a.id);
  const adviceSurfaced = adviceIds.filter((id) => surfacedIds.has(id));
  const adviceAdopted = adviceSurfaced.filter((id) => stance.get(id) === "accepted");
  const credits = adviceSurfaced.map((id) => rairCreditForClaim(transcript, id));
  const adviceDeliberated = credits.filter((c) => c === 1).length;
  const rair =
    adviceSurfaced.length > 0
      ? cfg.weights.rair * (credits.reduce((s, c) => s + c, 0) / adviceSurfaced.length)
      : 0;

  // --- Process (20): decomposition, iteration, verification, deliberation --
  const promptCount = transcript.filter((t) => t.verb === "prompted").length;
  const chain = revisionChainLength(transcript);
  const verificationCount = verifiedClaimIds(transcript).size;
  const actedOn = [...surfacedIds].filter((id) => stance.has(id)).length;
  const deliberationRate = surfacedIds.size > 0 ? actedOn / surfacedIds.size : 0;
  const q = cfg.weights.process / 4;
  const process =
    q * clamp01(promptCount / 3) +      // decomposition into multiple prompts
    q * clamp01(chain / 2) +            // iterative revision chain (revision_of)
    q * clamp01(verificationCount / 2) + // checked 2 distinct claims at source
    q * deliberationRate;               // deliberate stance on surfaced claims

  // --- Analysis (45): stored jury judgments only — F6 ----------------------
  const vals = validatedAnalysisValues(judgments);
  const meanJury = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  const jurySpread = vals.length > 0 ? Math.max(...vals) - Math.min(...vals) : 0;
  const wordCount = finalAnswer.trim().length === 0 ? 0 : finalAnswer.trim().split(/\s+/).length;
  // Declared length gate: capped at 1 — can only withhold, never add.
  const lengthGate = cfg.minWords > 0 ? clamp01(wordCount / cfg.minWords) : 1;
  const analysis = Math.min(
    cfg.weights.analysis,
    Math.max(0, cfg.weights.analysis * meanJury * lengthGate),
  );

  const raw: T3Raw = {
    rsr: round3(rsr),
    analysis: round3(analysis),
    process: round3(process),
    rair: round3(rair),
    plantedSurfaced: plantedSurfaced.length,
    plantedCaught: plantedCaught.length,
    adviceSurfaced: adviceSurfaced.length,
    adviceAdopted: adviceAdopted.length,
    adviceDeliberated,
    promptCount,
    revisionChainLength: chain,
    verificationCount,
    deliberationRate: round3(deliberationRate),
    meanJuryBand: round3(meanJury),
    jurySpread: round3(jurySpread),
    wordCount,
    "analysis.lengthGate": round3(lengthGate),
  };
  return { raw, scaled: round3(raw.rsr + raw.analysis + raw.process + raw.rair) };
}
