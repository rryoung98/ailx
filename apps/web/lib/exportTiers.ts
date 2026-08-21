/**
 * Export tiers — spec §16. The static showcase produces the two
 * candidate-facing shapes:
 *  - Individual (participant) tier: scores, composite, percentile, band,
 *    process diagnostics.
 *  - Research tier: de-identified item-level events with latencies, rubric
 *    versions and model manifests, keyed by pid — never a name.
 */

import type { SequencedEntry, SessionState, TrackId } from "@ailx/session";
import { TRACK_IDS, sha256Hex } from "@ailx/session";
import { trackInsights } from "./insights";
import { TRACK_META } from "./tracks";

export interface CompositeSummary {
  composite: number;
  percentile: number;
  band: string;
  zComposite: number;
}

export function participantExport(state: SessionState, summary: CompositeSummary) {
  return {
    tier: "individual" as const,
    instrument: state.config?.instrument ?? "ailx",
    version: state.config?.version ?? "2026.1",
    generator: "ailx-web static showcase (deterministic demo scoring)",
    attemptId: state.attemptId,
    locale: state.config?.locale,
    demo: state.config?.demo === true,
    tracks: TRACK_IDS.map((t) => trackBlock(state, t)),
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

export function researchExport(state: SessionState, log: readonly SequencedEntry[], summary: CompositeSummary) {
  // De-identification is structural: pid derived by hash, names never enter.
  const pid = `pid-${sha256Hex(`ailx:${state.attemptId ?? "unknown"}`).slice(0, 16)}`;
  const t0 = log.length > 0 ? log[0].ts : 0;
  return {
    tier: "research" as const,
    schema: "ailx.research.v1",
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
    /** xAPI-shaped statements, relative-timestamped, append-only order preserved. */
    statements: log
      .filter((e) => e.type === "track_event")
      .map((e, i, arr) => ({
        seq: e.seq,
        trackId: e.type === "track_event" ? e.trackId : undefined,
        verb: e.type === "track_event" ? e.event.verb : undefined,
        object: e.type === "track_event" ? e.event.object : undefined,
        tRelMs: e.ts - t0,
        latencyMs: i > 0 ? e.ts - arr[i - 1].ts : null,
      })),
    sessionLog: log.map((e) => ({ ...e, ts: e.ts - t0 })),
    scores: TRACK_IDS.map((t) => ({
      trackId: t,
      raw: state.tracks[t].score?.raw ?? null,
      scaled: state.tracks[t].score?.scaled ?? null,
    })),
    composite: summary,
    consent: { researchRelease: "demo-granted", revocable: true },
  };
}
