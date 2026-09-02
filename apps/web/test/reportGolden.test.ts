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
import { scoreTrack, trackScoredEntry } from "../lib/registry";
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
    log = append(log, trackScoredEntry(t, rec, ts));
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
   *
   * It MOVED a third time when the released-practice tier stopped symlinking
   * its rubrics into the operational instrument. That instrument is not in
   * this repository any more, and dereferencing the links would have copied
   * the judge prompts and the rubric marking detail into the public tree. The
   * public rubric.yaml files are therefore REDACTED copies — a different
   * document, so `rubricVersion = hash(rubric.yaml + prompts)` addresses
   * different bytes (instruments/demo-2026.1/README.md "Why the rubricVersion
   * values moved").
   *
   * It is MOVING through the 2026.1 track restructure, once per track, and
   * each move is a deliberate re-weighting recorded in its own commit: T1 to
   * 160 points with the prompt log scored, T2 to 80 with the criterion scored
   * and the d′ floor spike removed, T3 to 160 as calibrated reliance, T4 to an
   * unscored showcase. Every track raw, the composite, the percentile, the
   * band and both export tiers move with them, which is the point — the
   * digest exists so that a re-weighting cannot land quietly.
   *
   * EXACTLY EIGHT leaves of this object changed, and all eight are a
   * `rubricVersion` string: four in `research.trackVersions[]` and four in
   * `participant.tracks[]`. No composite, no track raw, no insight, no
   * narrative, no player type, no calibration bin and no export field moved —
   * the derivation was diffed leaf by leaf against the previous snapshot to
   * establish that before this line was touched. Byte-identical
   * recomputability of any score of record is untouched for the same reason:
   * scores of record are cut against the OPERATIONAL instrument, whose
   * rubric.yaml and prompts did not change (its four versions are still
   * 572c74c9…, 4bb83e18…, c223b246…, 0b6fe323…), and this tier issues none.
   *
   * It MOVED a fifth time when stored judgment rows gained a canonical order.
   * A score of record now records the CONTENT ADDRESS of every judgment it
   * consumed, and rows go into the log sorted rather than in the order the
   * judge happened to emit them (packages/core judgments.ts,
   * packages/session/test/recomputability.test.ts). EXACTLY 72 leaves of this
   * object changed and every one of them is inside a `judgments[]` array —
   * 36 under `participant.tracks[]`, 36 under `research.scores[]`, all of
   * them T1 and T4, whose demo juries emit dimension-by-dimension in a
   * different order from the canonical one. T3's rows were already canonical.
   * The multiset of rows per track is byte-identical before and after; only
   * the position of each row moved, which was established by diffing the
   * whole derivation leaf by leaf against a worktree at the previous commit
   * before this digest was touched. No composite, no track raw, no insight,
   * no narrative, no player type, no calibration bin and no export field
   * moved — and no SCORE moved, which is the load-bearing half: the
   * aggregation these rows feed is order-invariant by construction now, so
   * re-ordering the evidence must not, and did not, change the number.
   */
  it("derives the same report values it did before @ailx/report existed", () => {
    expect(sha256Hex(canonicalJson(derivedReport()))).toBe("073bc1592b708918a26e0dc8f2739fd655f0284b23de666eac5e0243ec1e2e3a");
  });

  it("is stable across repeated derivation", () => {
    expect(canonicalJson(derivedReport())).toBe(canonicalJson(derivedReport()));
  });
});
