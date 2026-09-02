/**
 * THE RECOMPUTABILITY INVARIANT, AT THE PERSISTENCE BOUNDARY.
 *
 * AGENTS.md: "Any score ever issued is byte-identically recomputable from
 * stored inputs." Before this file, nothing in production enforced it.
 * `judgmentId()` had no production caller at all; `track_scored` took an
 * arbitrary score with OPTIONAL judgments and recorded no claim about them;
 * and the hosted T3 path wrote a real score with `judgments: []`. A previous
 * test suite "proved" the invariant against a toy scorer defined inside the
 * test, so it could not fail when the real system broke.
 *
 * These tests drive the REAL machine and the REAL validated-load path. The
 * scorer half — that the real T1/T3/T4 plugins replay their stored rows to
 * the same bytes — is `apps/web/test/recomputability.test.ts`, which is where
 * the plugins may legitimately be imported.
 */
import { describe, expect, it } from "vitest";
import {
  append,
  attestJudgments,
  JUDGE_RESOLVED_TRACKS,
  project,
  TransitionError,
  type JudgmentRecord,
  type SequencedEntry,
  type SessionConfig,
  type SessionLogEntry,
} from "../src/index.js";
import { canonicalJson, judgmentId } from "@ailx/core";
import { loadAttemptValidated, saveAttempt, ATTEMPT_KEY } from "../src/persist.js";

const CFG: SessionConfig = {
  instrument: "ailx",
  version: "2026.1",
  locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 },
  demo: true,
};

/** Three rows deliberately NOT in canonical order as written. */
const ROWS: JudgmentRecord[] = [
  { dimension: "clarity", sample: 1, value: 0.5, evidence: "b", modelId: "m-2@1" },
  { dimension: "analysis", sample: 0, value: 0.6, evidence: "a", modelId: "m-1@1" },
  { dimension: "analysis", sample: 1, value: 0.4, evidence: "c", modelId: "m-1@1" },
];

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

/** A log with t1 completed, ready for a `track_scored`. */
function upToT1Completed(): SequencedEntry[] {
  let log = append([], { type: "attempt_started", attemptId: "a1", config: CFG, ts: 1 });
  log = append(log, { type: "track_started", trackId: "t1", ts: 2 });
  return append(log, { type: "track_completed", trackId: "t1", artifact: { k: 1 }, timedOut: false, ts: 3 });
}

function scoredEntry(over: Partial<Record<string, unknown>> = {}): SessionLogEntry {
  return {
    type: "track_scored",
    trackId: "t1",
    score: { raw: { analysis: 30 }, scaled: 30 },
    rubricVersion: "r1",
    scoringDigest: "d1",
    modelManifest: { jury: "m-1@1" },
    scoredBy: "local",
    ...attestJudgments(ROWS),
    ts: 4,
    ...over,
  } as SessionLogEntry;
}

describe("attestJudgments is the one producer of a judgment attestation", () => {
  it("puts the rows in canonical order and content-addresses each one", () => {
    const { judgments, judgmentIds } = attestJudgments(ROWS);
    expect(judgments.map((j) => `${j.dimension}:${j.sample}`)).toEqual([
      "analysis:0", "analysis:1", "clarity:1",
    ]);
    expect(judgmentIds).toEqual(judgments.map((j) => judgmentId(j)));
  });

  it("is itself order-invariant: any permutation attests identically", () => {
    const base = canonicalJson(attestJudgments(ROWS));
    const perms = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    for (const p of perms) {
      expect(canonicalJson(attestJudgments(p.map((i) => ROWS[i])))).toBe(base);
    }
  });

  it("does not mutate the caller's array — it may be the stored read itself", () => {
    const input = ROWS.slice();
    attestJudgments(input);
    expect(input).toEqual(ROWS);
  });
});

describe("track_scored refuses a score that is not recomputable", () => {
  it("accepts a well-formed local score and projects the attestation", () => {
    const s = project(append(upToT1Completed(), scoredEntry()));
    expect(s.tracks.t1.scoredBy).toBe("local");
    expect(s.tracks.t1.judgmentIds).toEqual(s.tracks.t1.judgments!.map((j) => judgmentId(j)));
  });

  it("rejects a judgment row that was MUTATED after the score was issued", () => {
    const good = scoredEntry() as Extract<SessionLogEntry, { type: "track_scored" }>;
    // The auditor's exact scenario: ids of record, rows quietly edited.
    const tampered = good.judgments.map((j, i) => (i === 0 ? { ...j, value: 0.9 } : j));
    expect(() => append(upToT1Completed(), { ...good, judgments: tampered })).toThrow(
      /content-addresses to .* this score of record is void/,
    );
  });

  it("rejects a claimed id that addresses nothing stored", () => {
    const good = scoredEntry() as Extract<SessionLogEntry, { type: "track_scored" }>;
    const ids = good.judgmentIds.slice();
    ids[1] = "0".repeat(64);
    expect(() => append(upToT1Completed(), { ...good, judgmentIds: ids })).toThrow(
      /judgmentIds\[1\] claims 0{64}/,
    );
  });

  it("rejects a count mismatch in either direction", () => {
    const good = scoredEntry() as Extract<SessionLogEntry, { type: "track_scored" }>;
    expect(() => append(upToT1Completed(), { ...good, judgmentIds: good.judgmentIds.slice(0, 2) }))
      .toThrow(/2 entries for 3 judgment rows/);
    expect(() => append(upToT1Completed(), { ...good, judgmentIds: [...good.judgmentIds, "x"] }))
      .toThrow(/4 entries for 3 judgment rows/);
  });

  it("rejects rows stored in store-read order rather than canonical order", () => {
    // The exact defect: a SQL read with no ORDER BY, written straight to the log.
    const rows = [ROWS[2], ROWS[1], ROWS[0]];
    expect(() =>
      append(upToT1Completed(), scoredEntry({
        judgments: rows, judgmentIds: rows.map((j) => judgmentId(j)),
      })),
    ).toThrow(/canonical row order/);
  });

  it("rejects a duplicated row — one content address cannot mean two rows", () => {
    const rows = [ROWS[1], ROWS[1], ROWS[2]];
    expect(() =>
      append(upToT1Completed(), scoredEntry({
        judgments: rows, judgmentIds: rows.map((j) => judgmentId(j)),
      })),
    ).toThrow(/duplicates judgments\[0\]/);
  });

  it("rejects the omissions the old OPTIONAL shape allowed", () => {
    for (const missing of ["judgments", "judgmentIds", "scoredBy"] as const) {
      const e = scoredEntry() as Record<string, unknown>;
      delete e[missing];
      expect(() => append(upToT1Completed(), e as SessionLogEntry), missing)
        .toThrow(TransitionError);
    }
  });

  it("rejects an unknown scoredBy rather than defaulting it", () => {
    expect(() => append(upToT1Completed(), scoredEntry({ scoredBy: "trust-me" })))
      .toThrow(/unknown scoredBy trust-me/);
  });
});

describe("evidence must be present exactly where score() consumes it", () => {
  it.each(JUDGE_RESOLVED_TRACKS)(
    "%s cannot be scored LOCALLY with an empty judgment list",
    (trackId) => {
      // Build a log up to this track's completion.
      let log = append([], { type: "attempt_started", attemptId: "a1", config: CFG, ts: 1 });
      let ts = 2;
      for (const t of ["t1", "t2", "t3", "t4"] as const) {
        log = append(log, { type: "track_started", trackId: t, ts: ts++ });
        log = append(log, { type: "track_completed", trackId: t, artifact: {}, timedOut: false, ts: ts++ });
        if (t === trackId) break;
        log = append(log, scoredEntry({
          trackId: t, ts: ts++, scoredBy: "local",
          ...attestJudgments(JUDGE_RESOLVED_TRACKS.includes(t) ? ROWS : []),
        }));
      }
      expect(() =>
        append(log, scoredEntry({ trackId, ts: ts + 1, ...attestJudgments([]) })),
      ).toThrow(/must carry the judgment rows/);
    },
  );

  it("t2 is model-free, so storing judgments against it is rejected", () => {
    let log = append([], { type: "attempt_started", attemptId: "a1", config: CFG, ts: 1 });
    log = append(log, { type: "track_started", trackId: "t1", ts: 2 });
    log = append(log, { type: "track_completed", trackId: "t1", artifact: {}, timedOut: false, ts: 3 });
    log = append(log, scoredEntry({ ts: 4 }));
    log = append(log, { type: "track_started", trackId: "t2", ts: 5 });
    log = append(log, { type: "track_completed", trackId: "t2", artifact: {}, timedOut: false, ts: 6 });
    expect(() => append(log, scoredEntry({ trackId: "t2", ts: 7 }))).toThrow(/model-free/);
    expect(() =>
      append(log, scoredEntry({ trackId: "t2", ts: 7, ...attestJudgments([]) })),
    ).not.toThrow();
  });

  it("a SERVER score may carry no evidence, and says so instead of implying it", () => {
    // The exam service holds the key this browser must not have. That is a
    // real constraint, so the log states the narrower truth rather than a
    // false broad one: scoredBy 'server', no rows, nothing claiming replay.
    const log = append(upToT1Completed(), scoredEntry({
      scoredBy: "server", ...attestJudgments([]),
    }));
    const s = project(log);
    expect(s.tracks.t1.scoredBy).toBe("server");
    expect(s.tracks.t1.judgments).toEqual([]);
  });

  it("a SERVER score that DOES return rows is attested exactly like a local one", () => {
    const bad = scoredEntry({ scoredBy: "server" }) as Extract<SessionLogEntry, { type: "track_scored" }>;
    expect(() =>
      append(upToT1Completed(), { ...bad, judgmentIds: bad.judgmentIds.map(() => "0".repeat(64)) }),
    ).toThrow(/this score of record is void/);
  });
});

describe("a stored log is re-checked on load, not trusted", () => {
  it("a hand-edited judgment value in localStorage truncates the log and says why", () => {
    const storage = memStorage();
    let log = append(upToT1Completed(), scoredEntry());
    log = append(log, { type: "track_started", trackId: "t2", ts: 5 });
    saveAttempt(storage, log);

    // Tamper exactly as an attacker with localStorage would: bump the score
    // and the judgment it came from, leave the recorded ids alone.
    const shape = JSON.parse(storage.getItem(ATTEMPT_KEY)!);
    const entry = shape.log.find((e: { type: string }) => e.type === "track_scored");
    entry.judgments[0].value = 0.99;
    entry.score.scaled = 99;
    storage.setItem(ATTEMPT_KEY, JSON.stringify(shape));

    const loaded = loadAttemptValidated(storage);
    expect(loaded.dropped).toBe(2); // the forged score and everything after it
    expect(loaded.reason).toMatch(/this score of record is void/);
    expect(project(loaded.log).tracks.t1.score).toBeUndefined();
  });

  it("an untampered log round-trips byte-identically", () => {
    const storage = memStorage();
    const log = append(upToT1Completed(), scoredEntry());
    saveAttempt(storage, log);
    const loaded = loadAttemptValidated(storage);
    expect(loaded.dropped).toBe(0);
    expect(canonicalJson(loaded.log)).toBe(canonicalJson(log));
  });
});
