/**
 * Report golden — one digest over every derived report value.
 *
 * The scripted sample attempt is fed through the whole derivation chain in
 * `@ailx/report` (composite, insights, narratives, player type, profile,
 * calibration, both export tiers) and the result is content-addressed. Any
 * change to any of those functions moves the digest, so a silent shift in a
 * reported number cannot land. Build-dependent fields (`scoringDigest`) are
 * blanked: they identify the bundle, not the scoring values (lib/registry.ts).
 */
import { describe, expect, it } from "vitest";
import { append, canonicalJson, project, sha256Hex, TRACK_IDS, type SequencedEntry } from "@ailx/session";
import {
  calibrationBins, candidateComposite, narratives, participantExport, playerProfile,
  playerType, researchExport, t2ResponsesFromArtifact, trackInsights,
} from "@ailx/report";
import { t2AnswerKeys } from "../lib/instrument";
import { scoreTrack } from "../lib/registry";
import { buildSampleAttemptLog } from "../lib/sampleAttempt";

/** Recursively blank every `scoringDigest` — it addresses the build, not a value. */
function withoutBuildDigests<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (k, val) => (k === "scoringDigest" ? null : val)),
  ) as T;
}

function derivedReport() {
  let log = buildSampleAttemptLog();
  const scored = project(log);
  let ts = log[log.length - 1].ts;
  for (const t of TRACK_IDS) {
    ts += 1000;
    const rec = scoreTrack(t, scored.tracks[t].artifact);
    log = append(log, {
      type: "track_scored", trackId: t, score: rec.score, judgments: rec.judgments,
      rubricVersion: rec.rubricVersion, scoringDigest: rec.scoringDigest,
      modelManifest: rec.modelManifest, ts,
    } as SequencedEntry);
  }
  log = append(log, { type: "attempt_completed", ts: ts + 1000 } as SequencedEntry);
  const state = project(log);
  const composite = candidateComposite(state);
  if (!composite) throw new Error("sample attempt must score every track");
  const insights = trackInsights(state);
  const t2 = t2ResponsesFromArtifact(state.tracks.t2.artifact);
  return withoutBuildDigests({
    composite,
    insights,
    narratives: narratives(insights),
    playerType: playerType(composite.trackRaw),
    profile: playerProfile(state, insights),
    calibration: calibrationBins(t2, t2AnswerKeys("en")),
    participant: participantExport(state, composite),
    research: researchExport(state, log, composite),
  });
}

describe("report golden", () => {
  it("derives the same report values it did before @ailx/report existed", () => {
    expect(sha256Hex(canonicalJson(derivedReport()))).toBe("9a287a9ce8b1a08e595b8d269b648cc3bef9ce34b752787a8864ed02494f23f1");
  });

  it("is stable across repeated derivation", () => {
    expect(canonicalJson(derivedReport())).toBe(canonicalJson(derivedReport()));
  });
});
