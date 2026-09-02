import { describe, expect, it } from "vitest";
import type { StorageLike } from "@ailx/session";
import {
  checkpointKey, clearAllCheckpoints, clearCheckpoint, loadCheckpoint, saveCheckpoint,
} from "../lib/data/checkpoints";

function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("checkpoint store (F2)", () => {
  it("uses a dedicated key per attempt+track", () => {
    expect(checkpointKey("att-1", "t2")).toBe("ailx:checkpoint:att-1:t2");
  });

  it("round-trips arbitrary JSON state", () => {
    const s = memStorage();
    const state = { responses: [{ itemId: "a", choice: 1, confidence: 70 }], cursor: 3 };
    saveCheckpoint(s, "att-1", "t2", state);
    expect(loadCheckpoint(s, "att-1", "t2")).toEqual(state);
    // isolated per track and per attempt
    expect(loadCheckpoint(s, "att-1", "t1")).toBeUndefined();
    expect(loadCheckpoint(s, "att-2", "t2")).toBeUndefined();
  });

  it("overwrites with the latest checkpoint", () => {
    const s = memStorage();
    saveCheckpoint(s, "att-1", "t3", { draft: "v1" });
    saveCheckpoint(s, "att-1", "t3", { draft: "v2" });
    expect(loadCheckpoint(s, "att-1", "t3")).toEqual({ draft: "v2" });
  });

  it("returns undefined for corrupt or foreign payloads", () => {
    const s = memStorage();
    s.setItem(checkpointKey("att-1", "t1"), "{not json");
    expect(loadCheckpoint(s, "att-1", "t1")).toBeUndefined();
    s.setItem(checkpointKey("att-1", "t1"), JSON.stringify({ formatVersion: 99, state: 1 }));
    expect(loadCheckpoint(s, "att-1", "t1")).toBeUndefined();
  });

  it("clears one track or all tracks for an attempt", () => {
    const s = memStorage();
    for (const t of ["t1", "t2", "t3", "t4"] as const) saveCheckpoint(s, "att-1", t, { t });
    clearCheckpoint(s, "att-1", "t2");
    expect(loadCheckpoint(s, "att-1", "t2")).toBeUndefined();
    expect(loadCheckpoint(s, "att-1", "t1")).toEqual({ t: "t1" });
    clearAllCheckpoints(s, "att-1");
    expect(s.map.size).toBe(0);
  });

  it("swallows storage quota errors instead of crashing the exam", () => {
    const s = memStorage();
    s.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(() => saveCheckpoint(s, "att-1", "t1", { big: "x" })).not.toThrow();
  });
});

describe("checkpoint binding (audit: reject foreign-attempt payloads)", () => {
  it("rejects a payload copied under another attempt's key", () => {
    const s = memStorage();
    saveCheckpoint(s, "att-1", "t2", { deckIndex: 3 });
    // Simulate a multi-tab race / restore tool copying bytes across keys.
    s.setItem(checkpointKey("att-2", "t2"), s.map.get(checkpointKey("att-1", "t2"))!);
    expect(loadCheckpoint(s, "att-2", "t2")).toBeUndefined();
    expect(loadCheckpoint(s, "att-1", "t2")).toEqual({ deckIndex: 3 });
  });

  it("rejects a payload copied under another TRACK's key", () => {
    const s = memStorage();
    saveCheckpoint(s, "att-1", "t2", { deckIndex: 3 });
    s.setItem(checkpointKey("att-1", "t3"), s.map.get(checkpointKey("att-1", "t2"))!);
    expect(loadCheckpoint(s, "att-1", "t3")).toBeUndefined();
  });

  it("rejects legacy v1 payloads without attempt/track binding (fail closed)", () => {
    const s = memStorage();
    s.setItem(checkpointKey("att-1", "t1"), JSON.stringify({ formatVersion: 1, state: { html: "<p>x</p>" } }));
    expect(loadCheckpoint(s, "att-1", "t1")).toBeUndefined();
  });

  it("stored shape embeds the ids it was written for", () => {
    const s = memStorage();
    saveCheckpoint(s, "att-9", "t4", { drafts: [] });
    const raw = JSON.parse(s.map.get(checkpointKey("att-9", "t4"))!);
    expect(raw.formatVersion).toBe(2);
    expect(raw.attemptId).toBe("att-9");
    expect(raw.trackId).toBe("t4");
  });
});
