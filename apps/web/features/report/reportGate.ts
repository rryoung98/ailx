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
 * server-issued score into the log. That is TEN-92's open question, and the
 * log is the browser's record of what the browser computed: a value it did
 * not compute has no replay behind it, and `replayTrackScore` would have
 * nothing to check.
 *
 * Pure: state in, copy out. No fetch, no clock, no storage.
 */
import type { TrackId } from "@ailx/session";
import type { AttemptScores } from "./scoresOfRecord";

export interface GateInput {
  /** Tracks this browser holds a score for, from the local event log. */
  readonly localScored: readonly TrackId[];
  /** The service's answer, or null when it gave none (or there is no service). */
  readonly scores: AttemptScores | null;
  /** True while the first read of the service's scores is still in flight. */
  readonly reading: boolean;
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
    return {
      headline: "Your sitting is finished",
      lede:
        `The exam service issued the scores of record for this sitting and they are below. ` +
        (pending > 0
          ? `${pending === 1 ? "One track is" : `${pending} tracks are`} still being judged, and this page checks for the score. `
          : "") +
        "There is no composite here: the composite is computed from the scores this browser issued, " +
        "and it did not issue these.",
      cta: null,
      scored,
    };
  }
  return {
    headline: "The report is the reward",
    lede: `${scored.length} of 4 tracks scored. Finish the run to unlock it.`,
    cta: { href: "/exam", label: "Continue →" },
    scored,
  };
}
