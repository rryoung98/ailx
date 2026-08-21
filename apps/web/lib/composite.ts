/**
 * Candidate composite over the deterministic demo cohort (44 synthetic peers
 * + the candidate = n 45, matching the pilot). Pure given the session state.
 */

import {
  demoCohort, scoreCohort, TRACK_IDS,
  type SessionState, type TrackRawScores,
} from "@ailx/session";
import { DEMO_COHORT_SEED, DEMO_COHORT_SIZE } from "./demo";
import type { CompositeSummary } from "./exportTiers";

export interface CandidateComposite extends CompositeSummary {
  cohortSize: number;
  trackRaw: TrackRawScores;
  cohortComposites: number[];
}

export function candidateComposite(state: SessionState): CandidateComposite | null {
  const trackRaw = {} as TrackRawScores;
  for (const t of TRACK_IDS) {
    const s = state.tracks[t].score;
    if (!s) return null;
    trackRaw[t] = s.scaled;
  }
  const cohort = demoCohort(DEMO_COHORT_SEED, DEMO_COHORT_SIZE);
  const all = [...cohort, trackRaw];
  const r = scoreCohort(all);
  const i = all.length - 1;
  return {
    composite: r.composite[i],
    percentile: r.percentile[i],
    band: r.band[i],
    zComposite: r.zComposite[i],
    cohortSize: all.length,
    trackRaw,
    cohortComposites: r.composite,
  };
}
