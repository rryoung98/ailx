/**
 * Player-profile (MBTI-style) regression tests: the profile is a pure,
 * deterministic function of the scored session, its letters agree with its
 * axes, and it is absent until T2 carries a valid score.
 */
import { describe, expect, it } from "vitest";
import { append, project, type SequencedEntry, type TrackId } from "@ailx/session";
import { buildSampleAttemptLog } from "../lib/sampleAttempt";
import { scoreTrack } from "../lib/registry";
import { trackInsights } from "../lib/insights";
import { ARCHETYPES, playerProfile } from "../lib/personality";

function scoredLog(): SequencedEntry[] {
  let log = buildSampleAttemptLog();
  let t = log[log.length - 1].ts;
  for (const c of log.filter(
    (e): e is Extract<SequencedEntry, { type: "track_completed" }> => e.type === "track_completed",
  )) {
    t += 1_000;
    const rec = scoreTrack(c.trackId as TrackId, c.artifact);
    log = append(log, {
      type: "track_scored", trackId: c.trackId, score: rec.score,
      judgments: rec.judgments, rubricVersion: rec.rubricVersion,
      scoringDigest: rec.scoringDigest, modelManifest: rec.modelManifest, ts: t,
    });
  }
  return log;
}

describe("player profile (MBTI-style, presentation only)", () => {
  it("is deterministic and internally consistent on the sample attempt", () => {
    const state = project(scoredLog());
    const insights = trackInsights(state);
    const p1 = playerProfile(state, insights);
    const p2 = playerProfile(state, insights);
    expect(p1).toEqual(p2);
    expect(p1).not.toBeNull();
    const p = p1!;
    expect(p.code).toMatch(/^[KT][CB][VA][IO]$/);
    expect(p.code).toBe(p.axes.map((a) => a.letter).join(""));
    expect(Object.keys(ARCHETYPES)).toContain(p.code);
    expect(p.archetype).toBe(ARCHETYPES[p.code]);
    expect(p.axes).toHaveLength(4);
    for (const a of p.axes) {
      expect(a.value).toBeGreaterThanOrEqual(0);
      expect(a.value).toBeLessThanOrEqual(1);
      expect(a.strength).toBeGreaterThanOrEqual(50);
      expect(a.strength).toBeLessThanOrEqual(100);
      expect(a.poles).toContain(a.pole);
      expect(a.letters).toContain(a.letter);
      expect(a.basis.length).toBeGreaterThan(0);
    }
  });

  it("covers all 16 codes with a named archetype", () => {
    expect(Object.keys(ARCHETYPES)).toHaveLength(16);
    for (const a of ["K", "T"]) for (const b of ["C", "B"]) for (const c of ["V", "A"]) for (const d of ["I", "O"]) {
      expect(ARCHETYPES[`${a}${b}${c}${d}`]).toBeTruthy();
    }
  });

  it("weak evidence pulls axes toward the midpoint instead of an extreme", () => {
    const state = {
      tracks: {
        t2: { score: { raw: { dPrime: 0, brier: 0, answeredBinary: 1, nSignal: 2, nNoise: 2, sensitivity: 0 } } },
      },
    } as never;
    const p = playerProfile(state, [])!;
    // Brier 0 from a single answered item of four must NOT read as fully
    // Calibrated: value = 0.5 + 0.5 * (1/4) = 0.625.
    const cal = p.axes.find((a) => a.key === "calibration")!;
    expect(cal.pole).toBe("Calibrated");
    expect(cal.strength).toBeLessThanOrEqual(63);
    // No prompting recorded is no evidence — midpoint, never "100% One-shot".
    const making = p.axes.find((a) => a.key === "making")!;
    expect(making.strength).toBe(50);
  });

  it("returns null before T2 is scored", () => {
    const state = project(buildSampleAttemptLog()); // completed but unscored
    expect(playerProfile(state, trackInsights(state))).toBeNull();
  });
});
