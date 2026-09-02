/**
 * THE RECOMPUTABILITY INVARIANT, THROUGH THE REAL SCORERS AND THE REAL
 * PERSISTENCE PATH.
 *
 * AGENTS.md: "Any score ever issued is byte-identically recomputable from
 * stored inputs. A judge's output IS a stored input." The companion suite
 * `packages/session/test/recomputability.test.ts` proves the machine refuses
 * an unattested score. This one proves the other half, which is the half a
 * fixture cannot fake: that the REAL T1/T2/T3/T4 plugins, over the REAL demo
 * instrument, replay their REAL stored judgment rows to the same bytes — and
 * that the whole issue → persist → reload → replay path holds.
 *
 * The suite this replaces scored a toy function defined inside the test file.
 * It could not fail when the real system broke, and the real system was
 * broken at the time: `judgmentId()` had no production caller anywhere.
 */
import { describe, expect, it } from "vitest";
import type { Judgment } from "@ailx/core";
import { canonicalJson, canonicalJudgments, judgmentId } from "@ailx/core";
import {
  append, attestJudgments, JUDGE_RESOLVED_TRACKS, loadAttemptValidated,
  project, saveAttempt, TRACK_IDS, type SequencedEntry, type TrackId,
} from "@ailx/session";
import {
  replayTrackScore, scoreTrack, trackScoredEntry, type TrackScoringRecord,
} from "../lib/instrument/registry";
import { buildSampleAttemptLog } from "../lib/instrument/sampleAttempt";
import { judgeT1, judgeT4 } from "@ailx/report";

/** The rows the demo jury EMITS, before anything canonicalizes them. */
function judgeEmission(t: "t1" | "t4", artifact: unknown): Judgment[] {
  return t === "t1"
    ? judgeT1(artifact as Parameters<typeof judgeT1>[0])
    : judgeT4(artifact as Parameters<typeof judgeT4>[0]);
}

const rowKey = (j: Judgment) => `${j.dimension}#${j.sample}`;

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

/** The real scripted attempt, scored through the real registry path. */
function scoredAttempt(): {
  log: SequencedEntry[];
  records: Record<TrackId, TrackScoringRecord>;
} {
  let log = buildSampleAttemptLog();
  const state = project(log);
  const records = {} as Record<TrackId, TrackScoringRecord>;
  let ts = log[log.length - 1].ts;
  for (const t of TRACK_IDS) {
    ts += 1000;
    const rec = scoreTrack(t, state.tracks[t].artifact, "en");
    records[t] = rec;
    log = append(log, trackScoredEntry(t, rec, ts));
  }
  return { log: append(log, { type: "attempt_completed", ts: ts + 1000 }), records };
}

/**
 * Built LAZILY and memoized. `append()` rejects an unattested score, so a
 * regression in the registry would otherwise throw during module collection
 * and report "no tests" instead of a named failure — a red run nobody can
 * read is barely better than a green one that lies.
 */
let memo: ReturnType<typeof scoredAttempt> | undefined;
const attempt = () => (memo ??= scoredAttempt());
const state = () => project(attempt().log);


describe("every real plugin issues a score with its evidence attested", () => {
  it.each(TRACK_IDS)("%s records an id that content-addresses every stored row", (t) => {
    const rec = attempt().records[t];
    expect(rec.judgmentIds).toEqual(rec.judgments.map((j) => judgmentId(j)));
    expect(rec.judgmentIds).toHaveLength(rec.judgments.length);
  });

  it.each(JUDGE_RESOLVED_TRACKS)("%s issues no points without stored rows", (t) => {
    const rec = attempt().records[t];
    expect(rec.judgments.length).toBeGreaterThan(0);
    expect(rec.score.scaled).toBeGreaterThan(0);
  });

  it("t2 is model-free and stores nothing", () => {
    expect(attempt().records.t2.judgments).toEqual([]);
    expect(attempt().records.t2.score.scaled).toBeGreaterThan(0);
  });

  it("stores the rows in canonical order, whatever order the jury emitted", () => {
    // Deliberately does NOT go through append(): the machine would reject a
    // non-canonical entry and every test in the file would fail at once. This
    // names the defect at the registry, where it would be introduced.
    const artifacts = project(buildSampleAttemptLog()).tracks;
    for (const t of TRACK_IDS) {
      const rec = scoreTrack(t, artifacts[t].artifact, "en");
      expect(canonicalJson(rec.judgments), t)
        .toBe(canonicalJson(canonicalJudgments(rec.judgments)));
      // ...and the ids follow the rows, not the emission order.
      expect(rec.judgmentIds, t).toEqual(rec.judgments.map((j) => judgmentId(j)));
    }
    // Sharp: T1's and T4's demo juries emit dimension-blocks in a DIFFERENT
    // order from the canonical one, so this cannot pass by coincidence — the
    // judge order and the canonical order really are two different orders.
    for (const t of ["t1", "t4"] as const) {
      const emitted = judgeEmission(t, artifacts[t].artifact);
      expect(emitted.length, t).toBeGreaterThan(0);
      expect(emitted.map(rowKey), t)
        .not.toEqual(canonicalJudgments(emitted).map(rowKey));
    }
  });

  it("scoring the same artifact twice is byte-identical", () => {
    for (const t of TRACK_IDS) {
      const again = scoreTrack(t, state().tracks[t].artifact, "en");
      expect(canonicalJson(again), t).toBe(canonicalJson(attempt().records[t]));
    }
  });
});

describe("re-SCORING reproduces; the judge is never on the recompute path", () => {
  it.each(TRACK_IDS)("%s replays its stored inputs byte-identically", (t) => {
    const r = replayTrackScore(t, state().tracks[t]);
    expect(r.detail ?? "").toBe("");
    expect(r.status).toBe("byte-identical");
    expect(canonicalJson(r.recomputed)).toBe(canonicalJson(state().tracks[t].score));
  });

  it.each(JUDGE_RESOLVED_TRACKS)(
    "%s replays the STORED rows, not a fresh judgment — a drifted judge cannot move it",
    (t) => {
      const stored = state().tracks[t];
      // Substitute judge output that DISAGREES with what was stored, exactly
      // as a re-invoked LLM judge would. Replay must ignore it entirely,
      // because it reads the stored rows.
      const drifted: Judgment[] = stored.judgments!.map((j) => ({
        ...j, value: Math.min(1, Math.max(0, 1 - j.value)),
      }));
      const reJudged = scoreTrack(t, stored.artifact, "en", undefined, drifted);
      // Guard: the substitution must actually be capable of moving the score,
      // or the assertion below would pass for the wrong reason.
      expect(canonicalJson(reJudged.score), `${t} drift guard`)
        .not.toBe(canonicalJson(stored.score));
      expect(replayTrackScore(t, stored).status).toBe("byte-identical");
    },
  );

  it.each(TRACK_IDS)(
    "%s is invariant to the order the stored rows come back in",
    (t) => {
      const stored = state().tracks[t];
      const rows = stored.judgments ?? [];
      if (rows.length === 0) return; // t2 stores none; nothing to permute
      const ofRecord = canonicalJson(stored.score);
      // Reversed, rotated, and a deterministic shuffle — the three shapes a
      // store with no ORDER BY actually produces.
      const orders = [
        [...rows].reverse(),
        [...rows.slice(3), ...rows.slice(0, 3)],
        [...rows].sort((a, b) => (a.value === b.value ? 0 : a.value < b.value ? 1 : -1)),
      ];
      for (const perm of orders) {
        const rec = scoreTrack(t, stored.artifact, "en", undefined, perm);
        expect(canonicalJson(rec.score), t).toBe(ofRecord);
        // ...and the attestation is the same set of ids in the same order.
        expect(rec.judgmentIds).toEqual(stored.judgmentIds);
      }
    },
  );
});

describe("replay detects the two ways a score of record goes wrong", () => {
  it("a MUTATED stored row voids the score instead of silently rescoring it", () => {
    const stored = state().tracks.t1;
    const tampered = stored.judgments!.map((j, i) => (i === 0 ? { ...j, value: 0.01 } : j));
    const r = replayTrackScore("t1", { ...stored, judgments: tampered });
    expect(r.status).toBe("judgment-mutated");
    expect(r.detail).toMatch(/judgment 0 was recorded as/);
    expect(r.recomputed).toBeUndefined(); // a void score is not recomputed
  });

  it("an intact evidence base with a FORGED number is a score-mismatch", () => {
    const stored = state().tracks.t3;
    const r = replayTrackScore("t3", {
      ...stored, score: { ...stored.score!, scaled: stored.score!.scaled + 1 },
    });
    expect(r.status).toBe("score-mismatch");
    expect(r.detail).toMatch(/recomputed .* against a recorded/);
  });

  it("a server score with no evidence reports what it is, not a pass", () => {
    const r = replayTrackScore("t3", {
      ...state().tracks.t3, judgments: [], judgmentIds: [], scoredBy: "server",
    });
    expect(r.status).toBe("not-replayable-here");
    expect(r.detail).toMatch(/exam service/);
  });
});

describe("the whole issue → persist → reload → replay path", () => {
  it("survives a localStorage round trip byte for byte", () => {
    const storage = memStorage();
    saveAttempt(storage, attempt().log);
    const loaded = loadAttemptValidated(storage);
    expect(loaded.dropped).toBe(0);
    expect(canonicalJson(loaded.log)).toBe(canonicalJson(attempt().log));
    const reloaded = project(loaded.log);
    for (const t of TRACK_IDS) {
      expect(replayTrackScore(t, reloaded.tracks[t]).status, t).toBe("byte-identical");
    }
  });

  it("a judgment edited in storage cannot be reloaded as a score at all", () => {
    const storage = memStorage();
    saveAttempt(storage, attempt().log);
    const shape = JSON.parse(storage.getItem("ailx:attempt:v1")!);
    const scored = shape.log.find(
      (e: { type: string; trackId?: string }) => e.type === "track_scored" && e.trackId === "t3",
    );
    scored.judgments[0].value = 0.999;
    storage.setItem("ailx:attempt:v1", JSON.stringify(shape));

    const loaded = loadAttemptValidated(storage);
    expect(loaded.reason).toMatch(/score of record is void/);
    expect(project(loaded.log).tracks.t3.score).toBeUndefined();
  });
});

describe("JUDGE_RESOLVED_TRACKS is verified against the real plugins, not declared", () => {
  /**
   * The session machine decides "this track must store its evidence" from a
   * declared list. A declaration nothing checks is how the invariant was lost
   * the first time, so this varies ONLY the stored judgments of every real
   * plugin and asserts the set of scores that move is exactly that list.
   */
  it("is exactly the set of tracks whose real score() moves with its judgments", () => {
    const moves: TrackId[] = [];
    for (const t of TRACK_IDS) {
      const stored = state().tracks[t];
      const rows = stored.judgments ?? [];
      // Probe with values a scorer cannot ignore: all-zero and all-one over
      // the dimensions this track's own jury emits. For t2, which stores
      // none, borrow t1's dimensions so "t2 ignores judgments" is PROVED
      // rather than assumed from an empty list.
      const template = rows.length > 0 ? rows : (state().tracks.t1.judgments ?? []);
      for (const v of [0, 1]) {
        const probe: Judgment[] = template.map((j) => ({ ...j, value: v }));
        const rec = scoreTrack(t, stored.artifact, "en", undefined, probe);
        if (canonicalJson(rec.score) !== canonicalJson(stored.score)) {
          moves.push(t);
          break;
        }
      }
    }
    expect(moves).toEqual([...JUDGE_RESOLVED_TRACKS]);
  });

  it("attestJudgments and the registry agree on canonical order", () => {
    for (const t of TRACK_IDS) {
      const rec = attempt().records[t];
      expect(canonicalJson(attestJudgments(rec.judgments))).toBe(
        canonicalJson({ judgments: rec.judgments, judgmentIds: rec.judgmentIds }),
      );
    }
  });
});
