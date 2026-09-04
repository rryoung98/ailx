import { describe, expect, it } from "vitest";
import {
  append,
  attestJudgments,
  JUDGE_RESOLVED_TRACKS,
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
    let t = T0;
    for (const trackId of ["t1", "t2", "t3", "t4"] as const) {
      t += 1000;
      log = append(log, { type: "track_started", trackId, ts: t });
      t += 1000;
      log = append(log, {
        type: "track_event",
        trackId,
        event: { verb: "submitted", object: `${trackId}:artifact`, clientTs: new Date(t).toISOString() },
        ts: t,
      });
      t += 1000;
      log = append(log, { type: "track_completed", trackId, artifact: { trackId }, timedOut: false, ts: t });
      t += 1000;
      // T2 is model-free: its score() reads no judgments, so it must store
      // none. The judge-resolved tracks must store the rows they consumed.
      const rows = JUDGE_RESOLVED_TRACKS.includes(trackId)
        ? [{ dimension: "analysis", sample: 0, value: 0.6, modelId: "demo-judge@1" }]
        : [];
      log = append(log, {
        type: "track_scored", trackId,
        score: { raw: { total: 61 }, scaled: 61 },
        rubricVersion: "r", scoringDigest: "s", modelManifest: { demo: "demo-judge@1" },
        scoredBy: "local",
        ...attestJudgments(rows),
        ts: t,
      });
    }
    log = append(log, { type: "attempt_completed", ts: t + 1000 });
    const s = project(log);
    expect(s.phase).toBe("completed");
    expect(Object.values(s.tracks).every((tr) => tr.status === "completed")).toBe(true);
    expect(s.tracks.t3.score?.scaled).toBe(61);
    expect(s.tracks.t2.events).toHaveLength(1);
    // Judgment rows persist through the projection (F12).
    expect(s.tracks.t1.judgments).toEqual([
      { dimension: "analysis", sample: 0, value: 0.6, modelId: "demo-judge@1" },
    ]);
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
    // exhaust the 600 s budget, then pause: completion must carry timedOut=true
    log = append(log, { type: "paused", ts: T0 + 700_000 });
    log = append(log, { type: "track_completed", trackId: "t1", artifact: null, timedOut: true, ts: T0 + 700_500 });
    expect(project(log).tracks.t1.timedOut).toBe(true);
    expect(() => append(log, { type: "attempt_completed", ts: T0 + 700_500 })).toThrow(TransitionError);
  });

  it("append never mutates the input log and seq is contiguous", () => {
    const log = start();
    const frozen = JSON.stringify(log);
    const log2 = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    expect(JSON.stringify(log)).toBe(frozen);
    expect(log2.map((e) => e.seq)).toEqual([0, 1]);
  });
});

describe("timestamp + budget invariants (F13)", () => {
  it("rejects a backwards pause timestamp (the review's probe now throws)", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 + 5000 });
    // The Codex review probe: pause 1 s BEFORE the start. Must throw, never
    // produce activeMs = -1000 / a 601 s budget.
    expect(() =>
      append(log, { type: "paused", ts: T0 + 4000 }),
    ).toThrow(TransitionError);
  });

  it("rejects any entry with a ts earlier than the last event", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 + 1000 });
    log = append(log, {
      type: "track_event", trackId: "t1",
      event: { verb: "prompted", object: "p", clientTs: "" }, ts: T0 + 2000,
    });
    expect(() =>
      append(log, {
        type: "track_event", trackId: "t1",
        event: { verb: "prompted", object: "p2", clientTs: "" }, ts: T0 + 1999,
      }),
    ).toThrow(/earlier than the last event/);
    expect(() =>
      append(log, { type: "track_completed", trackId: "t1", artifact: null, timedOut: false, ts: T0 }),
    ).toThrow(TransitionError);
  });

  it("clamps negative durations to 0 when projecting a legacy stored log", () => {
    // A hand-tampered log (bypassing append validation) still cannot create
    // negative active time or a stretched budget.
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 + 5000 });
    const tampered: SequencedEntry[] = [
      ...log,
      { type: "paused", ts: T0 + 4000, seq: log.length } as SequencedEntry,
    ];
    const s = project(tampered);
    expect(s.tracks.t1.activeMs).toBe(0);
    expect(secondsRemaining(s, "t1", T0 + 9_999_999)).toBeLessThanOrEqual(600);
  });

  it("rejects track_event after the budget is exhausted", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    // budget t1 = 600 s; an event at exactly budget exhaustion is rejected
    expect(() =>
      append(log, {
        type: "track_event", trackId: "t1",
        event: { verb: "prompted", object: "late", clientTs: "" }, ts: T0 + 600_000,
      }),
    ).toThrow(/budget exhausted/);
    // one millisecond before exhaustion is still accepted
    const ok = append(log, {
      type: "track_event", trackId: "t1",
      event: { verb: "prompted", object: "in-time", clientTs: "" }, ts: T0 + 599_999,
    });
    expect(project(ok).tracks.t1.events).toHaveLength(1);
  });

  it("derives timedOut from accounting and rejects a lying flag", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    // Not exhausted -> claiming timedOut=true is rejected.
    expect(() =>
      append(log, { type: "track_completed", trackId: "t1", artifact: null, timedOut: true, ts: T0 + 1000 }),
    ).toThrow(/disagrees with budget accounting/);
    // Exhausted -> claiming timedOut=false is rejected.
    expect(() =>
      append(log, { type: "track_completed", trackId: "t1", artifact: null, timedOut: false, ts: T0 + 600_000 }),
    ).toThrow(/disagrees with budget accounting/);
    // Agreeing flags pass, and projection reports the derived value.
    const timedOut = append(log, { type: "track_completed", trackId: "t1", artifact: null, timedOut: true, ts: T0 + 600_000 });
    expect(project(timedOut).tracks.t1.timedOut).toBe(true);
    const inTime = append(log, { type: "track_completed", trackId: "t1", artifact: null, timedOut: false, ts: T0 + 1000 });
    expect(project(inTime).tracks.t1.timedOut).toBe(false);
  });
});

describe("paused-phase event persistence (audit: no silent drop)", () => {
  it("accepts track_event while paused for the current track", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    log = append(log, { type: "paused", ts: T0 + 5_000 });
    // A mounted runner's internal timer fires under the pause veil.
    log = append(log, {
      type: "track_event", trackId: "t1",
      event: { verb: "responded", object: "item:x", clientTs: new Date(T0 + 6_000).toISOString() },
      ts: T0 + 6_000,
    });
    const s = project(log);
    expect(s.phase).toBe("paused");
    expect(s.tracks.t1.events).toHaveLength(1);
    // Paused time still does not consume budget.
    expect(secondsRemaining(s, "t1", T0 + 500_000)).toBe(595);
  });

  it("still rejects paused track_event for a NON-current track", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    log = append(log, { type: "paused", ts: T0 + 5_000 });
    expect(() =>
      append(log, {
        type: "track_event", trackId: "t2",
        event: { verb: "x", object: "y", clientTs: "" }, ts: T0 + 6_000,
      }),
    ).toThrow(TransitionError);
  });

  it("still rejects paused track_event once the budget is exhausted", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    // exhaust the 600 s budget while running, then pause
    log = append(log, { type: "paused", ts: T0 + 700_000 });
    expect(() =>
      append(log, {
        type: "track_event", trackId: "t1",
        event: { verb: "late", object: "z", clientTs: "" }, ts: T0 + 700_001,
      }),
    ).toThrow(TransitionError);
  });
});

/**
 * P0 fairness: a post-submit presentation screen (T2's replay, T3's reveal,
 * T4's delivery gallery) holds the track clock. The reason lives ON the
 * paused entry so a reload — and an auditor — can tell a held clock from a
 * candidate's own pause without guessing.
 */
describe("pause reason (presentation clock hold)", () => {
  it("records why the clock stopped and clears it on resume", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    log = append(log, { type: "paused", reason: "presentation", ts: T0 + 10_000 });
    const held = project(log);
    expect(held.phase).toBe("paused");
    expect(held.pauseReason).toBe("presentation");
    log = append(log, { type: "resumed", ts: T0 + 300_000 });
    expect(project(log).pauseReason).toBeUndefined();
  });

  it("accepts the CONTENT hold, and charges nothing for it (TEN-116)", () => {
    // The track has started but the hosted deck is still in flight: the
    // wait is the host's, so the budget must not move for it.
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    log = append(log, { type: "paused", reason: "loading", ts: T0 + 1_000 });
    const held = project(log);
    expect(held.pauseReason).toBe("loading");
    expect(secondsRemaining(held, "t1", T0 + 600_000)).toBe(599);
    log = append(log, { type: "resumed", ts: T0 + 600_000 });
    expect(project(log).pauseReason).toBeUndefined();
    expect(secondsRemaining(project(log), "t1", T0 + 601_000)).toBe(598);
  });

  it("defaults an unlabelled pause to the candidate (legacy stored logs)", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    log = append(log, { type: "paused", ts: T0 + 1_000 });
    expect(project(log).pauseReason).toBe("candidate");
  });

  it("charges no budget for the held interval", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    log = append(log, { type: "paused", reason: "presentation", ts: T0 + 60_000 });
    // Five minutes of reading the replay.
    const s = project(log);
    expect(secondsRemaining(s, "t1", T0 + 60_000)).toBe(540);
    expect(secondsRemaining(s, "t1", T0 + 360_000)).toBe(540);
    // Resuming charges from the resume instant, never the held interval.
    log = append(log, { type: "resumed", ts: T0 + 360_000 });
    expect(secondsRemaining(project(log), "t1", T0 + 370_000)).toBe(530);
  });

  it("completes a track from a held clock with timedOut derived, not guessed", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    log = append(log, { type: "paused", reason: "presentation", ts: T0 + 60_000 });
    // A candidate who reads for an hour still has 9 minutes of work left,
    // so the track did NOT time out.
    log = append(log, {
      type: "track_completed", trackId: "t1", artifact: { ok: true },
      timedOut: false, ts: T0 + 3_600_000,
    });
    const s = project(log);
    expect(s.tracks.t1.timedOut).toBe(false);
    expect(s.tracks.t1.activeMs).toBe(60_000);
    expect(s.pauseReason).toBeUndefined();
    expect(s.phase).toBe("between_tracks");
  });

  it("rejects an invented pause reason instead of folding it", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    expect(() =>
      append(log, {
        type: "paused",
        reason: "free-time" as unknown as "presentation",
        ts: T0 + 1_000,
      }),
    ).toThrow(TransitionError);
  });

  it("clears the reason when the next track starts", () => {
    let log = start();
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    log = append(log, { type: "paused", reason: "presentation", ts: T0 + 1_000 });
    log = append(log, {
      type: "track_completed", trackId: "t1", artifact: {}, timedOut: false, ts: T0 + 2_000,
    });
    log = append(log, { type: "track_started", trackId: "t2", ts: T0 + 3_000 });
    const s = project(log);
    expect(s.phase).toBe("in_track");
    expect(s.pauseReason).toBeUndefined();
  });
});
