/**
 * Session state machine for a four-track AILX attempt — spec §04
 * "Session structure". Event-sourced: the append-only log is the source of
 * truth; state is a pure projection of the log. No clocks are read here —
 * every timestamp comes in on the event, so projection is deterministic.
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

export type SessionLogEntry =
  | { type: "attempt_started"; attemptId: string; config: SessionConfig; ts: number }
  | { type: "track_started"; trackId: TrackId; ts: number }
  | { type: "paused"; ts: number }
  | { type: "resumed"; ts: number }
  | { type: "track_event"; trackId: TrackId; event: TrackEventPayload; ts: number }
  | { type: "track_completed"; trackId: TrackId; artifact: unknown; timedOut: boolean; ts: number }
  | { type: "track_scored"; trackId: TrackId; score: TrackScoreValue; rubricVersion: string; scoringDigest: string; modelManifest: Record<string, string>; ts: number }
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
}

export interface SessionState {
  phase: SessionPhase;
  attemptId?: string;
  config?: SessionConfig;
  order: readonly TrackId[];
  currentTrack?: TrackId;
  tracks: Record<TrackId, TrackState>;
  lastSeq: number;
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
      if (s.phase !== "in_track" || s.currentTrack !== e.trackId)
        fail("track not active");
      return;
    case "track_completed":
      if ((s.phase !== "in_track" && s.phase !== "paused") || s.currentTrack !== e.trackId)
        fail("track not active");
      return;
    case "track_scored":
      if (s.tracks[e.trackId].status !== "completed") fail("track not completed");
      return;
    case "attempt_completed":
      if (s.phase !== "between_tracks") fail("tracks still pending or running");
      if (s.order.some((t) => s.tracks[t].status !== "completed"))
        fail("not all tracks completed");
      return;
  }
}

/** Pure projection: fold the log into a SessionState. */
export function project(log: readonly SequencedEntry[]): SessionState {
  const s = initialState();
  for (const e of log) {
    s.lastSeq = e.seq;
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
        t.activeMs += e.ts - (t.runningSince ?? e.ts);
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
        if (t.runningSince !== undefined) {
          t.activeMs += e.ts - t.runningSince;
          t.runningSince = undefined;
        }
        t.status = "completed";
        t.artifact = e.artifact;
        t.timedOut = e.timedOut;
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
  const t = state.tracks[trackId];
  const running =
    t.runningSince !== undefined ? Math.max(0, nowMs - t.runningSince) : 0;
  const usedMs = t.activeMs + running;
  return Math.max(0, Math.ceil((cfg.budgets[trackId] * 1000 - usedMs) / 1000));
}

/** Next track to sit, or undefined when all four are done. */
export function nextTrack(state: SessionState): TrackId | undefined {
  return state.order.find((t) => state.tracks[t].status !== "completed");
}
