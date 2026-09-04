"use client";

/**
 * THE HOSTED SCORES OF RECORD, ON THE REPORT.
 *
 * The exam service issues the score for a judged track AFTER finalize has
 * answered (T3's jury is written by the judging pass), so the number this
 * panel shows may not exist when the page first loads. Three things follow,
 * and all three are visible:
 *
 *  1. FOUR STATES, NOT A NUMBER OR A BLANK. Scored, being judged, not sat,
 *     and no-score-with-a-reason are four different facts (`scoresOfRecord.ts`).
 *  2. IT POLLS, WITH A BOUND. `pollAfterMs` off the body decides the cadence;
 *     `POLL_BOUND_MS` decides when this page stops saying the number is
 *     coming, because the judging worker records no terminal state when it
 *     fails and a page with no bound of its own would spin for ever.
 *  3. AN ARRIVING SCORE IS ANNOUNCED. A number that quietly appears is worse
 *     than one the page said was coming: a track that was pending in THIS
 *     page's lifetime and is now scored is marked, and announced politely to
 *     a screen reader.
 *
 * Nothing here writes. The panel reports what the service holds; the local
 * event log, the composite and the replay line are unchanged by it.
 */
import { formatTrackScore, TRACK_META } from "@ailx/report";
import { TRACK_IDS } from "@ailx/session";
import { isServerMode } from "../../lib/mode";
import {
  BOUND_COPY,
  NO_SCORES_COPY,
  OPEN_SITTING_COPY,
  READ_ERROR_COPY,
  pollDelayMs,
  stateCopy,
  type TrackScoreRecord,
} from "./scoresOfRecord";
import type { ScoresView } from "./useScoresOfRecord";

function TrackLine({ record, justArrived }: { record: TrackScoreRecord; justArrived: boolean }) {
  const meta = TRACK_META[record.trackId];
  return (
    <div
      className="card"
      style={{ marginBottom: "0.6rem" }}
      data-testid={`score-of-record-${record.trackId}`}
      data-state={record.state}
      data-reason={record.state === "not_sat" || record.state === "unscored" ? record.reason : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.8rem" }}>
        <h3 style={{ margin: 0 }}>
          <span className="mono" style={{ color: "var(--accent)" }}>{meta.code}</span> · {meta.name}
        </h3>
        <span className="mono">
          {record.state === "scored"
            ? /* One formatter for every user-visible track score, so a
                 server-issued number carries the same denominator rule as a
                 local one. No judgments are passed: a score of record is not
                 a demo estimate, and claiming either way from an absent list
                 would be a guess. */
              formatTrackScore(record.score, [], record.trackId)
            : record.state === "pending_judging"
              ? "being judged"
              : "no score"}
        </span>
      </div>
      <p className="small" style={{ margin: "0.3rem 0 0" }}>{stateCopy(record)}</p>
      {record.state === "scored" ? (
        <p className="faint small mono" style={{ margin: "0.2rem 0 0" }}>
          issued by {record.issuedBy ?? "the exam service"}
          {record.computedAt === "" ? "" : ` · ${record.computedAt}`}
          {record.rubricVersion === "" ? "" : ` · rubric ${record.rubricVersion.slice(0, 12)}…`}
          {record.scoringDigest === "" ? "" : ` · scoring ${record.scoringDigest.slice(0, 12)}…`}
        </p>
      ) : record.detail === "" ? null : (
        <p className="faint small" style={{ margin: "0.2rem 0 0" }}>{record.detail}</p>
      )}
      {justArrived ? (
        <p className="small" style={{ margin: "0.4rem 0 0", color: "var(--accent)" }} data-testid={`score-arrived-${record.trackId}`}>
          This score arrived while you were on this page.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The panel proper: it renders a read it is GIVEN. The read itself is
 * `useScoresOfRecord`, because the report's unlock gate must decide from the
 * same answer this panel draws (TEN-128).
 */
export function ScoresOfRecordView({ view }: { view: ScoresView }) {
  const { scores, failure, bounded, arrived, checkAgain } = view;
  // The static export has no exam service, so it has no scores of record and
  // this panel is not part of that page at all.
  if (!isServerMode()) return null;

  const arrivedCopy = arrived
    .map((t) => {
      const rec = scores?.tracks.find((s) => s.trackId === t);
      return rec?.state === "scored"
        ? `${TRACK_META[t].code} has been scored: ${formatTrackScore(rec.score, [], t)}.`
        : "";
    })
    .filter((s) => s !== "")
    .join(" ");

  return (
    <section data-testid="scores-of-record" style={{ marginTop: "2rem" }}>
      <h2 style={{ marginBottom: "0.2rem" }}>Scores of record</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        The numbers the exam service issued for this sitting. A judged track is marked after the
        sitting, so its score arrives here later than the rest.
      </p>
      <p className="sr-only" role="status">{arrivedCopy}</p>
      {scores === undefined && failure === null ? (
        <p className="muted" data-testid="scores-loading">Reading the scores of record…</p>
      ) : null}
      {scores === null ? <p className="muted" data-testid="scores-absent">{NO_SCORES_COPY}</p> : null}
      {scores != null && !scores.finalized ? (
        <p className="muted" data-testid="scores-open">{OPEN_SITTING_COPY}</p>
      ) : null}
      {scores != null && scores.finalized
        ? TRACK_IDS.map((t) => {
            const record = scores.tracks.find((s) => s.trackId === t);
            return record === undefined ? (
              <p className="muted small" key={t} data-testid={`score-of-record-missing-${t}`}>
                {TRACK_META[t].code}: the exam service said nothing about this track.
              </p>
            ) : (
              <TrackLine key={t} record={record} justArrived={arrived.includes(t)} />
            );
          })
        : null}
      {scores?.pending === true && !bounded ? (
        <p className="faint small" data-testid="scores-polling">
          Checking again in {Math.round(pollDelayMs(scores) / 1000)} seconds.
        </p>
      ) : null}
      {bounded ? (
        <div data-testid="scores-bound">
          <p className="small">{BOUND_COPY}</p>
          <button type="button" className="btn small-btn" onClick={checkAgain}>Check again</button>
        </div>
      ) : null}
      {failure?.kind === "missing" ? (
        <p className="small" data-testid="scores-missing">
          The exam service did not return this attempt (status {failure.status}), so no score of
          record is shown.
        </p>
      ) : null}
      {failure?.kind === "error" ? (
        <p className="small" data-testid="scores-error">{READ_ERROR_COPY}</p>
      ) : null}
    </section>
  );
}
