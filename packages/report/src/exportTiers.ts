/**
 * Export tiers — spec §16. The static showcase produces the two
 * candidate-facing shapes:
 *
 *  - INDIVIDUAL (participant) tier: the candidate's OWN data — scores,
 *    composite, percentile, band, process diagnostics, and their full
 *    artifacts. Explicitly labelled: this file is not de-identified.
 *
 *  - RESEARCH tier: built from an explicit ALLOWLIST schema
 *    (ailx.research.v2). It carries scores, subscores, rubric/scoring
 *    digests, judgment rows, event VERBS + timings (no free-text payloads),
 *    per-track eventCounts (audit tallies), and T2 item ids + responses. It never copies raw artifacts, HTML,
 *    transcripts, notes, or arbitrary event result/context fields (F15).
 *
 * JUDGMENT ROWS ARE COPIED IN THE STORED ORDER — this file never sorts them.
 * It relies on the log already being canonical: `assertJudgmentsAttested`
 * (`packages/session/src/machine.ts`) refuses a `track_scored` entry whose
 * evidence is missing, mutated, unordered or duplicated, `@ailx/core`
 * (`packages/core/src/judgments.ts`) owns THE canonical row order, and
 * `loadAttemptValidated` truncates a tampered stored log. Both halves of that
 * coupling are pinned by `packages/report/test/exportJudgmentOrder.test.ts`.
 */

import type {
  JudgmentRecord, SequencedEntry, SessionState, TrackId,
} from "@ailx/session";
import { TRACK_IDS, sha256Hex } from "@ailx/session";
import { trackInsights } from "./insights.js";
import { TRACK_META } from "./tracks.js";

export interface CompositeSummary {
  composite: number;
  percentile: number;
  band: string;
  zComposite: number;
}

export function participantExport(state: SessionState, summary: CompositeSummary) {
  return {
    tier: "individual" as const,
    label:
      "Individual tier — the candidate's own data, including full artifacts. NOT de-identified; do not share as research data.",
    instrument: state.config?.instrument ?? "ailx",
    version: state.config?.version ?? "2026.1",
    generator: "ailx-web static showcase (deterministic demo scoring)",
    attemptId: state.attemptId,
    locale: state.config?.locale,
    demo: state.config?.demo === true,
    tracks: TRACK_IDS.map((t) => ({
      ...trackBlock(state, t),
      /** The candidate's own submitted artifact (their data — spec §16). */
      artifact: state.tracks[t].artifact ?? null,
      judgments: state.tracks[t].judgments ?? null,
    })),
    composite: {
      scale: "normalised area transformation: rank → percentile → inverse-normal → mean 50 SD 15, truncated [0,100]",
      value: summary.composite,
      percentile: summary.percentile,
      band: summary.band,
      note: "The composite is normalised by construction; raw-distribution shape is preserved separately (spec §04).",
    },
    processDiagnostics: trackInsights(state),
  };
}

function trackBlock(state: SessionState, t: TrackId) {
  const ts = state.tracks[t];
  const meta = TRACK_META[t];
  return {
    trackId: t,
    name: meta.name,
    pluginId: meta.pluginId,
    rawSubscores: ts.score?.raw ?? null,
    scaled: ts.score?.scaled ?? null,
    outOf: meta.points,
    rubricVersion: ts.rubricVersion ?? null,
    scoringDigest: ts.scoringDigest ?? null,
    modelManifest: ts.modelManifest ?? null,
    timedOut: ts.timedOut === true,
  };
}

// ---------------------------------------------------------------------------
// Research tier — explicit allowlist schema (ailx.research.v2)
// ---------------------------------------------------------------------------

/** Allowlisted judgment row: numeric value + ids, no free-text evidence. */
function allowJudgment(j: JudgmentRecord) {
  return {
    dimension: j.dimension,
    sample: j.sample,
    value: j.value,
    modelId: j.modelId,
  };
}

/** Allowlisted T2 response row: item id + structured response only. */
interface T2ResponseLike {
  itemId?: unknown; choice?: unknown; confidence?: unknown; latencyMs?: unknown;
}

function allowT2Responses(artifact: unknown) {
  if (artifact === null || typeof artifact !== "object") return [];
  const rs = (artifact as { responses?: unknown }).responses;
  if (!Array.isArray(rs)) return [];
  return rs
    .filter((r): r is T2ResponseLike => r !== null && typeof r === "object")
    .map((r) => ({
      itemId: typeof r.itemId === "string" ? r.itemId : null,
      choice: typeof r.choice === "number" ? r.choice : null,
      confidence: typeof r.confidence === "number" ? r.confidence : null,
      latencyMs: typeof r.latencyMs === "number" ? r.latencyMs : null,
    }));
}

export function researchExport(state: SessionState, log: readonly SequencedEntry[], summary: CompositeSummary) {
  // De-identification is structural: pid derived by hash, names never enter,
  // and the schema is an allowlist — nothing outside it is copied.
  const pid = `pid-${sha256Hex(`ailx:${state.attemptId ?? "unknown"}`).slice(0, 16)}`;
  const t0 = log.length > 0 ? log[0].ts : 0;
  return {
    tier: "research" as const,
    schema: "ailx.research.v2",
    generator: "ailx-web static showcase (deterministic demo scoring)",
    demo: state.config?.demo === true,
    instrument: {
      id: state.config?.instrument ?? "ailx",
      version: state.config?.version ?? "2026.1",
      packageDigest: "demo:static-showcase",
    },
    pid,
    locale: state.config?.locale,
    trackVersions: TRACK_IDS.map((t) => ({
      trackId: t,
      pluginId: TRACK_META[t].pluginId,
      rubricVersion: state.tracks[t].rubricVersion ?? null,
      scoringDigest: state.tracks[t].scoringDigest ?? null,
      modelManifest: state.tracks[t].modelManifest ?? null,
    })),
    /** Event VERBS + timings only — objects, results, context are dropped.
     * latencyMs is anchored WITHIN the track: ms since the previous event of
     * the SAME track (null for a track's first event) — never a gap that
     * spans a track boundary or the between-tracks screen. */
    statements: (() => {
      const lastTsByTrack = new Map<string, number>();
      return log
        .filter((e): e is Extract<SequencedEntry, { type: "track_event" }> => e.type === "track_event")
        .map((e) => {
          const prev = lastTsByTrack.get(e.trackId);
          lastTsByTrack.set(e.trackId, e.ts);
          return {
            seq: e.seq,
            trackId: e.trackId,
            verb: e.event.verb,
            tRelMs: e.ts - t0,
            latencyMs: prev !== undefined ? e.ts - prev : null,
          };
        });
    })(),
    /** Per-track audit tallies: how many runner events were persisted, by
     * verb — lets researchers verify no emission was silently dropped. */
    eventCounts: TRACK_IDS.map((t) => {
      const evs = log.filter(
        (e): e is Extract<SequencedEntry, { type: "track_event" }> =>
          e.type === "track_event" && e.trackId === t,
      );
      const byVerb: Record<string, number> = {};
      for (const e of evs) byVerb[e.event.verb] = (byVerb[e.event.verb] ?? 0) + 1;
      return { trackId: t, total: evs.length, byVerb };
    }),
    /** Session milestones: entry types + relative timings, no payloads. */
    timeline: log.map((e) => ({
      seq: e.seq,
      type: e.type,
      trackId: "trackId" in e ? e.trackId : null,
      tRelMs: e.ts - t0,
    })),
    scores: TRACK_IDS.map((t) => ({
      trackId: t,
      raw: state.tracks[t].score?.raw ?? null,
      scaled: state.tracks[t].score?.scaled ?? null,
      timedOut: state.tracks[t].timedOut === true,
      judgments: (state.tracks[t].judgments ?? []).map(allowJudgment),
    })),
    /** T2 is structured response data — item ids + responses are shareable. */
    t2Responses: allowT2Responses(state.tracks.t2.artifact),
    composite: summary,
    consent: { researchRelease: "demo-granted", revocable: true },
  };
}
