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
