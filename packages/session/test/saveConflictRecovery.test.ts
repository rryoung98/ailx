import { describe, it, expect } from "vitest";
import { append } from "../src/machine.js";
import {
  ATTEMPT_KEY,
  SaveConflictError,
  loadAttempt,
  saveAttempt,
  type StorageLike,
} from "../src/persist.js";
import type { SequencedEntry } from "../src/machine.js";

/**
 * TEN-124 — a save conflict is a thing to RECOVER from, not a switch that
 * turns persistence off for the rest of the sitting.
 *
 * `lastSeenRev` was never advanced after a conflict, so the very next save
 * compared the same two numbers and threw again, and again, for the whole
 * run: the candidate went on answering into a log that had stopped growing,
 * and the report was then built from that stale prefix.
 */

function mem() {
  const m = new Map<string, string>();
  const st: StorageLike & { map: Map<string, string> } = {
    map: m,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
  return st;
}

const config = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 60, t2: 60, t3: 60, t4: 60 }, demo: true,
} as never;

const started = (attemptId = "att-1") =>
  append([], { type: "attempt_started", attemptId, config, ts: 1_000 } as never);

/** A foreign write: the stored bytes and the stored rev, straight in. */
function foreignWrite(st: StorageLike, log: readonly SequencedEntry[], rev: number) {
  st.setItem(ATTEMPT_KEY, JSON.stringify({ formatVersion: 1, rev, log }));
}

describe("a save conflict this tab can resolve", () => {
  it("re-derives from the current revision and keeps saving", () => {
    const st = mem();
    const first = started();
    saveAttempt(st, first);

    // Tab B re-wrote the same log (no entry of its own) and bumped the rev.
    foreignWrite(st, first, 2);

    const second = append(first, { type: "track_started", trackId: "t1", ts: 2_000 } as never);
    expect(() => saveAttempt(st, second)).not.toThrow();

    // ...and the sitting goes ON being saved, which is the whole finding.
    const third = append(second, {
      type: "track_event",
      trackId: "t1",
      event: { verb: "prompted", object: "p:1", clientTs: new Date(3_000).toISOString() },
      ts: 3_000,
    } as never);
    expect(() => saveAttempt(st, third)).not.toThrow();
    expect(loadAttempt(st)).toEqual(third);
  });
});

describe("a save conflict this tab can resolve", () => {
  it("writes from the revision that is in storage now, not from the one we last saw", () => {
    const st = mem();
    const first = started();
    saveAttempt(st, first); // rev 1
    foreignWrite(st, first, 7); // another tab, several writes ahead

    const second = append(first, { type: "track_started", trackId: "t1", ts: 2_000 } as never);
    saveAttempt(st, second);
    expect(JSON.parse(st.map.get(ATTEMPT_KEY)!).rev).toBe(8);
  });
});

describe("a save conflict this tab cannot resolve", () => {
  it("refuses rather than overwriting the other tab's work", () => {
    const st = mem();
    const ours = started();
    saveAttempt(st, ours);

    // Tab B is sitting its OWN run: an entry we do not have and cannot keep.
    const theirs = append(started("att-2"), { type: "track_started", trackId: "t4", ts: 2_000 } as never);
    foreignWrite(st, theirs, 2);

    const next = append(ours, { type: "track_started", trackId: "t1", ts: 2_000 } as never);
    expect(() => saveAttempt(st, next)).toThrow(SaveConflictError);
    expect(loadAttempt(st)).toEqual(theirs);
  });

  it("refuses a stored log that STARTS like ours and then goes further", () => {
    const st = mem();
    const ours = started();
    saveAttempt(st, ours);

    // The same run in another tab, one track further on. Our log is a prefix
    // of theirs, so saving ours would delete their track_started.
    const theirs = append(ours, { type: "track_started", trackId: "t2", ts: 2_000 } as never);
    foreignWrite(st, theirs, 2);

    const next = append(ours, { type: "track_started", trackId: "t1", ts: 2_000 } as never);
    expect(() => saveAttempt(st, next)).toThrow(SaveConflictError);
    expect(loadAttempt(st)).toEqual(theirs);
  });

  it("says, in the sentence the candidate is shown, that this tab has stopped saving", () => {
    const st = mem();
    const ours = started();
    saveAttempt(st, ours);
    foreignWrite(st, append(started("att-2"), { type: "track_started", trackId: "t4", ts: 2_000 } as never), 2);

    // The exam page renders err.message. A message that only named two
    // revision numbers told the candidate nothing about the state they are in.
    let message = "";
    try {
      saveAttempt(st, append(ours, { type: "track_started", trackId: "t1", ts: 2_000 } as never));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("STOPPED SAVING");
    expect(message).toContain("not being recorded");
    expect(message).toContain("stored rev 2, expected 1");
  });

  it("goes on refusing — it never quietly starts accepting work again", () => {
    const st = mem();
    const ours = started();
    saveAttempt(st, ours);
    const theirs = append(started("att-2"), { type: "track_started", trackId: "t4", ts: 2_000 } as never);
    foreignWrite(st, theirs, 2);

    const next = append(ours, { type: "track_started", trackId: "t1", ts: 2_000 } as never);
    expect(() => saveAttempt(st, next)).toThrow(SaveConflictError);
    const later = append(next, {
      type: "track_event",
      trackId: "t1",
      event: { verb: "prompted", object: "p:1", clientTs: new Date(3_000).toISOString() },
      ts: 3_000,
    } as never);
    expect(() => saveAttempt(st, later)).toThrow(SaveConflictError);
    expect(loadAttempt(st)).toEqual(theirs);
  });
});
