import { describe, expect, it } from "vitest";
import { project, TRACK_IDS } from "@ailx/session";
import { candidateComposite } from "../lib/composite";
import { demoScoreArtifact, demoModelManifest, demoRubricVersion, DEMO_SCORING_DIGEST } from "../lib/demo";
import { participantExport, researchExport } from "../lib/exportTiers";
import { buildSampleAttemptLog } from "../lib/sampleAttempt";
import { append } from "@ailx/session";

function scoredLog() {
  let log = buildSampleAttemptLog();
  const state = project(log);
  let ts = log[log.length - 1].ts;
  for (const t of TRACK_IDS) {
    ts += 1000;
    log = append(log, {
      type: "track_scored", trackId: t,
      score: demoScoreArtifact(t, state.tracks[t].artifact),
      rubricVersion: demoRubricVersion(t),
      scoringDigest: DEMO_SCORING_DIGEST,
      modelManifest: demoModelManifest(t),
      ts,
    });
  }
  return append(log, { type: "attempt_completed", ts: ts + 1000 });
}

describe("export tiers (spec §16 shapes)", () => {
  const log = scoredLog();
  const state = project(log);
  const summary = candidateComposite(state)!;

  it("individual tier carries scores, composite, percentile, band and diagnostics", () => {
    const x = participantExport(state, summary);
    expect(x.tier).toBe("individual");
    expect(x.tracks).toHaveLength(4);
    expect(x.tracks[0].rubricVersion).toHaveLength(64);
    expect(x.composite.band).toBe(summary.band);
    expect(x.processDiagnostics).toHaveLength(4);
    expect(x.demo).toBe(true);
  });

  it("research tier is de-identified and event-complete", () => {
    const x = researchExport(state, log, summary);
    expect(x.pid).toMatch(/^pid-[0-9a-f]{16}$/);
    expect(JSON.stringify(x)).not.toContain(state.attemptId!.slice(4)); // pid is hashed, attemptId absent
    expect(x.statements.length).toBe(log.filter((e) => e.type === "track_event").length);
    expect(x.statements[0].tRelMs).toBeGreaterThanOrEqual(0);
    expect(x.trackVersions.every((tv) => tv.scoringDigest === DEMO_SCORING_DIGEST)).toBe(true);
    expect(x.sessionLog[0].ts).toBe(0);
  });

  it("is reproducible: same log, same export bytes", () => {
    expect(JSON.stringify(researchExport(state, log, summary)))
      .toBe(JSON.stringify(researchExport(state, log, summary)));
  });
});
