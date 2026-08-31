/**
 * T3 reveal summary — PURE presentation helper over already-captured data.
 * Derives, for every planted error, whether the candidate challenged,
 * accepted, or ignored the claim, plus the caught-X-of-Y headline. No
 * events, no scoring: the reveal renders exactly what the transcript and
 * stance log already contain.
 */
import type { T3Config, T3RevealedPlant } from "./types.js";

export type RevealStance = "challenged" | "accepted" | "ignored";

export interface RevealRow {
  id: string;
  claim: string;
  truth: string;
  /** Whether the assistant ever surfaced this claim in the chat. */
  surfaced: boolean;
  stance: RevealStance;
}

export interface RevealSummary {
  rows: RevealRow[];
  /** Planted errors the candidate challenged. */
  caught: number;
  /** Total planted errors in the scenario (the Y in "X of Y"). */
  total: number;
  /** caught === total → celebratory rendering. */
  perfect: boolean;
}

export function revealSummary(
  cfg: Pick<T3Config, "plantedErrors">,
  surfaced: readonly string[],
  stances: Record<string, "challenged" | "accepted">,
): RevealSummary {
  return summarize(
    cfg.plantedErrors.map((e) => ({
      id: e.id,
      claim: e.claim,
      truth: e.truth,
      surfaced: surfaced.includes(e.id),
      stance: stances[e.id] ?? "ignored",
    })),
  );
}

/**
 * HOSTED reveal. The rows are the SERVER's — `plants` from the review-phase
 * track view, where `surfaced` and `stance` were derived from the
 * append-only transcript, not from anything this tab remembers. The claim is
 * named by its opaque `ref`, the same handle the stance was attached to; the
 * browser still never learns which ref was a plant until the server says so,
 * and it only says so after `attempts.finalized_at`.
 */
export function revealSummaryFromPlants(
  plants: readonly T3RevealedPlant[],
): RevealSummary {
  return summarize(
    plants.map((p) => ({
      id: p.ref,
      claim: p.claim,
      truth: p.truth,
      surfaced: p.surfaced,
      stance: p.stance,
    })),
  );
}

/** The caught-X-of-Y headline over rows either side already derived. */
function summarize(rows: RevealRow[]): RevealSummary {
  const caught = rows.filter((r) => r.stance === "challenged").length;
  const total = rows.length;
  return { rows, caught, total, perfect: total > 0 && caught === total };
}
