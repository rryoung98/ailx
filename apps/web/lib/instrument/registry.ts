/**
 * Track Runner registry — REAL track packages wired in.
 *
 * Runners load through dynamic import (code splitting). Scoring calls the
 * plugins' pure score() with deterministically stored demo judgments and
 * NEVER falls back to seeded pseudo-points (F1):
 *  - a well-formed artifact scores through the real plugin;
 *  - a timed-out track scores the last CHECKPOINT-derived partial artifact
 *    (an empty checkpoint yields the plugin's own missing-response zero);
 *  - a truly malformed artifact FAILS CLOSED: score 0 with raw {invalid: 1}.
 *
 * Every scoring call also returns the judgment rows it consumed, the
 * snapshot rubricVersion and the scoring digest (F12). The digest is read
 * from the committed instrument snapshot, where the build step
 * content-addressed each track's score() SOURCE closure — the browser no
 * longer hashes its own bundled code (FRONTEND.md §2.1).
 */
import type { ComponentType } from "react";
import type { Judgment, TrackUIProps } from "@ailx/core";
import { canonicalJson, judgmentId } from "@ailx/core";
import type { SessionLogEntry, TrackId, TrackScoreValue } from "@ailx/session";
import { attestJudgments } from "@ailx/session";
import { t1Plugin } from "@ailx/track-t1";
import { plugin as t2Plugin, validateT2Config } from "@ailx/track-t2";
import { plugin as t3Plugin, validateT3Config } from "@ailx/track-t3";
import { t4Plugin } from "@ailx/track-t4";
import { PlaceholderRunner } from "../../components/PlaceholderRunner";
import { snapshotRubricVersion, snapshotScoringDigest, trackConfig } from "./instrument";
import { judgeT1, judgeT3, judgeT4 } from "@ailx/report";

export interface TrackModule {
  Runner: ComponentType<TrackUIProps>;
  placeholder: boolean;
}

/** Runners come from each plugin's own ui() loader (F11) — no hardcoded
 * platform imports of Runner components. */
export async function loadTrackModule(trackId: TrackId): Promise<TrackModule> {
  try {
    const ui = PLUGINS[trackId].ui;
    if (ui) {
      const mod = (await ui()) as { Runner: ComponentType<TrackUIProps> };
      if (typeof mod.Runner === "function" || typeof mod.Runner === "object") {
        return { Runner: mod.Runner, placeholder: false };
      }
    }
  } catch {
    // fall through
  }
  return { Runner: PlaceholderRunner, placeholder: true };
}

// ---------------------------------------------------------------------------
// Scoring digests (F12): build-time content address of the score() source.
// ---------------------------------------------------------------------------

const PLUGINS = { t1: t1Plugin, t2: t2Plugin, t3: t3Plugin, t4: t4Plugin } as const;

/**
 * The audit digest, read from the committed instrument snapshot. The build
 * step walks each track plugin's score() import closure on disk and hashes
 * the source bytes (packages/content-tools/src/scorers.ts), so the digest
 * identifies the scoring CODE and is re-derivable from a git checkout — the
 * old `Function.prototype.toString()` hash identified the bundle, and moved
 * whenever the minifier did. Fails closed when the snapshot is stale.
 */
export function scoringDigest(trackId: TrackId): string {
  return snapshotScoringDigest(trackId);
}

export function trackModelManifest(trackId: TrackId): Record<string, string> {
  return trackId === "t2"
    ? { pipeline: "model-free: no model in the loop (SDT arithmetic)" }
    : { screening: "demo-judge@1", jury: "demo-judge-1@1,demo-judge-2@1,demo-judge-3@1" };
}

// ---------------------------------------------------------------------------
// Artifact validation — fail CLOSED on malformed input.
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Structural check per track. Tolerates extra fields (new artifact shapes). */
export function isValidArtifact(trackId: TrackId, artifact: unknown): boolean {
  if (!isObj(artifact)) return false;
  const a = artifact;
  switch (trackId) {
    case "t1":
      return typeof a.html === "string" && Array.isArray(a.promptLog) &&
        typeof a.selfReport === "string";
    case "t2":
      return Array.isArray(a.responses) &&
        a.responses.every((r: unknown) => isObj(r) && typeof r.itemId === "string" &&
          typeof r.choice === "number" && typeof r.confidence === "number");
    case "t3":
      return Array.isArray(a.transcript) && typeof a.finalAnswer === "string";
    case "t4":
      return Array.isArray(a.drafts) && isObj(a.finals) &&
        Array.isArray((a.finals as Record<string, unknown>).images) &&
        Array.isArray(a.chosenSet) && typeof a.note === "string" &&
        typeof a.disclosed === "boolean";
  }
}

/**
 * Build a scoreable PARTIAL artifact from a runner checkpoint. A missing or
 * empty checkpoint yields the track's empty artifact, which scores a
 * legitimate zero through the plugin's own missing-response path (T2: all
 * items lapse; T1: empty html; T3: empty transcript; T4: no generations).
 * Defensive against both old and new checkpoint/artifact field shapes.
 */
export function checkpointToArtifact(trackId: TrackId, checkpoint: unknown): unknown {
  const cp = isObj(checkpoint) ? checkpoint : {};
  // Runners may checkpoint the artifact directly or under an `artifact` key.
  const src = isObj(cp.artifact) ? (cp.artifact as Record<string, unknown>) : cp;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);
  switch (trackId) {
    case "t1":
      return {
        ...src,
        html: str(src.html),
        promptLog: arr(src.promptLog),
        selfReport: str(src.selfReport),
      };
    case "t2": {
      const responses = arr(src.responses).filter(
        (r) => isObj(r) && typeof r.itemId === "string" && typeof r.choice === "number",
      ).map((r) => {
        const o = r as Record<string, unknown>;
        return {
          itemId: o.itemId as string,
          choice: o.choice as number,
          confidence: num(o.confidence, 0),
          latencyMs: num(o.latencyMs, 0),
        };
      });
      return { responses };
    }
    case "t3":
      return {
        ...src,
        transcript: arr(src.transcript),
        finalAnswer: str(src.finalAnswer ?? src.draft),
      };
    case "t4": {
      const finals = isObj(src.finals) ? (src.finals as Record<string, unknown>) : {};
      return {
        ...src,
        drafts: arr(src.drafts ?? src.generations),
        finals: {
          images: arr(finals.images),
          ...(isObj(finals.video) ? { video: finals.video } : {}),
        },
        chosenSet: arr(src.chosenSet).filter((x): x is number => typeof x === "number"),
        note: str(src.note),
        disclosed: src.disclosed === true,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface TrackScoringRecord {
  score: TrackScoreValue;
  /**
   * Judgment rows score() consumed — persisted in the session log (F12), in
   * @ailx/core canonical row order so the record does not depend on the order
   * the judge happened to emit them in.
   */
  judgments: Judgment[];
  /** Content address claimed for each row of `judgments`, same order. */
  judgmentIds: string[];
  /** Per-track rubricVersion from the committed instrument snapshot. */
  rubricVersion: string;
  scoringDigest: string;
  modelManifest: Record<string, string>;
}

/**
 * The `track_scored` entry for a LOCAL scoring result.
 *
 * Every producer in the app and its tests goes through here, so there is one
 * place that knows a score of record must arrive with its evidence attested,
 * and no call site that can quietly forget. The machine re-checks it anyway —
 * a producer is a convenience, not a proof.
 */
export function trackScoredEntry(
  trackId: TrackId,
  rec: TrackScoringRecord,
  ts: number,
): SessionLogEntry {
  return {
    type: "track_scored",
    trackId,
    score: rec.score,
    judgments: rec.judgments,
    judgmentIds: rec.judgmentIds,
    rubricVersion: rec.rubricVersion,
    scoringDigest: rec.scoringDigest,
    modelManifest: rec.modelManifest,
    scoredBy: "local",
    ts,
  };
}

/** Fail-closed sentinel: recorded score for malformed input. */
export const INVALID_SCORE: TrackScoreValue = { raw: { invalid: 1 }, scaled: 0 };

/**
 * Score a track artifact through the REAL plugin's pure score(). Malformed
 * artifacts fail closed (scaled 0, raw {invalid: 1}) — never pseudo-points.
 * `locale` must be the SESSION's locale so T2 scores against the same
 * localized deck the candidate answered (item ids are locale-specific).
 */
export function scoreTrack(
  trackId: TrackId,
  artifact: unknown,
  locale: string = "en",
  attemptId?: string,
  storedJudgments?: ReadonlyArray<Judgment>,
): TrackScoringRecord {
  const rubricVersion = snapshotRubricVersion(trackId);
  const base = {
    rubricVersion,
    scoringDigest: scoringDigest(trackId),
    modelManifest: trackModelManifest(trackId),
  };
  /**
   * Attest before returning, at the SINGLE exit: the rows go into canonical
   * order and each gets its content address here, so no caller can record a
   * score whose evidence is unordered or unaddressed. `judgeT*` emit rows in
   * their own emission order; that order is not the store's, and the log must
   * not depend on either.
   */
  const attested = (
    score: TrackScoreValue,
    judgments: Judgment[],
  ): TrackScoringRecord => ({ ...base, score, ...attestJudgments(judgments) });
  const failClosed = () =>
    attested({ raw: { ...INVALID_SCORE.raw }, scaled: 0 }, []);

  if (!isValidArtifact(trackId, artifact)) return failClosed();
  try {
    switch (trackId) {
      case "t1": {
        const a = artifact as Parameters<typeof judgeT1>[0];
        const cfg = t1Plugin.validateConfig(trackConfig("t1"));
        const judgments = storedJudgments ? [...storedJudgments] : judgeT1(a);
        const s = t1Plugin.score({ artifact: a as never, judgments, rubricVersion }, cfg);
        return attested({ raw: s.raw, scaled: s.scaled }, judgments);
      }
      case "t2": {
        // Same locale + attemptId as presentation → same (localized,
        // demo-rotated) deck.
        const cfg = validateT2Config(trackConfig("t2", locale, attemptId));
        const s = t2Plugin.score({ artifact: artifact as never, judgments: [], rubricVersion }, cfg);
        return attested({ raw: s.raw as unknown as Record<string, number>, scaled: s.scaled }, []);
      }
      case "t3": {
        const a = artifact as Parameters<typeof judgeT3>[0];
        const cfg = validateT3Config(trackConfig("t3"));
        const judgments = storedJudgments ? [...storedJudgments] : judgeT3(a);
        const s = t3Plugin.score({ artifact: a as never, judgments, rubricVersion }, cfg);
        return attested({ raw: s.raw as unknown as Record<string, number>, scaled: s.scaled }, judgments);
      }
      case "t4": {
        const a = artifact as Parameters<typeof judgeT4>[0];
        const cfg = t4Plugin.validateConfig(trackConfig("t4"));
        const judgments = storedJudgments ? [...storedJudgments] : judgeT4(a);
        const s = t4Plugin.score({ artifact: a as never, judgments, rubricVersion }, cfg);
        return attested({ raw: s.raw, scaled: s.scaled }, judgments);
      }
    }
  } catch {
    // Any scoring error on structurally valid input still fails closed.
    return failClosed();
  }
}

/**
 * THE CHECK AN AUDITOR RUNS, in production code rather than in a test.
 *
 * Re-derives the score of record from nothing but what the log stored — the
 * artifact and the judgment rows — and compares it to the number that was
 * issued. The judge is NOT called: `scoreTrack` is handed the STORED rows, so
 * this is the same code path that issued the score with its one impure input
 * replaced by the evidence of that input. That is the whole content of the
 * repo invariant, and it is why re-scoring reproduces while re-judging does
 * not.
 *
 * Three ways it can fail, and they mean different things:
 *  - `judgment-mutated` — a stored row no longer content-addresses to the id
 *    recorded against the score. The evidence was edited; the score of record
 *    is VOID, and no recomputation of it means anything.
 *  - `score-mismatch` — the evidence is intact and score() disagrees with the
 *    number anyway. Either the scorer changed or the number was forged.
 *  - `not-replayable-here` — the score was issued by the exam service and it
 *    kept its evidence. Nothing is wrong; this log simply cannot check it,
 *    and says so instead of reporting a pass it did not perform.
 */
export type ReplayStatus =
  | "byte-identical"
  | "judgment-mutated"
  | "score-mismatch"
  | "not-replayable-here";

export interface ReplayResult {
  status: ReplayStatus;
  /** What score() returns from the stored inputs; undefined when not replayed. */
  recomputed?: TrackScoreValue;
  /** Human-readable reason, always set for a non-passing status. */
  detail?: string;
}

export function replayTrackScore(
  trackId: TrackId,
  stored: {
    artifact?: unknown;
    score?: TrackScoreValue;
    judgments?: ReadonlyArray<Judgment>;
    judgmentIds?: ReadonlyArray<string>;
    scoredBy?: "local" | "server";
  },
  locale: string = "en",
  attemptId?: string,
): ReplayResult {
  const { artifact, score, judgments = [], judgmentIds = [] } = stored;
  if (!score) return { status: "not-replayable-here", detail: "no score of record" };

  // 1. The evidence must still be the evidence the score was issued against.
  if (judgmentIds.length !== judgments.length) {
    return {
      status: "judgment-mutated",
      detail: `${judgmentIds.length} recorded ids for ${judgments.length} stored rows`,
    };
  }
  for (let i = 0; i < judgments.length; i++) {
    const actual = judgmentId(judgments[i]);
    if (judgmentIds[i] !== actual) {
      return {
        status: "judgment-mutated",
        detail: `judgment ${i} was recorded as ${String(judgmentIds[i]).slice(0, 12)}… and now addresses ${actual.slice(0, 12)}…`,
      };
    }
  }

  // 2. A score this browser did not issue is not this browser's to replay,
  //    and rows the service hands back do not change that (TEN-119): they
  //    were judged against the OPERATIONAL bank, and the only bank in this
  //    bundle is the released-practice tier. Recomputing them here would
  //    print a mismatch that means nothing except "wrong bank".
  if (stored.scoredBy === "server") {
    return {
      status: "not-replayable-here",
      detail: "issued by the exam service, which holds the evidence and the key",
    };
  }
  if (artifact === undefined) {
    return { status: "not-replayable-here", detail: "no stored artifact" };
  }

  // 3. Replay from the stored inputs. Never from a fresh judge call.
  const rec = scoreTrack(trackId, artifact, locale, attemptId, judgments);
  if (canonicalJson(rec.score) !== canonicalJson(score)) {
    return {
      status: "score-mismatch",
      recomputed: rec.score,
      detail: `recomputed ${rec.score.scaled} against a recorded ${score.scaled}`,
    };
  }
  return { status: "byte-identical", recomputed: rec.score };
}

/** Back-compat convenience: score only. Same fail-closed semantics. */
export function scoreTrackArtifact(trackId: TrackId, artifact: unknown, attemptId?: string): TrackScoreValue {
  return scoreTrack(trackId, artifact, attemptId).score;
}
