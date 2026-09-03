/**
 * PINS THE SILENT COUPLING BETWEEN exportTiers AND THE SESSION MACHINE.
 *
 * `exportTiers.ts` copies stored judgment rows into both export tiers in the
 * order it finds them. It never sorts. That is only safe because the ORDER IS
 * ALREADY A GUARANTEE by the time an export sees it:
 *
 *  - `@ailx/core` (`packages/core/src/judgments.ts`) defines THE canonical
 *    total row order (`compareJudgments` / `canonicalJudgments`);
 *  - `@ailx/session` (`packages/session/src/machine.ts`,
 *    `assertJudgmentsAttested`) REFUSES to append a `track_scored` entry
 *    whose evidence is missing, mutated, unordered or duplicated;
 *  - `loadAttemptValidated` (`packages/session/src/persist.ts`) re-runs that
 *    check over a stored log and truncates a tampered tail.
 *
 * Two ways this can rot, and both must go red HERE:
 *
 *  1. Somebody relaxes the machine's ordering / attestation check. Then an
 *     arbitrary store read order reaches the export, two byte-different
 *     exports describe the same score, and the audit surface is unstable.
 *  2. Somebody makes exportTiers reorder (or de-duplicate, or sort) rows.
 *     Then the export stops being a faithful copy of the log, and an auditor
 *     recomputing content addresses over the exported rows gets a different
 *     artifact from the one the score was issued against.
 *
 * The behavioural tests below assert BOTH halves, so neither can move alone.
 */
import { describe, expect, it } from "vitest";
import { canonicalJudgments, compareJudgments, judgmentId } from "@ailx/core";
import {
  TransitionError, append, attestJudgments, initialState, project,
  saveAttempt, loadAttemptValidated,
  type JudgmentRecord, type SequencedEntry, type SessionConfig,
  type SessionState, type StorageLike, type TrackId,
} from "@ailx/session";
import { participantExport, researchExport, type CompositeSummary } from "../src/exportTiers.js";

const SUMMARY: CompositeSummary = { composite: 50, percentile: 50, band: "B", zComposite: 0 };

const CONFIG: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en", demo: true,
  budgets: { t1: 600, t2: 300, t3: 600, t4: 480 },
};

/** Rows deliberately NOT in canonical order (dimension "b" before "a"). */
const UNSORTED: JudgmentRecord[] = [
  { dimension: "b", sample: 1, value: 0.4, evidence: "e-b", modelId: "m@1" },
  { dimension: "a", sample: 0, value: 0.9, evidence: "e-a", modelId: "m@1" },
  { dimension: "a", sample: 1, value: 0.1, evidence: "e-a2", modelId: "m@1" },
];

const SINGLE: JudgmentRecord[] = [
  { dimension: "d", sample: 0, value: 0.5, evidence: "only", modelId: "m@1" },
];

/**
 * A state built DIRECTLY (bypassing the machine), so the export sees exactly
 * the rows we hand it. This is how we prove exportTiers does no reordering
 * of its own — the guarantee has to come from upstream.
 */
function stateWithJudgments(rows: ReadonlyArray<JudgmentRecord>): SessionState {
  const s = initialState();
  s.attemptId = "attempt-export-order";
  s.phase = "completed";
  s.config = CONFIG;
  for (const t of Object.keys(s.tracks) as TrackId[]) {
    s.tracks[t] = {
      trackId: t,
      status: "completed",
      activeMs: 1_000,
      events: [],
      artifact: { responses: [] },
      score: { raw: { component: 1 }, scaled: 50 },
      rubricVersion: "rv",
      scoringDigest: "sd",
      modelManifest: { screening: "demo-judge@1" },
      judgments: t === "t2" ? [] : rows,
      judgmentIds: (t === "t2" ? [] : rows).map((j) => judgmentId(j)),
      scoredBy: "local",
    };
  }
  return s;
}

const wire = (rows: ReadonlyArray<JudgmentRecord>) =>
  rows.map((j) => ({ dimension: j.dimension, sample: j.sample, value: j.value, modelId: j.modelId }));

function scoredJudgments(export_: ReturnType<typeof researchExport>, t: TrackId) {
  const row = export_.scores.find((s) => s.trackId === t);
  if (!row) throw new Error(`no ${t} in research export`);
  return row.judgments;
}

// ---------------------------------------------------------------------------
// 1. The export is a FAITHFUL COPY: it must not sort, dedupe or drop rows.
// ---------------------------------------------------------------------------

describe("exportTiers copies stored judgment order as-is", () => {
  it("participant tier preserves the stored row order, including a non-canonical one", () => {
    const s = stateWithJudgments(UNSORTED);
    const out = participantExport(s, SUMMARY);
    const t3 = out.tracks.find((t) => t.trackId === "t3");
    expect(t3?.judgments).toEqual(UNSORTED);
    // The point of the assertion: it is NOT the canonical order. If a future
    // exportTiers sorts, this equals canonicalJudgments(UNSORTED) and fails.
    expect(t3?.judgments).not.toEqual(canonicalJudgments(UNSORTED));
  });

  it("research tier preserves the stored row order, including a non-canonical one", () => {
    const out = researchExport(stateWithJudgments(UNSORTED), [], SUMMARY);
    expect(scoredJudgments(out, "t3")).toEqual(wire(UNSORTED));
    expect(scoredJudgments(out, "t3")).not.toEqual(wire(canonicalJudgments(UNSORTED)));
  });

  it("rows already in canonical order survive both exports unchanged", () => {
    const rows = canonicalJudgments(UNSORTED);
    const s = stateWithJudgments(rows);
    expect(participantExport(s, SUMMARY).tracks.find((t) => t.trackId === "t3")?.judgments)
      .toEqual(rows);
    expect(scoredJudgments(researchExport(s, [], SUMMARY), "t3")).toEqual(wire(rows));
  });

  it("a single row exports as a single row", () => {
    const s = stateWithJudgments(SINGLE);
    expect(participantExport(s, SUMMARY).tracks.find((t) => t.trackId === "t1")?.judgments)
      .toEqual(SINGLE);
    expect(scoredJudgments(researchExport(s, [], SUMMARY), "t1")).toEqual(wire(SINGLE));
  });

  it("an empty judgment list stays empty — a model-free track exports no evidence", () => {
    const s = stateWithJudgments(SINGLE);
    expect(participantExport(s, SUMMARY).tracks.find((t) => t.trackId === "t2")?.judgments)
      .toEqual([]);
    expect(scoredJudgments(researchExport(s, [], SUMMARY), "t2")).toEqual([]);
  });

  it("does not mutate the stored rows it copies", () => {
    const rows = UNSORTED.map((j) => ({ ...j }));
    const s = stateWithJudgments(rows);
    researchExport(s, [], SUMMARY);
    participantExport(s, SUMMARY);
    expect(rows).toEqual(UNSORTED);
  });
});

// ---------------------------------------------------------------------------
// 2. The GUARANTEE the export leans on: the machine refuses bad evidence.
//    Relax any of these and the export above starts publishing arbitrary
//    store order.
// ---------------------------------------------------------------------------

/** A log up to (but not including) the t3 score. Timestamps are nondecreasing. */
function logBeforeT3Score(): SequencedEntry[] {
  let ts = 0;
  let log = append([], { type: "attempt_started", attemptId: "a", config: CONFIG, ts });
  for (const t of ["t1", "t2", "t3"] as TrackId[]) {
    log = append(log, { type: "track_started", trackId: t, ts: ++ts });
    log = append(log, { type: "track_completed", trackId: t, artifact: {}, timedOut: false, ts: ++ts });
    if (t === "t3") break;
    log = append(log, {
      type: "track_scored", trackId: t, score: { raw: {}, scaled: t === "t2" ? 10 : 0 },
      rubricVersion: "rv", scoringDigest: "sd", modelManifest: {},
      judgments: [], judgmentIds: [], scoredBy: "local", ts: ++ts,
    });
  }
  return log;
}

const T3_SCORE_TS = 100;

function t3Score(judgments: ReadonlyArray<JudgmentRecord>, ids: ReadonlyArray<string>, scaled = 40) {
  return {
    type: "track_scored" as const, trackId: "t3" as TrackId, score: { raw: {}, scaled },
    rubricVersion: "rv", scoringDigest: "sd", modelManifest: {},
    judgments, judgmentIds: ids, scoredBy: "local" as const, ts: T3_SCORE_TS,
  };
}

describe("the session machine is what makes that copy safe", () => {
  it("accepts judgment rows in canonical order", () => {
    const attested = attestJudgments(UNSORTED);
    expect(attested.judgments).toEqual(canonicalJudgments(UNSORTED));
    expect(() => append(logBeforeT3Score(), t3Score(attested.judgments, attested.judgmentIds)))
      .not.toThrow();
  });

  it("REFUSES rows that are not in canonical order", () => {
    const ids = UNSORTED.map((j) => judgmentId(j));
    expect(() => append(logBeforeT3Score(), t3Score(UNSORTED, ids)))
      .toThrow(/canonical row order/);
  });

  it("REFUSES duplicated rows", () => {
    const dup = [SINGLE[0], { ...SINGLE[0] }];
    expect(compareJudgments(dup[0], dup[1])).toBe(0);
    expect(() => append(logBeforeT3Score(), t3Score(dup, dup.map((j) => judgmentId(j)))))
      .toThrow(/duplicates/);
  });

  it("REFUSES a row mutated after the score was issued", () => {
    const attested = attestJudgments(SINGLE);
    const tampered = [{ ...attested.judgments[0], value: 0.99 }];
    expect(() => append(logBeforeT3Score(), t3Score(tampered, attested.judgmentIds)))
      .toThrow(/void/);
  });

  it("REFUSES a judge-resolved score with no evidence at all", () => {
    expect(() => append(logBeforeT3Score(), t3Score([], [], 40)))
      .toThrow(/empty list is points with no evidence/);
  });

  it("every rejection is a TransitionError, so the log never grows a bad entry", () => {
    const log = logBeforeT3Score();
    expect(() => append(log, t3Score(UNSORTED, UNSORTED.map((j) => judgmentId(j)))))
      .toThrow(TransitionError);
    expect(log).toHaveLength(logBeforeT3Score().length);
  });
});

// ---------------------------------------------------------------------------
// 3. End to end: a log that went through the machine exports in canonical
//    order, and a TAMPERED stored log never reaches an export at all.
// ---------------------------------------------------------------------------

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

describe("machine → projection → export", () => {
  const attested = attestJudgments(UNSORTED);
  const log = append(logBeforeT3Score(), t3Score(attested.judgments, attested.judgmentIds));

  it("exports the rows in @ailx/core canonical order because the log holds them that way", () => {
    const s = project(log);
    const out = researchExport(s, log, SUMMARY);
    expect(scoredJudgments(out, "t3")).toEqual(wire(canonicalJudgments(UNSORTED)));
  });

  it("a tampered stored log is truncated before its score can be exported", () => {
    const storage = memoryStorage();
    saveAttempt(storage, log);
    const raw = JSON.parse(storage.getItem("ailx:attempt:v1") as string) as {
      log: Array<Record<string, unknown>>;
    };
    const scored = raw.log[raw.log.length - 1];
    (scored.judgments as JudgmentRecord[])[0].value = 0.999;
    storage.setItem("ailx:attempt:v1", JSON.stringify(raw));

    const validated = loadAttemptValidated(storage);
    expect(validated?.dropped).toBe(1);
    const s = project(validated?.log ?? []);
    expect(s.tracks.t3.judgments).toBeUndefined();
    // The export therefore publishes no unattested evidence for t3.
    expect(scoredJudgments(researchExport(s, validated?.log ?? [], SUMMARY), "t3")).toEqual([]);
  });
});
