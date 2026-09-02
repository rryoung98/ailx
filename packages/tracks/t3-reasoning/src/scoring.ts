/**
 * T3 pure scoring — spec §T3 "Score allocation". 160 points.
 *   50 RSR    planted-error detection: caught & rejected seeded wrong outputs
 *   30 RAIR   deliberate adoption of correct advice
 *   35        process quality from the transcript (a quarter of it is
 *             DISCRIMINATING verification — see {@link verificationTally})
 *   45        analysis quality from STORED jury judgments (never called here)
 * 115 of 160 points are model-free measurement of behaviour.
 * No I/O, no clock, no randomness.
 *
 * THE TRACK'S NAMED CONSTRUCT IS CALIBRATED RELIANCE — knowing when to use
 * the model and when not to. It used to be a 10-point afterthought called
 * "appropriate reliance" inside a track named for reasoning.
 *
 * The construct is worth stating carefully, because the obvious designs for
 * it all fail:
 *
 *  - **Asking is useless.** On an exam called the AI Literacy Examination, a
 *    candidate asked whether they would use AI learns within two items that
 *    the sophisticated answer is "not here, and I would verify". A
 *    situational-judgement item on this construct measures test-wiseness.
 *  - **There is no defensible answer key.** "Should you use AI for this?" is
 *    normative and contested. Any keyed should-not-use item is a values claim
 *    wearing a psychometric coat.
 *  - **Under-use is a failure too.** A one-directional "abstained = correct"
 *    key scores Luddism as literacy.
 *
 * The design that survives all three is not to ask but to make the model
 * genuinely asymmetric and measure what the candidate did. On a planted-error
 * claim the assistant is actively harmful, so rejecting it is appropriate
 * NON-reliance (RSR). On a correct-advice claim it is right and faster, so
 * adopting it is appropriate reliance (RAIR). The key is then an empirical
 * one — did the model make the answer better — not a normative one, and it is
 * two-tailed by construction. {@link relianceIndex} reports both tails.
 *
 * HONESTY NOTE ON THE EVIDENCE. RSR and RAIR are named after the appropriate-
 * reliance literature, but the two-tailed INDEX below is AILX's own
 * construction: we have found no published index or scoring scheme for
 * calibrated reliance to inherit, and no published validity evidence for this
 * one. It is defended here on design grounds — it is behavioural, keyless,
 * un-gameable by verbal sophistication and symmetric — and it is reported
 * with its two tails visible rather than collapsed into a single number that
 * would hide which failure a candidate made. Treat it as descriptive until it
 * has been validated against something external.
 *
 * RAIR (F5): appropriate reliance is a SEQUENCE, not a final stance. A claim
 * must first be deliberated — challenged, or THAT claim checked against the
 * source after it surfaced — before its acceptance earns full credit. A blind
 * instant accept of correct advice earns half credit: the candidate happened
 * to be right, but exhibited the same behaviour that swallows planted errors.
 *
 * VERIFICATION (TEN-30): the verification quarter of Process scores checks
 * that RESOLVED a claim, never the number of checks. Rationale and the limit
 * of what the transcript can show are on {@link verificationTally}.
 *
 * TIME CONDITION (TEN-30): a form may declare `timeBudgetMinutes`, so the
 * same task can be run at 90 minutes or at 30 and the record says which. The
 * value is copied into raw as `condition.timeBudgetMinutes` and changes no
 * arithmetic. A form that declares nothing records 0 and behaves exactly as
 * before.
 *
 * Analysis (F6): stored jury judgment values are NORMALIZED [0,1] by contract
 * (JudgeResponse.value); out-of-range stored values throw. The word-count
 * length gate against cfg.minWords is a DECLARED rubric device: it multiplies
 * the jury score, is capped at 1 (it can only withhold credit for an
 * under-length answer, never add), and is reported in raw as
 * 'analysis.lengthGate'. The component is clamped to [0, weights.analysis].
 */
import type { Judgment } from "@ailx/core";
import { meanValue, round3, validatedValues } from "@ailx/core";
import type { T3Artifact, T3Config, T3Turn } from "./types.js";

/** Demo jury band scale — DemoJudge normalizes bands 0..5 to [0,1] by /5. */
export const RUBRIC_BAND_MAX = 5;

/**
 * Planted errors a form must SURFACE before its RSR rate is worth reporting
 * as a rate.
 *
 * Four was the shipped number and 50 points now ride on it. A four-item
 * subtest cannot have usable reliability: catching 2 of 4 versus 3 of 4 is a
 * 12.5-point difference decided by essentially one event. Eight is the floor
 * this file will report against; `raw['rsr.underpowered']` is 1 when a
 * sitting came in under it, so an underpowered RSR is visible in the record
 * rather than inferred from the form.
 */
export const RSR_MIN_SURFACED = 8;

/**
 * |relianceIndex| within this band is reported as CALIBRATED. Declared
 * constant, not a fitted threshold — there is no validation set to fit it on.
 */
export const RELIANCE_CALIBRATED_BAND = 0.25;

export type RelianceBand = "over-reliant" | "calibrated" | "under-reliant";

export interface Reliance {
  /** Surfaced planted errors the candidate did NOT challenge, in [0,1]. */
  over: number;
  /** Surfaced correct advice the candidate did NOT adopt, in [0,1]. */
  under: number;
  /**
   * `under − over`, in [−1, 1]. Negative is over-reliance (swallowed the
   * model's errors), positive is under-reliance (refused its correct help),
   * zero is calibrated. The two tails are reported separately as well,
   * because a candidate who fails BOTH ways averages to zero and must not be
   * read as calibrated — {@link relianceBand} takes both tails, not the index.
   */
  index: number;
  band: RelianceBand;
}

/**
 * Two-tailed reliance from the two halves already measured.
 *
 * The band is deliberately NOT a function of `index` alone. A candidate who
 * swallowed every planted error AND refused every correct suggestion has
 * over = 1, under = 1, index = 0 — arithmetically "calibrated" and
 * behaviourally the worst possible run. When both tails are large the band
 * reports the LARGER failure rather than their difference.
 */
export function relianceBand(over: number, under: number): RelianceBand {
  const index = under - over;
  if (Math.abs(index) <= RELIANCE_CALIBRATED_BAND) {
    // Both tails small: genuinely calibrated. Both tails large: failing in
    // both directions, and the bigger failure names the band.
    if (over <= RELIANCE_CALIBRATED_BAND && under <= RELIANCE_CALIBRATED_BAND) {
      return "calibrated";
    }
    return over >= under ? "over-reliant" : "under-reliant";
  }
  return index < 0 ? "over-reliant" : "under-reliant";
}

/** Reliance over one sitting's surfaced/caught/adopted counts. Pure. */
export function relianceIndex(
  plantedSurfaced: number,
  plantedCaught: number,
  adviceSurfaced: number,
  adviceAdopted: number,
): Reliance {
  const over = plantedSurfaced > 0 ? (plantedSurfaced - plantedCaught) / plantedSurfaced : 0;
  const under = adviceSurfaced > 0 ? (adviceSurfaced - adviceAdopted) / adviceSurfaced : 0;
  return { over, under, index: under - over, band: relianceBand(over, under) };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

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
  /**
   * DISTINCT surfaced claims checked against the source (`verifiedClaimIds`).
   * VOLUME. Reported as a diagnostic and scored nowhere — see
   * {@link verificationTally}.
   */
  verificationCount: number;
  /** Checks that could be judged: known-status claims, checked before the answer was final. */
  verificationsChecked: number;
  /** Of those, the ones whose check was followed by the right call on the claim. */
  discriminatingVerifications: number;
  /** The scored rate, `discriminating / max(checked, DISCRIMINATING_MIN_CHECKS)`. */
  discriminatingVerificationRate: number;
  deliberationRate: number;
  meanJuryBand: number;
  jurySpread: number;
  wordCount: number;
  /** Declared length gate multiplier applied to the analysis component. */
  "analysis.lengthGate": number;
  /**
   * The two-tailed reliance report — the track's named construct.
   * `reliance.index` is under − over; the band is derived from BOTH tails
   * (see {@link relianceBand}) and is a string, so it is reported next to the
   * raw record rather than inside it.
   */
  "reliance.over": number;
  "reliance.under": number;
  "reliance.index": number;
  /** 1 when the form surfaced fewer than RSR_MIN_SURFACED planted errors. */
  "rsr.underpowered": number;
  /**
   * The time budget the FORM declared for this sitting, in minutes, or 0 when
   * it declared none (every sitting before TEN-30). Carried into the stored
   * record so a later analysis can compare the 90- and 30-minute conditions
   * without guessing what a sitting ran under. It is a label, not a score:
   * nothing in score() branches on it.
   */
  "condition.timeBudgetMinutes": number;
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
 * Checks needed before the verification term can pay in full. Two distinct
 * DISCRIMINATING checks, the same scale as the volume rule this replaced.
 */
export const DISCRIMINATING_MIN_CHECKS = 2;

/**
 * What one sitting's verification behaviour was worth.
 *
 * `checked` is the denominator: distinct claims of KNOWN truth status that
 * the candidate checked after the assistant raised them and before the
 * answer was final. `discriminating` is the subset the check resolved.
 */
export interface VerificationTally {
  checked: number;
  discriminating: number;
  /** `discriminating / max(checked, DISCRIMINATING_MIN_CHECKS)`, in [0,1]. */
  rate: number;
}

/**
 * DISCRIMINATING VERIFICATION — the scored verification measure (TEN-30).
 *
 * The old rule paid for volume: two distinct claims checked, full quarter of
 * the Process component, whatever the checks found. Volume is the wrong
 * target. A candidate who knows the transcript is scored can check every
 * claim and learn nothing, and that performative checking is the behaviour
 * this track exists to detect.
 *
 * A check counts as discriminating when all of these hold:
 *
 *  1. it names the claim it checked (`object: 'claim:<id>'`) and that claim
 *     was raised by the assistant first — the existing {@link verifiedClaimIds}
 *     rule;
 *  2. the form knows whether the claim was true: it is a planted error or a
 *     correct-advice claim. A surfaced claim in neither list is dropped from
 *     numerator AND denominator, because nothing in the record says whether
 *     there was an error to find;
 *  3. the check happened before the `submitted` turn. A check after the
 *     answer is final cost the candidate nothing and changed nothing;
 *  4. the candidate's final stance BEFORE the answer was final was recorded
 *     after the check, and it resolves the claim the right way: challenged a
 *     planted error, accepted correct advice. A stance taken after the
 *     `submitted` turn changed nothing the candidate wrote, so it neither
 *     earns nor removes credit.
 *
 * Repeat checks of one claim count once, in both halves of the fraction.
 *
 * WHAT THIS CANNOT SEE, stated plainly. The transcript records that a claim
 * was checked, not what the candidate read. So "discriminating" here means
 * *the check was followed by the right call on that claim*, not *the
 * candidate found the discrepancy in the source*. A lucky call after an
 * idle press scores the same as a real one. Separating those two needs an
 * event we do not record — which passage the candidate opened, and whether
 * they marked a mismatch — and inventing that event before the timed/untimed
 * arm of `docs/TRANSFER-STUDY.md` §3.5 runs would be building an instrument
 * for a study nobody has designed. What the rule DOES buy is that checking
 * everything no longer pays: every check the candidate does not resolve, or
 * resolves the wrong way, sits in their denominator and pays nothing.
 *
 * The planted half overlaps RSR by construction (RSR pays for the stance,
 * this pays for the check that preceded it). That is deliberate: the two
 * components measure the outcome and the process that produced it, and the
 * verification term is a quarter of Process, not a second RSR.
 */
export function verificationTally(
  transcript: ReadonlyArray<T3Turn>,
  plantedIds: ReadonlyArray<string>,
  adviceIds: ReadonlyArray<string>,
): VerificationTally {
  const planted = new Set(plantedIds);
  const advice = new Set(adviceIds);
  const submittedAt = transcript.findIndex((t) => t.verb === "submitted");
  const answerFinalAt = submittedAt < 0 ? transcript.length : submittedAt;

  const surfacedAt = new Map<string, number>();
  const finalStanceAt = new Map<string, { at: number; verb: "challenged" | "accepted" }>();
  transcript.forEach((t, i) => {
    if (t.verb === "assisted" && t.claimIds) {
      for (const id of t.claimIds) if (!surfacedAt.has(id)) surfacedAt.set(id, i);
    }
    // Both halves of the coupling stop at the answer: a stance recorded after
    // the candidate submitted changed nothing they wrote.
    if (i < answerFinalAt && (t.verb === "challenged" || t.verb === "accepted") && t.object.startsWith("claim:")) {
      finalStanceAt.set(t.object.slice("claim:".length), { at: i, verb: t.verb });
    }
  });

  const firstCheckAt = new Map<string, number>();
  transcript.forEach((t, i) => {
    if (i >= answerFinalAt) return;
    if (t.verb !== "verified" || !t.object.startsWith("claim:")) return;
    const id = t.object.slice("claim:".length);
    if (!planted.has(id) && !advice.has(id)) return;
    const raisedAt = surfacedAt.get(id);
    if (raisedAt === undefined || i <= raisedAt) return;
    if (!firstCheckAt.has(id)) firstCheckAt.set(id, i);
  });

  let discriminating = 0;
  for (const [id, checkedAt] of firstCheckAt) {
    const stance = finalStanceAt.get(id);
    if (!stance || stance.at <= checkedAt) continue;
    const resolves = planted.has(id) ? "challenged" : "accepted";
    if (stance.verb === resolves) discriminating++;
  }
  const checked = firstCheckAt.size;
  return {
    checked,
    discriminating,
    rate: discriminating / Math.max(checked, DISCRIMINATING_MIN_CHECKS),
  };
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

/**
 * Stored jury values for the analysis dimension, RANGE-CHECKED and in the
 * canonical ascending order — F6.
 *
 * The order matters to the arithmetic, not just to the eye. These values are
 * averaged, floating-point addition is not associative, and stored rows
 * arrive in whatever order the database returns them: the three legal values
 * [0.1, 0.2, 0.30000000000000004] mean 0.20000000000000004 in one permutation
 * and 0.19999999999999998 in another, and the jury values [0.69, 0.41,
 * 0.5831666666666665] carry that difference past round3 — 25.247 points in
 * two arrival orders, 25.248 in the other four (pinned in test/score.test.ts).
 * So the values are canonically sorted before they
 * are summed and the result is order-invariant BY CONSTRUCTION. The one
 * implementation lives in `@ailx/core` (`judgments.ts`); T1 and T4 share it.
 */
function validatedAnalysisValues(judgments: ReadonlyArray<Judgment>): number[] {
  return validatedValues(judgments, "analysis", "t3");
}

export function scoreT3(
  artifact: T3Artifact,
  judgments: ReadonlyArray<Judgment>,
  cfg: T3Config,
): { raw: T3Raw; scaled: number; reliance: Reliance } {
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
  const verification = verificationTally(transcript, plantedIds, adviceIds);
  const q = cfg.weights.process / 4;
  const process =
    q * clamp01(promptCount / 3) +      // decomposition into multiple prompts
    q * clamp01(chain / 2) +            // iterative revision chain (revision_of)
    q * verification.rate +             // checks that RESOLVED a claim (TEN-30)
    q * deliberationRate;               // deliberate stance on surfaced claims

  // --- Analysis (45): stored jury judgments only — F6 ----------------------
  const vals = validatedAnalysisValues(judgments);
  const meanJury = meanValue(vals);
  const jurySpread = vals.length > 0 ? Math.max(...vals) - Math.min(...vals) : 0;
  const wordCount = finalAnswer.trim().length === 0 ? 0 : finalAnswer.trim().split(/\s+/).length;
  // Declared length gate: capped at 1 — can only withhold, never add.
  const lengthGate = cfg.minWords > 0 ? clamp01(wordCount / cfg.minWords) : 1;
  const analysis = Math.min(
    cfg.weights.analysis,
    Math.max(0, cfg.weights.analysis * meanJury * lengthGate),
  );

  const reliance = relianceIndex(
    plantedSurfaced.length,
    plantedCaught.length,
    adviceSurfaced.length,
    adviceAdopted.length,
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
    verificationsChecked: verification.checked,
    discriminatingVerifications: verification.discriminating,
    discriminatingVerificationRate: round3(verification.rate),
    deliberationRate: round3(deliberationRate),
    meanJuryBand: round3(meanJury),
    jurySpread: round3(jurySpread),
    wordCount,
    "analysis.lengthGate": round3(lengthGate),
    "reliance.over": round3(reliance.over),
    "reliance.under": round3(reliance.under),
    "reliance.index": round3(reliance.index),
    "rsr.underpowered": plantedSurfaced.length < RSR_MIN_SURFACED ? 1 : 0,
    "condition.timeBudgetMinutes": cfg.timeBudgetMinutes ?? 0,
  };
  return {
    raw,
    scaled: round3(raw.rsr + raw.analysis + raw.process + raw.rair),
    reliance,
  };
}
