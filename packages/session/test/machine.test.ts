import { describe, expect, it } from "vitest";
import {
  append,
  initialState,
  nextTrack,
  project,
  secondsRemaining,
  TransitionError,
  type SequencedEntry,
  type SessionConfig,
} from "../src/index.js";

const CFG: SessionConfig = {
  instrument: "ailx",
  version: "2026.1",
  locale: "en",
  budgets: { t1: 600, t2: 3000, t3: 5400, t4: 3600 },
  demo: true,
};

const T0 = 1_760_000_000_000;

function start(): SequencedEntry[] {
  return append([], { type: "attempt_started", attemptId: "att-1", config: CFG, ts: T0 });
}

describe("session machine", () => {
  it("starts idle and enforces T1\u2192T4 order", () => {
    expect(initialState().phase).toBe("idle");
    let log = start();
    expect(project(log).phase).toBe("between_tracks");
    expect(nextTrack(project(log))).toBe("t1");
    expect(() =>
      append(log, { type: "track_started", trackId: "t2", ts: T0 }),
    ).toThrow(TransitionError);
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    expect(project(log).currentTrack).toBe("t1");
  });

  it("runs the full four-track happy path", () => {
    let log = start();
    for (const t of ["t1", "t2", "t3", "t4"] as const) {
      log = append(log, { type: "track_started", trackId: t, ts: T0 });
      log = append(log, {
        type: "track_event",
        trackId: t,
        event: { verb: "submitted", object: `${t}:artifact`, clientTs: new Date(T0).toISOString() },
        ts: T0 + 1000,
      });
      log = append(log, { type: "track_completed", trackId: t, artifact: { t }, timedOut: false, ts: T0 + 2000 });
      log = append(log, {
        type: "track_scored", trackId: t,
        score: { raw: { total: 61 }, scaled: 61 },
        rubricVersion: "r", scoringDigest: "s", modelManifest: { demo: "demo-judge@1" },
        ts: T0 + 3000,
      });
    }
    log = append(log, { type: "attempt_completed", ts: T0 + 9000 });
    const s = project(log);
    expect(s.phase).toBe("completed");
    expect(Object.values(s.tracks).every((t) => t.status === "completed")).toBe(true);
    expect(s.tracks.t3.score?.scaled).toBe(61);
    expect(s.tracks.t2.events).toHaveLength(1);
  });

  it("accounts active time across pause/resume", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    log = append(log, { type: "paused", ts: T0 + 10_000 });        // 10s active
    log = append(log, { type: "resumed", ts: T0 + 100_000 });      // 90s paused
    log = append(log, { type: "track_completed", trackId: "t1", artifact: null, timedOut: false, ts: T0 + 130_000 }); // +30s
    const s = project(log);
    expect(s.tracks.t1.activeMs).toBe(40_000);
  });

  it("computes secondsRemaining purely from event timestamps + now", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    let s = project(log);
    expect(secondsRemaining(s, "t1", T0)).toBe(600);
    expect(secondsRemaining(s, "t1", T0 + 60_000)).toBe(540);
    log = append(log, { type: "paused", ts: T0 + 60_000 });
    s = project(log);
    // paused: clock does not advance
    expect(secondsRemaining(s, "t1", T0 + 999_000)).toBe(540);
    // budget exhausted clamps at 0
    log = append(log, { type: "resumed", ts: T0 + 999_000 });
    s = project(log);
    expect(secondsRemaining(s, "t1", T0 + 999_000 + 600_000)).toBe(0);
  });

  it("allows completing a paused track (timeout path) and rejects bad events", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    expect(() => append(log, { type: "resumed", ts: T0 })).toThrow(TransitionError);
    expect(() =>
      append(log, { type: "track_event", trackId: "t2", event: { verb: "x", object: "y", clientTs: "" }, ts: T0 }),
    ).toThrow(TransitionError);
    log = append(log, { type: "paused", ts: T0 + 1000 });
    log = append(log, { type: "track_completed", trackId: "t1", artifact: null, timedOut: true, ts: T0 + 2000 });
    expect(project(log).tracks.t1.timedOut).toBe(true);
    expect(() => append(log, { type: "attempt_completed", ts: T0 })).toThrow(TransitionError);
  });

  it("append never mutates the input log and seq is contiguous", () => {
    const log = start();
    const frozen = JSON.stringify(log);
    const log2 = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    expect(JSON.stringify(log)).toBe(frozen);
    expect(log2.map((e) => e.seq)).toEqual([0, 1]);
  });
});
