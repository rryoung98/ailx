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
   * Whether this page ever ASKED the exam service for this sitting.
   *
   * "No scores came back" and "we never asked" are different facts, and only
   * the second one is true when the identity never resolved (the read cannot
   * fire without one) or when there is no exam service at all. Saying the
   * service "returned no scores, or could not be reached" in that case names
   * a request that was never made. Absent means: not known, say neither.
   */
  readonly asked?: boolean;
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

/**
 * THE SHAPE OF A FINISHED SITTING, FOR THE SURFACES THAT ACT ON IT.
 *
 * The credential panel and the share panel are offered on a FINISHED
 * sitting, and "finished" has two witnesses: the exam service says the
 * attempt is finalized, or this browser's own log says the run ended. Either
 * is enough — a run that finished with no model connected is finished
 * whether or not the service answered this page (TEN-149).
 *
 * `sat` is which tracks the sitting covered, so a partial sitting can be
 * NAMED as one everywhere it appears. The service's list wins when there is
 * one: `not_sat` is the service's own word for a track it holds no work for,
 * and it is the same fact the credential's name is built from.
 */
export interface SittingShape {
  readonly finished: boolean;
  readonly sat: readonly TrackId[];
  /** True when a finished sitting covered part of the instrument. */
  readonly partial: boolean;
}

export function sittingShape(
  input: Pick<GateInput, "scores" | "localSitting"> & { readonly localScored?: readonly TrackId[] },
): SittingShape {
  const service = input.scores;
  const finalized = service?.finalized === true;
  const finished = finalized || input.localSitting?.completed === true;
  /* A finalized sitting is described by the service: every track it names
     with a state other than `not_sat` was sat, whether or not it carries a
     number yet. A track it says nothing about is not claimed either way, so
     the local log fills the gap rather than the page inventing one. */
  /* What THIS BROWSER knows a track was sat by: the run log says it was
     completed, or the browser holds a score of record for it. A hosted
     sitting whose T1 and T4 were scored locally is a full sitting even when
     the service's list mentions only the two it marked itself. */
  const local = TRACK_IDS.filter(
    (t) => (input.localSitting?.sat ?? []).includes(t) || (input.localScored ?? []).includes(t),
  );
  const sat = finalized
    ? TRACK_IDS.filter((t) => {
        const record = service?.tracks.find((r) => r.trackId === t);
        return record === undefined ? local.includes(t) : record.state !== "not_sat";
      })
    : local;
  return { finished, sat, partial: finished && sat.length < TRACK_IDS.length };
}

/**
 * WHY A PARTIAL SITTING GETS NO COMPOSITE, SAID ONCE.
 *
 * Both branches below reach this fact — the service's finalized answer and
 * this browser's own log — and each used to word it its own way, so a copy
 * edit to one would have left the other saying something slightly different
 * about the same thing. One sentence, both callers. It is the same reason
 * the withheld card gives (`WITHHELD_LEDE.awaiting_track`): a subset cannot
 * produce this composite, so none is coming, whatever the jury does with the
 * tracks that were sat (D4, dogfood 2026-09-06).
 */
export function partialSittingLede(sat: readonly TrackId[], notSat: readonly TrackId[]): string {
  /* A finalized attempt can name EVERY track `not_sat`. `trackList([])` is
     the empty string, so the sentence read "You sat ." — and "covers part of
     the instrument" would be wrong as well, because it covers none of it. */
  const opening =
    sat.length === 0
      ? "No track in this sitting was sat."
      : `You sat ${trackList(sat)}. ${trackList(notSat)} ` +
        `${notSat.length === 1 ? "was" : "were"} not sat, so this sitting covers part of the ` +
        "instrument.";
  return (
    `${opening} A composite needs every scored track — the weights are shares of the whole ` +
    "instrument and the band ranks you against peers who sat all of it — so none is coming " +
    "for this sitting."
  );
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
    /* A FINALIZED PARTIAL SITTING IS NAMED AS ONE, HERE TOO (TEN-149).
       The credential this page offers is called "Partial Sitting (T2, T3)",
       and a lede that said only "your sitting is finished" would read as the
       whole instrument beside it. Which tracks were sat is the service's
       answer, not a guess (`sittingShape`). */
    const shape = sittingShape(input);
    const notSat = TRACK_IDS.filter((t) => !shape.sat.includes(t));
    return {
      headline: "Your sitting is finished",
      lede:
        `The scores of record are below, issued by the exam service. ` +
        (shape.partial ? `${partialSittingLede(shape.sat, notSat)} ` : "") +
        (pending > 0
          ? `${pending === 1 ? "One track is" : `${pending} tracks are`} still being judged, and this page checks for the score. `
          : "") +
        (issued
          ? "It issued the composite too: this browser did not compute it and claims no replay of it."
          : input.scores.composite?.state === "withheld" || shape.partial
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
         tracks were sat, and why no composite follows from a subset. */
      return {
        headline: "Your sitting is finished",
        lede: `${partialSittingLede(local.sat, notSat)} What you sat is scored below.`,
        cta: null,
        scored,
      };
    }
    /* A FINISHED FULL SITTING THE SERVICE DID NOT CONFIRM (TEN-128).
       The first fix answered this screen from the service's `scores`, so a
       read that never lands — offline, a 401/404, or a service too old to
       send the field — fell through to "N of 4 tracks scored. Finish the run
       to see it." with a Continue into /exam, which says the run is complete
       and links straight back here. That is the reported closed loop, and it
       reappears after a finalize that failed, because the sync retries only
       on the next commit.

       The log is a witness of its own: this browser recorded the run as
       ended. So the sitting is finished, there is nowhere to continue to,
       and the missing half is named as the service's silence rather than as
       the candidate's unfinished work. Which silence it is — no `scores` in
       the answer, or no answer at all — is the panel below's to say; this
       page has one read and does not guess at its reason. */
    /* WHAT THE SERVICE MANAGED TO SAY, AND NOT ONE WORD MORE.
       Three different facts, and each has to be said as itself:
        - it answered and named a score — never deny it, it is printed below;
        - it answered and named none — say that, and no more;
        - it was never asked — a read cannot fire without an identity, and
          the static export has no service at all, so "it returned nothing or
          could not be reached" would describe a request nobody made.
       `finalized !== true` alone is NOT a witness that no score exists: a
       body with `finalized: false` can still carry a scored track. */
    const serverScored = (input.scores?.tracks ?? []).some((t) => t.state === "scored");
    const serviceSaid =
      input.scores !== null
        ? serverScored
          ? "The exam service has not recorded this sitting as finished. What it has issued is " +
            "below."
          : "The exam service has not recorded this sitting as finished, and it has issued no " +
            "scores of record for it."
        : input.asked === false
          ? "No score of record was read here: this page never asked the exam service for one."
          : "The exam service issued nothing this page could read: it returned no scores, or " +
            "it could not be reached. What it did answer is below.";
    return {
      headline: "Your sitting is finished",
      lede:
        "This browser's log says the run ended, and you sat all four tracks. " +
        `${scored.length} of 4 tracks carry a score here. ${serviceSaid}`,
      cta: null,
      scored,
    };
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
