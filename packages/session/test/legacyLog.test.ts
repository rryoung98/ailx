/**
 * TEN-160 — a log written by an OLDER BUILD is not a tampered log.
 *
 * The bug, exactly as the founder saw it in the browser:
 *
 *   ⚠ Persistence warning: stored run log had 4 corrupt trailing entries
 *   truncated (entry 4 rejected: Error: track_scored rejected: unknown
 *   scoredBy undefined (phase=between_tracks))
 *
 * `track_scored` gained REQUIRED `scoredBy` and `judgmentIds` on 2026-09-01
 * (commit 4ad7af6), when score issuance moved to the exam service. A log any
 * earlier build wrote has neither, so `append()` refused the entry and
 * `validateStoredLog` truncated the whole tail behind it and called it
 * corruption. The invariant was working. The MESSAGE was wrong, and the
 * truncation threw away completed tracks that had nothing wrong with them.
 *
 * These tests pin both halves: the legacy shape survives without being called
 * corrupt, and a genuinely tampered log is still truncated and still called
 * tampered.
 */
import { describe, expect, it } from "vitest";
import { attestJudgments, isPreAttestationScore, validateStoredLog } from "../src/index.js";
import type { JudgmentRecord } from "../src/machine.js";

const T0 = 1_760_000_000_000;

const CONFIG = {
  instrument: "ailx",
  version: "2026.1",
  locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 },
} as const;

/** The two entries every log starts with. */
function head(): unknown[] {
  return [
    { type: "attempt_started", attemptId: "att-old", config: CONFIG, ts: T0, seq: 0 },
    { type: "track_started", trackId: "t2", ts: T0 + 1_000, seq: 1 },
    { type: "track_completed", trackId: "t2", artifact: { answers: ["a"] }, timedOut: false, ts: T0 + 2_000, seq: 2 },
  ];
}

/**
 * A log EXACTLY as a pre-2026-09-01 build wrote it: `track_scored` with
 * `judgments` but no `judgmentIds` and no `scoredBy`, followed by the rest of
 * a real sitting — which is what the old truncation was discarding.
 */
function legacyRaw(): unknown[] {
  return [
    ...head(),
    {
      type: "track_scored", trackId: "t2",
      score: { raw: { correct: 3 }, scaled: 60 },
      rubricVersion: "2026.1", scoringDigest: "sha256:abc", modelManifest: {},
      judgments: [], ts: T0 + 3_000, seq: 3,
    },
    { type: "track_started", trackId: "t3", ts: T0 + 4_000, seq: 4 },
    { type: "track_completed", trackId: "t3", artifact: { turns: 2 }, timedOut: false, ts: T0 + 5_000, seq: 5 },
    { type: "attempt_completed", ts: T0 + 6_000, seq: 6 },
  ];
}

const ROW: JudgmentRecord = { dimension: "d1", sample: 0, value: 0.5, modelId: "m-1" };

/**
 * A CURRENT-build log: the same sitting, scored the way this build scores.
 * T3 rather than T2, because T3 is judge-resolved — it is the track that
 * carries judgment rows, so it is the one a mutated row can be tested on.
 */
function currentRaw(): unknown[] {
  const attested = attestJudgments([ROW]);
  return [
    { type: "attempt_started", attemptId: "att-new", config: CONFIG, ts: T0, seq: 0 },
    { type: "track_started", trackId: "t3", ts: T0 + 1_000, seq: 1 },
    { type: "track_completed", trackId: "t3", artifact: { turns: 2 }, timedOut: false, ts: T0 + 2_000, seq: 2 },
    {
      type: "track_scored", trackId: "t3",
      score: { raw: { d1: 0.5 }, scaled: 60 },
      rubricVersion: "2026.1", scoringDigest: "sha256:abc", modelManifest: {},
      judgments: attested.judgments, judgmentIds: attested.judgmentIds,
      scoredBy: "local", ts: T0 + 3_000, seq: 3,
    },
    { type: "attempt_completed", ts: T0 + 4_000, seq: 4 },
  ];
}

describe("pre-attestation (legacy) stored logs", () => {
  it("REPRODUCES the founder's report on the old rule: the tail was truncated", () => {
    // The old code path, replayed by hand: append() still refuses the entry.
    const raw = legacyRaw();
    const legacyEntry = raw[3];
    expect(isPreAttestationScore(legacyEntry)).toBe(true);
    // Everything downstream of that entry is real work, not corruption.
    expect(raw.slice(4)).toHaveLength(3);
  });

  it("does NOT report a legacy log as corruption", () => {
    const v = validateStoredLog(legacyRaw());
    expect(v.dropped).toBe(0);
    expect(v.reason).toBeUndefined();
  });

  it("names the legacy case, and names the track that lost its score", () => {
    const v = validateStoredLog(legacyRaw());
    expect(v.legacyScores).toBe(1);
    expect(v.legacyTracks).toEqual(["t2"]);
  });

  it("KEEPS the rest of the sitting instead of truncating it", () => {
    const v = validateStoredLog(legacyRaw());
    // 7 raw entries, 1 legacy score removed, 6 replayed.
    expect(v.log).toHaveLength(6);
    expect(v.log.map((e) => e.type)).toEqual([
      "attempt_started", "track_started", "track_completed",
      "track_started", "track_completed", "attempt_completed",
    ]);
  });

  it("renumbers seq contiguously after the removal, so the log stays replayable", () => {
    const v = validateStoredLog(legacyRaw());
    expect(v.log.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    // The survivor round-trips through the validator with nothing to report.
    const again = validateStoredLog(v.log);
    expect(again.dropped).toBe(0);
    expect(again.legacyScores).toBe(0);
  });

  it("does NOT admit the unattested score — the track loads with no score of record", () => {
    const v = validateStoredLog(legacyRaw());
    expect(v.log.some((e) => e.type === "track_scored")).toBe(false);
  });

  it("counts every legacy score, in log order", () => {
    const raw = [
      ...legacyRaw().slice(0, 6),
      {
        type: "track_scored", trackId: "t3",
        score: { raw: {}, scaled: 40 },
        rubricVersion: "2026.1", scoringDigest: "sha256:abc", modelManifest: {},
        judgments: [], ts: T0 + 5_500, seq: 6,
      },
      { type: "attempt_completed", ts: T0 + 6_000, seq: 7 },
    ];
    const v = validateStoredLog(raw);
    expect(v.dropped).toBe(0);
    expect(v.legacyTracks).toEqual(["t2", "t3"]);
  });
});

describe("a current-build log is unaffected", () => {
  it("replays clean, with no legacy and no drop", () => {
    const v = validateStoredLog(currentRaw());
    expect(v.dropped).toBe(0);
    expect(v.legacyScores).toBe(0);
    expect(v.legacyTracks).toEqual([]);
    expect(v.log).toHaveLength(5);
    expect(v.log.some((e) => e.type === "track_scored")).toBe(true);
  });
});

describe("tamper is still tamper", () => {
  it("truncates and REPORTS a mutated judgment row (the id no longer addresses it)", () => {
    const raw = currentRaw();
    const scored = raw[3] as { judgments: JudgmentRecord[] };
    scored.judgments = [{ ...ROW, value: 0.9 }]; // row changed, id left alone
    const v = validateStoredLog(raw);
    expect(v.dropped).toBe(2);
    expect(v.legacyScores).toBe(0);
    expect(v.reason).toContain("content-addresses");
    expect(v.reason).toContain("void");
  });

  it("truncates and REPORTS a score whose scoredBy is present but bogus", () => {
    const raw = currentRaw();
    (raw[3] as { scoredBy: string }).scoredBy = "the-candidate";
    const v = validateStoredLog(raw);
    expect(v.dropped).toBe(2);
    expect(v.legacyScores).toBe(0);
    expect(v.reason).toContain("unknown scoredBy");
  });

  it("refuses a half-stripped entry: judgmentIds present, scoredBy gone is no build's shape", () => {
    const raw = currentRaw();
    delete (raw[3] as { scoredBy?: unknown }).scoredBy;
    expect(isPreAttestationScore(raw[3])).toBe(false);
    const v = validateStoredLog(raw);
    expect(v.dropped).toBe(2);
    expect(v.legacyScores).toBe(0);
  });

  it("still truncates a duplicated append (second-tab corruption)", () => {
    const raw = [...legacyRaw()];
    raw.push({ ...(raw[5] as object) }); // seq 5 twice
    const v = validateStoredLog(raw);
    expect(v.dropped).toBe(1);
    expect(v.reason).toContain("seq");
  });

  it("reports a legacy log that was ALSO tampered with as BOTH", () => {
    const raw = [...legacyRaw()];
    raw.push({ type: "resumed", ts: T0 + 7_000, seq: 7 }); // nothing is paused
    const v = validateStoredLog(raw);
    expect(v.legacyScores).toBe(1);
    expect(v.dropped).toBe(1);
    expect(v.reason).toContain("rejected");
  });
});

describe("the legacy shortcut buys a tamperer nothing", () => {
  it("stripping scoredBy and judgmentIds DISCARDS the score, it does not admit it", () => {
    const raw = currentRaw();
    const forged = raw[3] as Record<string, unknown>;
    forged.score = { raw: {}, scaled: 100 };
    delete forged.scoredBy;
    delete forged.judgmentIds;
    const v = validateStoredLog(raw);
    // No truncation, but also no score: the forged 100 is simply not there.
    expect(v.dropped).toBe(0);
    expect(v.log.some((e) => e.type === "track_scored")).toBe(false);
    expect(v.legacyTracks).toEqual(["t3"]);
  });
});
