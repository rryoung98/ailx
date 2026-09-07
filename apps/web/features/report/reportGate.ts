/**
 * WHAT THE REPORT SAYS WHEN IT CANNOT SHOW A COMPOSITE.
 *
 * The gate used to read ONE source — the local event log — and say
 * "N of 4 tracks scored. Finish the run to unlock it." A hosted sitting is
 * scored by the exam service at finalize, and nothing writes those scores
 * into the browser's log, so the sentence was permanent: the live run of
 * 2026-09-04 finished, finalized, was scored by the service, and still read
 * "3 of 4 tracks scored" with a "Continue →" that led back to /exam and from
 * there back to this screen (TEN-128). A closed loop with no exit.
 *
 * So the gate counts a score of record wherever it was issued: this browser's
 * log, and the `scores` object the service returns on `GET /attempts/:id` —
 * the same read the Scores of record panel renders. It does NOT copy a
 * server-issued score into the log. TEN-92 settled that: the log is the
 * browser's record of what the browser computed, a value it did not compute
 * has no replay behind it, and `replayTrackScore` would have nothing to
 * check. So the SERVICE issues the composite for a hosted sitting, and this
 * lede stopped denying that a composite exists.
 *
 * Pure: state in, copy out. No fetch, no clock, no storage.
 */
import { TRACK_IDS, type TrackId } from "@ailx/session";
import { trackList } from "../../lib/instrument/scoreSources";
import type { AttemptScores } from "./scoresOfRecord";

export interface GateInput {
  /** Tracks this browser holds a score for, from the local event log. */
  readonly localScored: readonly TrackId[];
  /** The service's answer, or null when it gave none (or there is no service). */
  readonly scores: AttemptScores | null;
  /** True while the first read of the service's scores is still in flight. */
  readonly reading: boolean;
  /**
   * The sitting as THIS BROWSER's log has it: whether the run was finished,
   * and which tracks were actually sat.
   *
   * A candidate with no model connected sits the model-free tracks and
   * finishes there (TEN-149). Without this the gate told them "2 of 4 tracks
   * scored. Finish the run to see it." with a Continue that goes to /exam,
   * which sends them straight back — the TEN-128 closed loop, still open for
   * a run the service never saw. The run IS finished; what it is missing is
   * two tracks that were never sat, and that is a different sentence.
   */
  readonly localSitting?: { readonly completed: boolean; readonly sat: readonly TrackId[] };
}

export interface GateView {
  readonly headline: string;
  readonly lede: string;
  /** Where a candidate can usefully go next, or null when nowhere is. */
  readonly cta: { readonly href: string; readonly label: string } | null;
  /** Tracks with a score of record, from either source. Test-readable. */
  readonly scored: readonly TrackId[];
}

/** Every track with a score of record, wherever it was issued, deduplicated. */
export function scoredTracks(input: Pick<GateInput, "localScored" | "scores">): TrackId[] {
  const server = (input.scores?.tracks ?? [])
    .filter((t) => t.state === "scored")
    .map((t) => t.trackId);
  return [...new Set([...input.localScored, ...server])];
}

export function reportGate(input: GateInput): GateView {
  const scored = scoredTracks(input);
  if (input.reading) {
    return {
      headline: "The report is the reward",
      lede: "Checking what the exam service has issued for this sitting…",
      cta: null,
      scored,
    };
  }
  if (input.scores?.finalized === true) {
    const pending = input.scores.tracks.filter((t) => t.state === "pending_judging").length;
    /* The composite is the service's for a hosted sitting (TEN-92), so this
       lede stopped denying one exists. It still does not claim one where the
       service issued none: a withheld composite says its own reason on the
       page below, and a service too old to send the field says nothing at
       all rather than a sentence that would then be wrong. */
    const issued = input.scores.composite?.state === "issued";
    return {
      headline: "Your sitting is finished",
      lede:
        `The scores of record are below, issued by the exam service. ` +
        (pending > 0
          ? `${pending === 1 ? "One track is" : `${pending} tracks are`} still being judged, and this page checks for the score. `
          : "") +
        (issued
          ? "It issued the composite too: this browser did not compute it and claims no replay of it."
          : input.scores.composite?.state === "withheld"
            ? ""
            : "No composite here: it is computed from the scores this browser issued, " +
              "and it did not issue these."),
      cta: null,
      scored,
    };
  }
  const local = input.localSitting;
  if (local?.completed === true) {
    const notSat = TRACK_IDS.filter((t) => !local.sat.includes(t));
    if (notSat.length > 0) {
      /* A finished PARTIAL sitting. It is not unfinished and there is
         nothing to go back for, so no Continue: the honest answer is which
         tracks were sat, and why no composite follows from a subset. The
         reason is the same one the service gives for a withheld composite
         (WITHHELD_LEDE.awaiting_track) — one fact, said the same way. */
      return {
        headline: "Your sitting is finished",
        lede:
          `You sat ${trackList(local.sat)}. ${trackList(notSat)} ` +
          `${notSat.length === 1 ? "was" : "were"} not sat, so this sitting covers part of the ` +
          "instrument. A composite needs every scored track — the weights are shares of the " +
          "whole instrument and the band ranks you against peers who sat all of it — so none " +
          "is issued here rather than a different number under the same name. What you sat is " +
          "scored below.",
        cta: null,
        scored,
      };
    }
  }
  return {
    headline: "The report is the reward",
    // "unlock" is game-economy language this product bans elsewhere
    // (progressPage.test.tsx pins its absence on /progress). "see" is the
    // plain word and one syllable shorter.
    lede: `${scored.length} of 4 tracks scored. Finish the run to see it.`,
    cta: { href: "/exam", label: "Continue →" },
    scored,
  };
}
