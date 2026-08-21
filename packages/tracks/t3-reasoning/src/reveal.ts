/**
 * T3 reveal summary — PURE presentation helper over already-captured data.
 * Derives, for every planted error, whether the candidate challenged,
 * accepted, or ignored the claim, plus the caught-X-of-Y headline. No
 * events, no scoring: the reveal renders exactly what the transcript and
 * stance log already contain.
 */
import type { T3Config } from "./types.js";

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
  const rows: RevealRow[] = cfg.plantedErrors.map((e) => ({
    id: e.id,
    claim: e.claim,
    truth: e.truth,
    surfaced: surfaced.includes(e.id),
    stance: stances[e.id] ?? "ignored",
  }));
  const caught = rows.filter((r) => r.stance === "challenged").length;
  const total = rows.length;
  return { rows, caught, total, perfect: total > 0 && caught === total };
}
