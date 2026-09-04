/**
 * WHO ISSUED — OR WILL ISSUE — THE SCORE FOR EACH TRACK OF A SITTING.
 *
 * A hosted T2 or T3 is marked by the exam service, which holds the answer key
 * this browser must not have, and TEN-66 made `/finalize` the only pass that
 * issues those scores. So a completed hosted track legitimately carries NO
 * score in the local log, and the run hub must say that rather than claim a
 * number it does not have.
 *
 * It said the opposite. On the live run of 2026-09-04 the completion screen
 * read "All four tracks are scored" directly above the error saying two of
 * them were not (TEN-129). This module is the one place that decides that
 * sentence, and it is pure: it reads the projected session state and nothing
 * else — no fetch, no clock, no storage.
 */
import { TRACK_META } from "@ailx/report";
import type { TrackId } from "@ailx/session";

/** The projection fields this module reads. Narrow on purpose. */
export interface ScoreSourceState {
  readonly order: readonly TrackId[];
  readonly tracks: Readonly<Record<TrackId, { status: string; score?: unknown }>>;
}

/**
 * Completed tracks whose score is the exam service's to issue, in run order.
 *
 * The test is "completed, and this browser holds no score for it". It is not
 * a hard-coded T2/T3 list: the static demo scores every track locally and
 * returns nothing here, and a hosted run that gains a locally scored track
 * needs no edit to keep telling the truth.
 */
export function tracksScoredByService(state: ScoreSourceState): TrackId[] {
  return state.order.filter(
    (t) => state.tracks[t].status === "completed" && state.tracks[t].score === undefined,
  );
}

/** "T2" · "T2 and T3" · "T2, T3 and T4" — the Oxford-free English list. */
export function trackList(ids: readonly TrackId[]): string {
  const codes = ids.map((t) => TRACK_META[t].code);
  if (codes.length <= 1) return codes.join("");
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}

/**
 * What the run hub says when the run is over. One sentence per fact, and no
 * sentence the same screen can contradict.
 */
export function completionSummary(state: ScoreSourceState): string {
  const awaiting = tracksScoredByService(state);
  const scored = state.order.filter(
    (t) => state.tracks[t].status === "completed" && state.tracks[t].score !== undefined,
  );
  if (awaiting.length === 0) {
    return `All ${scored.length} tracks are scored in this browser. The diagnostic report is the real reward.`;
  }
  const many = awaiting.length > 1;
  return (
    `Your work is recorded for every track you sat. ${trackList(awaiting)} ` +
    `${many ? "are" : "is"} marked by the exam service, which issues ` +
    `${many ? "those scores" : "that score"} when your sitting is finalized. ` +
    "Your report shows what it issued."
  );
}

/**
 * What the track list shows beside a track the service marks. The local
 * formatter would say "recorded, not scored", which is true of this browser
 * and reads as a failure — the score is not missing, it is somebody else's.
 */
export const SERVICE_SCORES_THIS_TRACK = "scored by the exam service";
