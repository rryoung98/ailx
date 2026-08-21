import { describe, it, expect } from "vitest";
import { saveAttempt, loadAttemptValidated, SaveConflictError, ATTEMPT_KEY } from "../src/persist.js";
import { append } from "../src/machine.js";

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
    const shape = JSON.parse(s.getItem(ATTEMPT_KEY)!);
    shape.rev = shape.rev + 1; // tab B writes
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
    const score = { type: "track_scored", trackId: "t1", score: { raw: {}, scaled: 10 }, rubricVersion: "r", scoringDigest: "s", modelManifest: {}, ts: 4 };
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
