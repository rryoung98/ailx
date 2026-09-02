/**
 * Session state machine for a four-track AILX attempt — spec §04
 * "Session structure". Event-sourced: the append-only log is the source of
 * truth; state is a pure projection of the log. No clocks are read here —
 * every timestamp comes in on the event, so projection is deterministic.
 *
 * A pause carries WHY it happened (`reason`): the candidate pressed Pause,
 * or the clock is held over a post-submit presentation screen (T2's replay,
 * T3's reveal, T4's gallery — screens where the score is already fixed).
 * The reason is in the LOG, so a reload restores the held clock without
 * guessing, and an auditor can see which intervals were never charged.
 *
 * Invariants enforced at append time (F13):
 *  - timestamps are nondecreasing across the whole log;
 *  - track_event is rejected once the track budget is exhausted (but is
 *    ACCEPTED while paused — mounted runners may emit under the pause veil);
 *  - track_completed.timedOut must AGREE with budget accounting
 *    (timedOut === activeMs-at-ts >= budget) — the flag is derived, never
 *    trusted from the caller;
 *  - negative durations (defensive, e.g. legacy stored logs) clamp to 0 in
 *    projection.
 */

import { canonicalJudgments, compareJudgments, judgmentId } from "@ailx/core";
import type { TrackId } from "./scoring.js";
import { JUDGE_RESOLVED_TRACKS, TRACK_IDS } from "./scoring.js";

/** xAPI-shaped track event (mirrors @ailx/core TrackEvent — structural). */
export interface TrackEventPayload {
  verb: string;
  object: string;
  result?: unknown;
  context?: Record<string, unknown>;
  clientTs: string;
}

export interface TrackScoreValue {
  raw: Record<string, number>;
  scaled: number; // 0–100 raw track points
}

/** Stored judgment row (mirrors @ailx/core Judgment — structural). */
export interface JudgmentRecord {
  dimension: string;
  sample: number;
  /** Normalized rubric value in [0, 1] (core contract). */
  value: number;
  evidence?: string;
  modelId: string;
}

/**
 * WHO issued the score, which decides what THIS log can prove about it.
 *
 *  - `local`  — computed here, by the track plugin's pure score(), from
 *    inputs that are all in this log. The log is sufficient to replay it, so
 *    the recomputability invariant is enforceable and IS enforced below.
 *  - `server` — issued by the exam service, which holds the answer key this
 *    browser deliberately does not have (docs/ARCHITECTURE.md §4). The
 *    service's own store is the replay surface. This log can only replay it
 *    if the service also handed back the judgment rows score() consumed; when
 *    it did not, the entry says so rather than implying an evidence base it
 *    does not carry.
 */
export type ScoredBy = "local" | "server";

/**
 * Why the track clock is stopped. Recorded ON the `paused` entry so the log
 * is self-describing: a reload knows, without guessing from the UI, that the
 * clock is held for a post-submit presentation screen rather than by the
 * candidate. Absent = the candidate pressed Pause (the historical shape;
 * stored logs without it stay valid).
 */
export type PauseReason = "candidate" | "presentation";

export type SessionLogEntry =
  | { type: "attempt_started"; attemptId: string; config: SessionConfig; ts: number }
  | { type: "track_started"; trackId: TrackId; ts: number }
  | { type: "paused"; ts: number; reason?: PauseReason }
  | { type: "resumed"; ts: number }
  | { type: "track_event"; trackId: TrackId; event: TrackEventPayload; ts: number }
  | { type: "track_completed"; trackId: TrackId; artifact: unknown; timedOut: boolean; ts: number }
  | {
      type: "track_scored"; trackId: TrackId; score: TrackScoreValue;
      rubricVersion: string; scoringDigest: string; modelManifest: Record<string, string>;
      /**
       * Judgment rows score() consumed — persisted for reproducibility (F12).
       * REQUIRED, and required to be in @ailx/core's canonical row order: a
       * score whose value depends on which order the store handed the rows
       * back is not byte-identically recomputable, and `[]` on a
       * judge-resolved track used to be the silent way to say "no evidence".
       * Empty is legal only for a model-free track, or for a `server` score
       * whose evidence lives in the service's store.
       */
      judgments: ReadonlyArray<JudgmentRecord>;
      /**
       * The CLAIMED content address of each row in `judgments`, same order:
       * `judgmentId(judgments[i])`. This is the auditor's handle. Recompute
       * the ids over the stored rows; a mismatch means the rows were mutated
       * after the score was issued and the score of record is VOID — a much
       * louder failure than a judge that drifted. Without it the log records
       * evidence but no claim about that evidence, and nothing can be void.
       */
      judgmentIds: ReadonlyArray<string>;
      /** Who issued the score, i.e. whether THIS log can replay it. */
      scoredBy: ScoredBy;
      ts: number;
    }
  | { type: "attempt_completed"; ts: number };

export type SequencedEntry = SessionLogEntry & { seq: number };

export interface SessionConfig {
  instrument: string;           // 'ailx'
  version: string;              // '2026.1'
  locale: "en" | "ja" | "ko";
  /** Per-track time budgets in seconds. Order of sitting is fixed T1→T4. */
  budgets: Record<TrackId, number>;
  /** Marked true for the static showcase’s compressed demo budgets. */
  demo?: boolean;
}

/** Spec §04 sitting budgets. T1’s real window is 48 h and asynchronous. */
export const SPEC_BUDGETS_SECONDS: Readonly<Record<TrackId, number>> = {
  t1: 48 * 3600,
  t2: 50 * 60,
  t3: 90 * 60,
  t4: 60 * 60,
};

export type SessionPhase =
  | "idle"
  | "between_tracks"
  | "in_track"
  | "paused"
  | "completed";

export interface TrackState {
  trackId: TrackId;
  status: "pending" | "active" | "completed";
  /** Milliseconds of active (unpaused) time consumed. */
  activeMs: number;
  /** ts of last (re)start while running; undefined when not running. */
  runningSince?: number;
  events: TrackEventPayload[];
  artifact?: unknown;
  timedOut?: boolean;
  score?: TrackScoreValue;
  rubricVersion?: string;
  scoringDigest?: string;
  modelManifest?: Record<string, string>;
  /** Judgment rows persisted with the score (F12), in canonical row order. */
  judgments?: ReadonlyArray<JudgmentRecord>;
  /** Content address claimed for each stored judgment row, same order. */
  judgmentIds?: ReadonlyArray<string>;
  /** Who issued the score. See {@link ScoredBy}. */
  scoredBy?: ScoredBy;
}

export interface SessionState {
  phase: SessionPhase;
  attemptId?: string;
  config?: SessionConfig;
  order: readonly TrackId[];
  currentTrack?: TrackId;
  tracks: Record<TrackId, TrackState>;
  lastSeq: number;
  /** Why the clock is stopped; only set while `phase === "paused"`. */
  pauseReason?: PauseReason;
  /** Timestamp of the last applied entry — appends must not go backwards. */
  lastTs?: number;
}

export const TRACK_ORDER: readonly TrackId[] = TRACK_IDS;

export function initialState(): SessionState {
  const tracks = {} as Record<TrackId, TrackState>;
  for (const t of TRACK_ORDER) {
    tracks[t] = { trackId: t, status: "pending", activeMs: 0, events: [] };
  }
  return { phase: "idle", order: TRACK_ORDER, tracks, lastSeq: -1 };
}

export class TransitionError extends Error {}

/** Active (unpaused) milliseconds a track has consumed as of `nowMs`. */
function usedMsAt(s: SessionState, trackId: TrackId, nowMs: number): number {
  const t = s.tracks[trackId];
  const running =
    t.runningSince !== undefined ? Math.max(0, nowMs - t.runningSince) : 0;
  return t.activeMs + running;
}

/** True when the track's configured budget is exhausted as of `nowMs`. */
function budgetExhaustedAt(s: SessionState, trackId: TrackId, nowMs: number): boolean {
  const cfg = s.config;
  if (!cfg) return false;
  return usedMsAt(s, trackId, nowMs) >= cfg.budgets[trackId] * 1000;
}

/**
 * Validate-and-append. Returns a NEW log; never mutates. Throws
 * TransitionError on an illegal transition, keeping the log consistent.
 */
export function append(
  log: readonly SequencedEntry[],
  entry: SessionLogEntry,
): SequencedEntry[] {
  const state = project(log);
  assertLegal(state, entry);
  return [...log, { ...entry, seq: state.lastSeq + 1 }];
}

/**
 * THE RECOMPUTABILITY INVARIANT, ENFORCED AT APPEND TIME.
 *
 * "Any score ever issued is byte-identically recomputable from stored inputs"
 * was, until this function existed, a sentence in AGENTS.md with no code
 * behind it: `judgmentId()` had no production caller, the log recorded
 * judgment rows but no CLAIM about them, and a judge-resolved track could be
 * scored with `judgments: []` and nobody would notice.
 *
 * Four checks, each of which a real defect walked through:
 *
 *  1. EVIDENCE IS PRESENT. A locally-issued score on a judge-resolved track
 *     must carry the rows score() consumed. A model-free track must carry
 *     none, so `judgments: []` keeps exactly one meaning.
 *  2. THE CLAIM MATCHES THE EVIDENCE. Every row's recorded `judgmentId` must
 *     content-address that row. This is what makes a mutated row VOID the
 *     score instead of silently changing it.
 *  3. THE ROWS ARE IN CANONICAL ORDER. Stored judgments come back from a
 *     store, and a read without ORDER BY has no guaranteed order.
 *     Aggregation is order-invariant by construction now (@ailx/core
 *     judgments.ts), but the LOG must still be a canonical artifact, or two
 *     byte-different logs describe the same score and `canonicalJson` over
 *     the log stops being a stable audit surface.
 *  4. NO DUPLICATE ROWS. Two identical stored judgments have the same
 *     content address; one row counted twice moves a mean, and content
 *     addressing cannot tell the pair apart.
 *
 * `server` scores are exempt from (1) ONLY: the exam service holds the answer
 * key this browser must not have, so its store is the replay surface and this
 * log is honest about carrying no evidence. (2), (3) and (4) still apply to
 * whatever it DID hand back.
 */
function assertJudgmentsAttested(
  e: Extract<SessionLogEntry, { type: "track_scored" }>,
  fail: (msg: string) => never,
): void {
  const rows = e.judgments;
  const ids = e.judgmentIds;
  if (!Array.isArray(rows)) fail("judgments must be an array (a score with no recorded evidence is not recomputable)");
  if (!Array.isArray(ids)) fail("judgmentIds must be an array — the log must record the CLAIMED content address of every judgment row");
  if (ids.length !== rows.length) {
    fail(`judgmentIds has ${ids.length} entries for ${rows.length} judgment rows`);
  }
  for (let i = 0; i < rows.length; i++) {
    const actual = judgmentId(rows[i]);
    if (ids[i] !== actual) {
      fail(
        `judgmentIds[${i}] claims ${String(ids[i])} but the stored row content-addresses to ${actual} — ` +
        "the stored judgment was mutated after the score was issued; this score of record is void",
      );
    }
  }
  for (let i = 1; i < rows.length; i++) {
    const cmp = compareJudgments(rows[i - 1], rows[i]);
    if (cmp > 0) {
      fail(
        `judgments[${i}] precedes judgments[${i - 1}] in canonical row order — ` +
        "store them in @ailx/core canonical order so the log does not depend on how the rows were read",
      );
    }
    if (cmp === 0) {
      fail(
        `judgments[${i}] duplicates judgments[${i - 1}] — two rows with one content address ` +
        "double-count in every aggregate and cannot be told apart on audit",
      );
    }
  }
  const judgeResolved = JUDGE_RESOLVED_TRACKS.includes(e.trackId);
  if (e.scoredBy === "local") {
    // A judge-resolved track may store no rows in exactly one case: it issued
    // no points, because score() never ran on a usable artifact (the
    // fail-closed sentinel). Anything ABOVE zero had to come from stored
    // judge output, so the rows that produced it must be in the log.
    if (judgeResolved && rows.length === 0 && e.score.scaled !== 0) {
      fail(
        `${e.trackId} resolves points from stored judge output, so a locally issued score of ` +
        `${e.score.scaled} must carry the judgment rows score() consumed — an empty list is ` +
        "points with no evidence",
      );
    }
    if (!judgeResolved && rows.length > 0) {
      fail(
        `${e.trackId} is model-free — its score() reads no judgments, so storing ${rows.length} ` +
        "against it would record evidence nothing consumed",
      );
    }
  }
}

/**
 * Put stored judgment rows into the shape `track_scored` requires: canonical
 * row order, plus the content address claimed for each.
 *
 * Every producer of a `track_scored` entry calls this — there is no second
 * place that decides what a judgment id is, and no producer that can forget
 * to record one. Sorting here is what makes the log independent of the order
 * the rows were read in; `assertJudgmentsAttested` then re-checks both
 * properties at append time, because a producer is not a proof.
 */
export function attestJudgments(
  judgments: ReadonlyArray<JudgmentRecord>,
): { judgments: JudgmentRecord[]; judgmentIds: string[] } {
  const ordered = canonicalJudgments(judgments);
  return { judgments: ordered, judgmentIds: ordered.map((j) => judgmentId(j)) };
}

function assertLegal(s: SessionState, e: SessionLogEntry): void {
  const fail = (msg: string): never => {
    throw new TransitionError(`${e.type} rejected: ${msg} (phase=${s.phase})`);
  };
  if (typeof e.ts !== "number" || !Number.isFinite(e.ts)) {
    fail("ts must be a finite number");
  }
  // Nondecreasing timestamps across the whole log (F13).
  if (s.lastTs !== undefined && e.ts < s.lastTs) {
    fail(`ts ${e.ts} is earlier than the last event ts ${s.lastTs}`);
  }
  switch (e.type) {
    case "attempt_started":
      if (s.phase !== "idle") fail("attempt already started");
      return;
    case "track_started": {
      if (s.phase !== "between_tracks") fail("not between tracks");
      const next = s.order.find((t) => s.tracks[t].status !== "completed");
      if (next !== e.trackId) fail(`expected next track ${next ?? "none"}`);
      return;
    }
    case "paused":
      if (s.phase !== "in_track") fail("nothing running to pause");
      // A stored/hand-edited log may not invent a pause reason: the reason
      // decides whether the interval is charged-looking or clock-held.
      if (e.reason !== undefined && e.reason !== "candidate" && e.reason !== "presentation")
        fail(`unknown pause reason ${String(e.reason)}`);
      return;
    case "resumed":
      if (s.phase !== "paused") fail("not paused");
      return;
    case "track_event":
      // Accepted while in_track AND while paused: runners stay mounted under
      // the pause veil, so runner-internal timers (e.g. a T2 exposure lapse)
      // can legitimately emit during a pause. Dropping them would make the
      // event log disagree with the artifact (audit: silent data loss).
      if ((s.phase !== "in_track" && s.phase !== "paused") || s.currentTrack !== e.trackId)
        fail("track not active");
      if (budgetExhaustedAt(s, e.trackId, e.ts))
        fail("budget exhausted — no further track events accepted");
      return;
    case "track_completed": {
      if ((s.phase !== "in_track" && s.phase !== "paused") || s.currentTrack !== e.trackId)
        fail("track not active");
      // timedOut is DERIVED from accounting; the caller's flag must agree.
      const derived = budgetExhaustedAt(s, e.trackId, e.ts);
      if (e.timedOut !== derived) {
        fail(
          `timedOut=${e.timedOut} disagrees with budget accounting ` +
          `(derived=${derived})`,
        );
      }
      return;
    }
    case "track_scored": {
      if (s.tracks[e.trackId].status !== "completed") fail("track not completed");
      if (s.tracks[e.trackId].score !== undefined) {
        fail("track already scored — a re-score must be an explicit new attempt, never a silent replacement");
      }
      if (e.scoredBy !== "local" && e.scoredBy !== "server") {
        fail(`unknown scoredBy ${String((e as { scoredBy?: unknown }).scoredBy)}`);
      }
      assertJudgmentsAttested(e, fail);
      return;
    }
    case "attempt_completed":
      if (s.phase !== "between_tracks") fail("tracks still pending or running");
      if (s.order.some((t) => s.tracks[t].status !== "completed"))
        fail("not all tracks completed");
      return;
    default:
      fail(`unknown entry type ${String((e as { type?: unknown }).type)}`);
  }
}

/** Pure projection: fold the log into a SessionState. */
export function project(log: readonly SequencedEntry[]): SessionState {
  const s = initialState();
  for (const e of log) {
    s.lastSeq = e.seq;
    s.lastTs = s.lastTs === undefined ? e.ts : Math.max(s.lastTs, e.ts);
    switch (e.type) {
      case "attempt_started":
        s.phase = "between_tracks";
        s.attemptId = e.attemptId;
        s.config = e.config;
        break;
      case "track_started": {
        s.phase = "in_track";
        s.currentTrack = e.trackId;
        const t = s.tracks[e.trackId];
        t.status = "active";
        t.runningSince = e.ts;
        s.pauseReason = undefined;
        break;
      }
      case "paused": {
        const t = s.tracks[s.currentTrack!];
        // Negative durations clamp to 0 (defensive for legacy stored logs).
        t.activeMs += Math.max(0, e.ts - (t.runningSince ?? e.ts));
        t.runningSince = undefined;
        s.phase = "paused";
        s.pauseReason = e.reason ?? "candidate";
        break;
      }
      case "resumed": {
        const t = s.tracks[s.currentTrack!];
        t.runningSince = e.ts;
        s.phase = "in_track";
        s.pauseReason = undefined;
        break;
      }
      case "track_event":
        s.tracks[e.trackId].events.push(e.event);
        break;
      case "track_completed": {
        const t = s.tracks[e.trackId];
        // Derive timedOut from accounting BEFORE folding the final slice,
        // matching what append() validated (never trust the stored flag).
        const derived = budgetExhaustedAt(s, e.trackId, e.ts);
        if (t.runningSince !== undefined) {
          t.activeMs += Math.max(0, e.ts - t.runningSince);
          t.runningSince = undefined;
        }
        t.status = "completed";
        t.artifact = e.artifact;
        t.timedOut = s.config ? derived : e.timedOut;
        s.currentTrack = undefined;
        s.phase = "between_tracks";
        s.pauseReason = undefined;
        break;
      }
      case "track_scored": {
        const t = s.tracks[e.trackId];
        t.score = e.score;
        t.rubricVersion = e.rubricVersion;
        t.scoringDigest = e.scoringDigest;
        t.modelManifest = e.modelManifest;
        t.judgments = e.judgments;
        t.judgmentIds = e.judgmentIds;
        t.scoredBy = e.scoredBy;
        break;
      }
      case "attempt_completed":
        s.phase = "completed";
        break;
    }
  }
  return s;
}

/**
 * Seconds remaining in a track’s budget at wall-time `nowMs`.
 * Pure: `nowMs` is an argument, never read from a clock.
 */
export function secondsRemaining(
  state: SessionState,
  trackId: TrackId,
  nowMs: number,
): number {
  const cfg = state.config;
  if (!cfg) return 0;
  const usedMs = usedMsAt(state, trackId, nowMs);
  return Math.max(0, Math.ceil((cfg.budgets[trackId] * 1000 - usedMs) / 1000));
}

/** Next track to sit, or undefined when all four are done. */
export function nextTrack(state: SessionState): TrackId | undefined {
  return state.order.find((t) => state.tracks[t].status !== "completed");
}
