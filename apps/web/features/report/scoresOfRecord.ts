/**
 * THE SCORES OF RECORD FOR A HOSTED SITTING, AS THE BROWSER MAY READ THEM.
 *
 * `GET /v1/attempts/:id` carries a `scores` object beside `attempt` and
 * `decks` (TEN-69, backend PR #8). It exists because finalize is not the last
 * writer: T3's 45 analysis points are resolved by a jury, so a hosted T3
 * score of record is issued LATER by the judging pass, and nothing gave it
 * back. Before TEN-66 the report showed a T3 number whose judged points were
 * a silent zero; TEN-66 replaced a wrong number with no number, and this is
 * how the browser reads the number the service actually issued.
 *
 * FOUR STATES, AND THEY ARE NOT A NULLABLE NUMBER. A track awaiting its jury
 * is not unscored, and neither of them is zero. The copy below keeps them
 * apart, because copy that cannot tell them apart cannot be honest.
 *
 * Everything here is PURE, and every field off the wire is checked rather
 * than cast: this body decides what a candidate is told about their own
 * result, so a malformed record must read as "we cannot say" and never as a
 * number.
 */
import { parseAttemptComposite, type AttemptComposite } from "@ailx/contract";
import { TRACK_IDS, type TrackId } from "@ailx/session";

/** Why a sat track carries no score of record. Never a zero. */
export type UnscoredReason = "showcase" | "no_deck" | "instrument_mismatch" | "no_score";

/** Why the service says the track was not sat. */
export type NotSatReason = "incomplete" | "unevidenced";

export interface ScoredTrack {
  trackId: TrackId;
  state: "scored";
  score: { raw: Record<string, number>; scaled: number };
  rubricVersion: string;
  scoringDigest: string;
  /** Which pass wrote the row — "finalize", or the judging worker's own name. */
  issuedBy: string | null;
  computedAt: string;
}

export interface PendingTrack {
  trackId: TrackId;
  state: "pending_judging";
  detail: string;
}

export interface NotSatTrack {
  trackId: TrackId;
  state: "not_sat";
  reason: NotSatReason;
  detail: string;
}

export interface UnscoredTrack {
  trackId: TrackId;
  state: "unscored";
  reason: UnscoredReason;
  detail: string;
}

export type TrackScoreRecord = ScoredTrack | PendingTrack | NotSatTrack | UnscoredTrack;

export interface AttemptScores {
  /** False while the sitting is open; `tracks` is then empty and claims nothing. */
  finalized: boolean;
  /** True while at least one track is awaiting its jury. */
  pending: boolean;
  /** Milliseconds to wait before reading again, or null when nothing is owed. */
  pollAfterMs: number | null;
  tracks: TrackScoreRecord[];
  /**
   * The composite of record, issued or withheld with its reason (TEN-92).
   *
   * Null when the service sent nothing this build can read, which is its own
   * fact and never a zero. The wire shape and its parser live in
   * `@ailx/contract` because the private repo spells the same union.
   */
  composite: AttemptComposite | null;
}

/**
 * The poll interval used when the service asks for one this build will not
 * honour — a missing, zero or absurd `pollAfterMs`. The cadence is the
 * service's to choose (it says 5000 today, and may change it without a
 * frontend release); the floor and ceiling here only stop a bad number from
 * turning this page into a request loop or a page that never refreshes.
 */
export const DEFAULT_POLL_MS = 5_000;
export const MIN_POLL_MS = 1_000;
export const MAX_POLL_MS = 60_000;

/**
 * HOW LONG THIS PAGE WAITS BEFORE IT STOPS SAYING "COMING".
 *
 * The judging worker records no terminal state for a track it FAILED on: a
 * missing artefact or unparseable judge output leaves no row and no marker,
 * so "the pass has not run yet" and "the pass ran and refused" both read as
 * `pending_judging` (backend PR #8 states this limitation rather than hiding
 * it). A page with no bound of its own would therefore spin for ever on a
 * score that is never coming.
 *
 * Three minutes: the pass is a batch worker taking tens of seconds per
 * attempt, so three minutes is many times a normal run and still short enough
 * that a candidate is not left watching. Past it the page says the number is
 * LATE rather than coming, and offers to look again — it never invents a
 * failure it cannot see, and it never claims the score is lost.
 */
export const POLL_BOUND_MS = 180_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const numbers = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isRecord(v)) {
    for (const [k, n] of Object.entries(v)) if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  }
  return out;
};

const NOT_SAT_REASONS: readonly NotSatReason[] = ["incomplete", "unevidenced"];
const UNSCORED_REASONS: readonly UnscoredReason[] = [
  "showcase",
  "no_deck",
  "instrument_mismatch",
  "no_score",
];

/**
 * One wire record → one track record, or null when it is not one.
 *
 * A record whose state is a word this build does not know is DROPPED rather
 * than guessed at: showing an unknown state as "unscored" would be the exact
 * blurring this read exists to stop, and a track missing from the list
 * renders as "the service said nothing about this track".
 */
function parseTrack(raw: unknown): TrackScoreRecord | null {
  if (!isRecord(raw)) return null;
  const trackId = TRACK_IDS.find((t) => t === raw.trackId);
  if (trackId === undefined) return null;
  if (raw.state === "scored") {
    const score = raw.score;
    if (!isRecord(score) || typeof score.scaled !== "number" || !Number.isFinite(score.scaled)) return null;
    return {
      trackId,
      state: "scored",
      score: { raw: numbers(score.raw), scaled: score.scaled },
      rubricVersion: str(raw.rubricVersion),
      scoringDigest: str(raw.scoringDigest),
      issuedBy: typeof raw.issuedBy === "string" ? raw.issuedBy : null,
      computedAt: str(raw.computedAt),
    };
  }
  if (raw.state === "pending_judging") {
    return { trackId, state: "pending_judging", detail: str(raw.detail) };
  }
  if (raw.state === "not_sat") {
    const reason = NOT_SAT_REASONS.find((r) => r === raw.reason);
    return reason === undefined ? null : { trackId, state: "not_sat", reason, detail: str(raw.detail) };
  }
  if (raw.state === "unscored") {
    const reason = UNSCORED_REASONS.find((r) => r === raw.reason);
    return reason === undefined ? null : { trackId, state: "unscored", reason, detail: str(raw.detail) };
  }
  return null;
}

/**
 * The `scores` object off `GET /attempts/:id`, or null when there is none.
 *
 * Null is a real answer and not an error: the service omits `scores`
 * altogether when it mounts no instrument, because then it has nothing to
 * compare a stored row's custody against. The panel says so rather than
 * rendering an empty list.
 */
export function parseAttemptScores(body: unknown): AttemptScores | null {
  if (!isRecord(body) || !isRecord(body.scores)) return null;
  const s = body.scores;
  const tracks = Array.isArray(s.tracks)
    ? s.tracks.map(parseTrack).filter((t): t is TrackScoreRecord => t !== null)
    : [];
  return {
    finalized: s.finalized === true,
    // Read from the tracks, not from the flag: `pending` decides whether this
    // page keeps asking, and a flag that disagrees with the list it summarizes
    // would poll for ever (true) or stop on a track still owed (false).
    pending: tracks.some((t) => t.state === "pending_judging"),
    pollAfterMs:
      typeof s.pollAfterMs === "number" && Number.isFinite(s.pollAfterMs) ? s.pollAfterMs : null,
    tracks,
    composite: parseAttemptComposite(s.composite),
  };
}

/** The wait the service asked for, clamped into what this page will do. */
export function pollDelayMs(scores: AttemptScores): number {
  const asked = scores.pollAfterMs ?? DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, asked));
}

/**
 * What the candidate is told about one track, in one sentence per fact.
 *
 * The service's own `detail` is rendered next to this, not instead of it: the
 * detail names the deployment fact (which rubric, which record is missing),
 * and this names what it MEANS for the number on the page.
 */
export function stateCopy(record: TrackScoreRecord): string {
  switch (record.state) {
    case "scored":
      return "Score of record, issued by the exam service.";
    case "pending_judging":
      return "Being judged. This track is marked by a jury after the sitting, so its score arrives later. This page checks for it.";
    case "not_sat":
      return record.reason === "incomplete"
        ? "Not sat. The exam service holds no work for this track."
        : "Not sat. This browser claims the track and the exam service recorded nothing for it, so no score can be issued.";
    case "unscored":
      switch (record.reason) {
        case "showcase":
          return "No score. This track is a showcase and issues no points.";
        case "no_deck":
          return "No score. This sitting was dealt no material for this track.";
        case "instrument_mismatch":
          return "The score cannot be shown. It was issued under a different version of the instrument than the service now runs, so it is not a number about this instrument. The stored score and its inputs are intact.";
        case "no_score":
          return "No score. The exam service issued none for this track.";
      }
  }
}

/** Said once, above the list, when the sitting is still open. */
export const OPEN_SITTING_COPY =
  "This sitting is still open. The exam service issues no score of record until you finish it.";

/** Said when the service returned no `scores` object at all. */
export const NO_SCORES_COPY =
  "The exam service returned no scores for this attempt, so this panel shows none.";

/** Said when the page stops waiting. It states the bound and claims no failure. */
export const BOUND_COPY =
  "Judging is taking longer than expected — this page has waited three minutes. The exam service issues the score when the judging pass finishes, and this page cannot see whether that pass is running or has failed. Check again, or come back later.";

/** Said when a read did not land. The last answer stays on screen. */
export const READ_ERROR_COPY =
  "The exam service could not be reached on the last check, so what you see is the previous answer.";
