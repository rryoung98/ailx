/**
 * Session state machine for a four-track AILX attempt — spec §04
 * "Session structure". Event-sourced: the append-only log is the source of
 * truth; state is a pure projection of the log. No clocks are read here —
 * every timestamp comes in on the event, so projection is deterministic.
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

import type { TrackId } from "./scoring.js";
import { TRACK_IDS } from "./scoring.js";

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

export type SessionLogEntry =
  | { type: "attempt_started"; attemptId: string; config: SessionConfig; ts: number }
  | { type: "track_started"; trackId: TrackId; ts: number }
  | { type: "paused"; ts: number }
  | { type: "resumed"; ts: number }
  | { type: "track_event"; trackId: TrackId; event: TrackEventPayload; ts: number }
  | { type: "track_completed"; trackId: TrackId; artifact: unknown; timedOut: boolean; ts: number }
  | {
      type: "track_scored"; trackId: TrackId; score: TrackScoreValue;
      rubricVersion: string; scoringDigest: string; modelManifest: Record<string, string>;
      /** Judgment rows score() consumed — persisted for reproducibility (F12). */
      judgments?: ReadonlyArray<JudgmentRecord>;
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
  /** Judgment rows persisted with the score (F12). */
  judgments?: ReadonlyArray<JudgmentRecord>;
}

export interface SessionState {
  phase: SessionPhase;
  attemptId?: string;
  config?: SessionConfig;
  order: readonly TrackId[];
  currentTrack?: TrackId;
  tracks: Record<TrackId, TrackState>;
  lastSeq: number;
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
    case "track_scored":
      if (s.tracks[e.trackId].status !== "completed") fail("track not completed");
      if (s.tracks[e.trackId].score !== undefined) {
        fail("track already scored — a re-score must be an explicit new attempt, never a silent replacement");
      }
      return;
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
        break;
      }
      case "paused": {
        const t = s.tracks[s.currentTrack!];
        // Negative durations clamp to 0 (defensive for legacy stored logs).
        t.activeMs += Math.max(0, e.ts - (t.runningSince ?? e.ts));
        t.runningSince = undefined;
        s.phase = "paused";
        break;
      }
      case "resumed": {
        const t = s.tracks[s.currentTrack!];
        t.runningSince = e.ts;
        s.phase = "in_track";
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
        break;
      }
      case "track_scored": {
        const t = s.tracks[e.trackId];
        t.score = e.score;
        t.rubricVersion = e.rubricVersion;
        t.scoringDigest = e.scoringDigest;
        t.modelManifest = e.modelManifest;
        t.judgments = e.judgments;
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
