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
 * snapshot rubricVersion and a real scoring digest (F12):
 *   scoringDigest = sha256(`${plugin.id}@${pkg.version}:${score.toString()}`)
 * i.e. a hash of the track package version plus the score() source actually
 * shipped in this bundle.
 */
import type { ComponentType } from "react";
import type { Judgment, TrackUIProps } from "@ailx/core";
import type { TrackId, TrackScoreValue } from "@ailx/session";
import { sha256Hex } from "@ailx/session";
import { t1Plugin } from "@ailx/track-t1";
import { plugin as t2Plugin, validateT2Config } from "@ailx/track-t2";
import { plugin as t3Plugin, validateT3Config } from "@ailx/track-t3";
import { t4Plugin } from "@ailx/track-t4";
import t1Pkg from "@ailx/track-t1/package.json";
import t2Pkg from "@ailx/track-t2/package.json";
import t3Pkg from "@ailx/track-t3/package.json";
import t4Pkg from "@ailx/track-t4/package.json";
import { PlaceholderRunner } from "./PlaceholderRunner";
import { snapshotRubricVersion, trackConfig } from "./instrument";
import { judgeT1, judgeT3, judgeT4 } from "./judging";

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
// Scoring digests (F12): hash of package version + score() source.
// ---------------------------------------------------------------------------

const PLUGINS = { t1: t1Plugin, t2: t2Plugin, t3: t3Plugin, t4: t4Plugin } as const;
const PKG_VERSIONS: Record<TrackId, string> = {
  t1: (t1Pkg as { version: string }).version,
  t2: (t2Pkg as { version: string }).version,
  t3: (t3Pkg as { version: string }).version,
  t4: (t4Pkg as { version: string }).version,
};

export function scoringDigest(trackId: TrackId): string {
  const plugin = PLUGINS[trackId];
  return sha256Hex(
    `${plugin.id}@${PKG_VERSIONS[trackId]}:${plugin.score.toString()}`,
  );
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
  /** Judgment rows score() consumed — persisted in the session log (F12). */
  judgments: Judgment[];
  /** Per-track rubricVersion from the committed instrument snapshot. */
  rubricVersion: string;
  scoringDigest: string;
  modelManifest: Record<string, string>;
}

/** Fail-closed sentinel: recorded score for malformed input. */
export const INVALID_SCORE: TrackScoreValue = { raw: { invalid: 1 }, scaled: 0 };

/**
 * Score a track artifact through the REAL plugin's pure score(). Malformed
 * artifacts fail closed (scaled 0, raw {invalid: 1}) — never pseudo-points.
 */
export function scoreTrack(trackId: TrackId, artifact: unknown): TrackScoringRecord {
  const rubricVersion = snapshotRubricVersion(trackId);
  const base = {
    rubricVersion,
    scoringDigest: scoringDigest(trackId),
    modelManifest: trackModelManifest(trackId),
  };
  if (!isValidArtifact(trackId, artifact)) {
    return { ...base, score: { raw: { ...INVALID_SCORE.raw }, scaled: 0 }, judgments: [] };
  }
  try {
    switch (trackId) {
      case "t1": {
        const a = artifact as Parameters<typeof judgeT1>[0];
        const cfg = t1Plugin.validateConfig(trackConfig("t1"));
        const judgments = judgeT1(a);
        const s = t1Plugin.score({ artifact: a as never, judgments, rubricVersion }, cfg);
        return { ...base, score: { raw: s.raw, scaled: s.scaled }, judgments };
      }
      case "t2": {
        const cfg = validateT2Config(trackConfig("t2"));
        const s = t2Plugin.score({ artifact: artifact as never, judgments: [], rubricVersion }, cfg);
        return { ...base, score: { raw: s.raw as unknown as Record<string, number>, scaled: s.scaled }, judgments: [] };
      }
      case "t3": {
        const a = artifact as Parameters<typeof judgeT3>[0];
        const cfg = validateT3Config(trackConfig("t3"));
        const judgments = judgeT3(a);
        const s = t3Plugin.score({ artifact: a as never, judgments, rubricVersion }, cfg);
        return { ...base, score: { raw: s.raw as unknown as Record<string, number>, scaled: s.scaled }, judgments };
      }
      case "t4": {
        const a = artifact as Parameters<typeof judgeT4>[0];
        const cfg = t4Plugin.validateConfig(trackConfig("t4"));
        const judgments = judgeT4(a);
        const s = t4Plugin.score({ artifact: a as never, judgments, rubricVersion }, cfg);
        return { ...base, score: { raw: s.raw, scaled: s.scaled }, judgments };
      }
    }
  } catch {
    // Any scoring error on structurally valid input still fails closed.
    return { ...base, score: { raw: { ...INVALID_SCORE.raw }, scaled: 0 }, judgments: [] };
  }
}

/** Back-compat convenience: score only. Same fail-closed semantics. */
export function scoreTrackArtifact(trackId: TrackId, artifact: unknown): TrackScoreValue {
  return scoreTrack(trackId, artifact).score;
}
