import { describe, expect, it } from "vitest";
import {
  append, ATTEMPT_KEY, clearAttempt, loadAttempt, saveAttempt,
  type SequencedEntry, type StorageLike,
} from "../src/index.js";

function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("persistence", () => {
  const log: SequencedEntry[] = append([], {
    type: "attempt_started",
    attemptId: "att-9",
    config: { instrument: "ailx", version: "2026.1", locale: "ja", budgets: { t1: 1, t2: 2, t3: 3, t4: 4 } },
    ts: 123,
  });

  it("round-trips the log", () => {
    const st = memStorage();
    saveAttempt(st, log);
    expect(loadAttempt(st)).toEqual(log);
  });

  it("returns null for missing, corrupt, or wrong-version data", () => {
    const st = memStorage();
    expect(loadAttempt(st)).toBeNull();
    st.setItem(ATTEMPT_KEY, "{not json");
    expect(loadAttempt(st)).toBeNull();
    st.setItem(ATTEMPT_KEY, JSON.stringify({ formatVersion: 2, log: [] }));
    expect(loadAttempt(st)).toBeNull();
  });

  it("clearAttempt removes the key", () => {
    const st = memStorage();
    saveAttempt(st, log);
    clearAttempt(st);
    expect(loadAttempt(st)).toBeNull();
  });
});

import { loadAttemptValidated, validateStoredLog } from "../src/index.js";

describe("validated load (audit: multi-tab / duplicate-append protection)", () => {
  const T0 = 1_760_000_000_000;
  function fullLog(): SequencedEntry[] {
    let l = append([], {
      type: "attempt_started", attemptId: "att-v",
      config: { instrument: "ailx", version: "2026.1", locale: "en", budgets: { t1: 600, t2: 600, t3: 600, t4: 600 } },
      ts: T0,
    });
    l = append(l, { type: "track_started", trackId: "t1", ts: T0 + 1000 });
    l = append(l, {
      type: "track_event", trackId: "t1",
      event: { verb: "prompted", object: "p:1", clientTs: new Date(T0 + 2000).toISOString() },
      ts: T0 + 2000,
    });
    return l;
  }

  it("replays a clean log with zero drops", () => {
    const v = validateStoredLog(fullLog());
    expect(v.dropped).toBe(0);
    expect(v.log).toHaveLength(3);
  });

  it("truncates at a DUPLICATE seq (double append from a second tab)", () => {
    const l = fullLog();
    const corrupt = [...l, { ...l[2] }]; // seq 2 appended twice
    const v = validateStoredLog(corrupt);
    expect(v.log).toHaveLength(3);
    expect(v.dropped).toBe(1);
    expect(v.reason).toContain("seq");
  });

  it("truncates at a seq GAP (lost interleaved write)", () => {
    const l = fullLog();
    const corrupt = [...l, { ...l[2], seq: 5 }];
    const v = validateStoredLog(corrupt);
    expect(v.log).toHaveLength(3);
    expect(v.dropped).toBe(1);
  });

  it("truncates at a backwards timestamp", () => {
    const l = fullLog();
    const corrupt = [
      ...l,
      { type: "track_event", trackId: "t1", event: { verb: "x", object: "y", clientTs: "" }, ts: T0 - 1, seq: 3 },
    ];
    const v = validateStoredLog(corrupt);
    expect(v.log).toHaveLength(3);
    expect(v.dropped).toBe(1);
    expect(v.reason).toContain("rejected");
  });

  it("truncates at a FOREIGN attempt_started spliced mid-log", () => {
    const l = fullLog();
    const corrupt = [
      ...l,
      { type: "attempt_started", attemptId: "att-OTHER", config: (l[0] as { config: unknown }).config, ts: T0 + 3000, seq: 3 },
    ];
    const v = validateStoredLog(corrupt);
    expect(v.log).toHaveLength(3);
    expect(v.dropped).toBe(1);
  });

  it("loadAttempt returns only the machine-replayable prefix", () => {
    const st = memStorage();
    const l = fullLog();
    st.setItem(ATTEMPT_KEY, JSON.stringify({ formatVersion: 1, log: [...l, { ...l[2] }] }));
    const loaded = loadAttempt(st);
    expect(loaded).toHaveLength(3);
    const v = loadAttemptValidated(st);
    expect(v?.dropped).toBe(1);
  });

  it("loadAttempt fails closed when the log is corrupt from entry 0", () => {
    const st = memStorage();
    st.setItem(ATTEMPT_KEY, JSON.stringify({ formatVersion: 1, log: [{ type: "track_started", trackId: "t1", ts: 1, seq: 0 }] }));
    expect(loadAttempt(st)).toBeNull();
  });
});
