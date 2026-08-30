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
  calibrationBins, candidateComposite, identitySignals, narratives, participantExport,
  playerType, playerTypeFor, researchExport, t2ResponsesFromArtifact, trackInsights,
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
    // BOTH derivations of the one identity: the behavioural read an
    // individual card shows, and the cohort-median read the world page must
    // use because a population query has no event log.
    playerType: playerTypeFor(state, composite.trackRaw, insights),
    playerTypeFromScoresOnly: playerType(composite.trackRaw),
    identitySignals: identitySignals(state, insights),
    calibration: calibrationBins(t2, t2AnswerKeys("en")),
    participant: participantExport(state, composite),
    research: researchExport(state, log, composite),
  });
}

describe("report golden", () => {
  /**
   * The digest MOVED once, deliberately, when the report's two competing
   * four-letter identities became one: the second system (`playerProfile`,
   * KCVI-shaped) is gone, and each player-type pole now carries the
   * behavioural measurement it was decided from (`strength`, `evidence`).
   * No SCORE moved with it — the sample attempt still reads MSVD under both
   * the behavioural and the scores-only derivation, which is why the two are
   * pinned side by side above.
   *
   * It MOVED a second time, also deliberately, when verification became a
   * per-claim act (F5): an unattributed `verified` event — the old
   * "Verify against source" button, and the T1/T2/T4 events the sample
   * fixture invented — is no longer counted as a check of anything, so
   * `insights.verificationEvents` reads claims rather than clicks. No
   * SCORE component moved for this sample: T3 still records one verified
   * claim and one challenged claim.
   */
  it("derives the same report values it did before @ailx/report existed", () => {
    expect(sha256Hex(canonicalJson(derivedReport()))).toBe("4a11cde467f4107a38eea6e241c6c63d60b4d96e52ae8db11973a08965c168dc");
  });

  it("is stable across repeated derivation", () => {
    expect(canonicalJson(derivedReport())).toBe(canonicalJson(derivedReport()));
  });
});
