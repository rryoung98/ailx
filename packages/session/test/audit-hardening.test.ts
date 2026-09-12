import { describe, it, expect } from "vitest";
import { saveAttempt, loadAttemptValidated, SaveConflictError, ATTEMPT_KEY } from "../src/persist.js";
import { append, attestJudgments } from "../src/machine.js";

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const cfg = { instrument: "ailx", version: "2026.1", locale: "en", budgets: { t1: 60, t2: 60, t3: 60, t4: 60 }, demo: true };

describe("multi-tab compare-and-swap (audit B1)", () => {
  it("a foreign write between our load and save throws instead of overwriting", () => {
    const s = mem();
    let log = append([], { type: "attempt_started", attemptId: "a", config: cfg, ts: 1 } as never);
    saveAttempt(s, log);
    // Tab B writes, and its write CARRIES WORK OF ITS OWN. It used to only
    // bump the rev, which made this guard pass on a conflict that had nothing
    // to protect — the case TEN-124 recovers from. An overwrite that destroys
    // an append is the thing being refused, so the fixture now has one.
    const shape = JSON.parse(s.getItem(ATTEMPT_KEY)!);
    shape.rev = shape.rev + 1;
    shape.log = append(shape.log, { type: "track_started", trackId: "t4", ts: 2 } as never);
    s.setItem(ATTEMPT_KEY, JSON.stringify(shape));
    log = append(log, { type: "track_started", trackId: "t1", ts: 2 } as never);
    expect(() => saveAttempt(s, log)).toThrow(SaveConflictError);
    loadAttemptValidated(s); // reconcile
    expect(() => saveAttempt(s, log)).not.toThrow();
  });
});

describe("duplicate track_scored rejected (audit M2)", () => {
  it("a second score for the same track fails append", () => {
    let log = append([], { type: "attempt_started", attemptId: "a", config: cfg, ts: 1 } as never);
    log = append(log, { type: "track_started", trackId: "t1", ts: 2 } as never);
    log = append(log, { type: "track_completed", trackId: "t1", artifact: {}, timedOut: false, ts: 3 } as never);
    const score = {
      type: "track_scored", trackId: "t1", score: { raw: {}, scaled: 10 },
      rubricVersion: "r", scoringDigest: "s", modelManifest: {}, scoredBy: "local",
      ...attestJudgments([{ dimension: "analysis", sample: 0, value: 0.6, modelId: "m@1" }]),
      ts: 4,
    };
    log = append(log, score as never);
    expect(() => append(log, { ...score, score: { raw: {}, scaled: 99 }, ts: 5 } as never)).toThrow(/already scored/);
  });
});

describe("unknown entry types rejected (audit M1)", () => {
  it("a bogus entry type fails append", () => {
    const log = append([], { type: "attempt_started", attemptId: "a", config: cfg, ts: 1 } as never);
    expect(() => append(log, { type: "bogus", ts: 2 } as never)).toThrow(/unknown entry type/);
  });
});
