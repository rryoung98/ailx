/**
 * Reconciliation — audit-grade drift detection.
 *
 * A scripted full attempt (deterministic fixture) must produce IDENTICAL
 * numbers three independent ways:
 *   (a) LIVE     — scoreTrack() at completion time (what the exam page runs);
 *   (b) REPLAY   — recomputed from the PERSISTED log alone after a
 *                  save→load round-trip: both the full pipeline (artifact →
 *                  judge → score) and the stored-judgment path
 *                  (artifact + persisted judgment rows → plugin.score());
 *   (c) EXPORT   — the numbers in the research-tier JSON.
 * Any drift between the three fails CI byte-exactly (JSON.stringify equality).
 */
import { describe, expect, it } from "vitest";
import {
  append, ATTEMPT_KEY, loadAttempt, loadAttemptValidated, project, saveAttempt,
  TRACK_IDS, type SequencedEntry, type StorageLike,
} from "@ailx/session";
import { t1Plugin } from "@ailx/track-t1";
import { plugin as t2Plugin, validateT2Config } from "@ailx/track-t2";
import { plugin as t3Plugin, validateT3Config } from "@ailx/track-t3";
import { t4Plugin } from "@ailx/track-t4";
import { candidateComposite } from "../lib/composite";
import { researchExport } from "../lib/exportTiers";
import { trackConfig } from "../lib/instrument";
import { scoreTrack, type TrackScoringRecord } from "../lib/registry";
import { buildSampleAttemptLog } from "../lib/sampleAttempt";

function memStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
void ATTEMPT_KEY;

/** Run the fixture attempt exactly the way the exam page does. */
function runLiveAttempt(): { log: SequencedEntry[]; live: Record<string, TrackScoringRecord> } {
  let log = buildSampleAttemptLog();
  const state = project(log);
  const live: Record<string, TrackScoringRecord> = {};
  let ts = log[log.length - 1].ts;
  for (const t of TRACK_IDS) {
    ts += 1000;
    const rec = scoreTrack(t, state.tracks[t].artifact);
    live[t] = rec;
    log = append(log, {
      type: "track_scored", trackId: t,
      score: rec.score, judgments: rec.judgments,
      rubricVersion: rec.rubricVersion, scoringDigest: rec.scoringDigest,
      modelManifest: rec.modelManifest, ts,
    });
  }
  log = append(log, { type: "attempt_completed", ts: ts + 1000 });
  return { log, live };
}

/** plugin.score() from PERSISTED judgment rows only — no re-judging. */
function scoreFromStoredJudgments(t: (typeof TRACK_IDS)[number], state: ReturnType<typeof project>) {
  const ts = state.tracks[t];
  const artifact = ts.artifact as never;
  const judgments = (ts.judgments ?? []) as never;
  const rubricVersion = ts.rubricVersion!;
  switch (t) {
    case "t1":
      return t1Plugin.score({ artifact, judgments, rubricVersion }, t1Plugin.validateConfig(trackConfig("t1")));
    case "t2":
      return t2Plugin.score({ artifact, judgments, rubricVersion }, validateT2Config(trackConfig("t2")));
    case "t3":
      return t3Plugin.score({ artifact, judgments, rubricVersion }, validateT3Config(trackConfig("t3")));
    case "t4":
      return t4Plugin.score({ artifact, judgments, rubricVersion }, t4Plugin.validateConfig(trackConfig("t4")));
  }
}

describe("reconciliation: live score ≡ replay from persisted log ≡ research export", () => {
  const { log: liveLog, live } = runLiveAttempt();

  // Persist through the REAL storage codec, then reload + validate.
  const storage = memStorage();
  saveAttempt(storage, liveLog);
  const reloaded = loadAttempt(storage)!;
  const state = project(reloaded);
  const summary = candidateComposite(state)!;
  const exported = researchExport(state, reloaded, summary);

  it("persistence round-trip loses nothing (byte-exact log, zero drops)", () => {
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(liveLog));
    expect(loadAttemptValidated(storage)!.dropped).toBe(0);
  });

  it("(a)≡(b1): full-pipeline replay from the persisted artifact matches the live score byte-exactly", () => {
    for (const t of TRACK_IDS) {
      const replay = scoreTrack(t, state.tracks[t].artifact);
      expect(JSON.stringify(replay.score), `track ${t} pipeline replay drift`)
        .toBe(JSON.stringify(live[t].score));
      expect(JSON.stringify(replay.judgments), `track ${t} judgment drift`)
        .toBe(JSON.stringify(live[t].judgments));
      expect(replay.scoringDigest).toBe(live[t].scoringDigest);
    }
  });

  it("(a)≡(b2): plugin.score() over PERSISTED judgment rows alone matches the live score byte-exactly", () => {
    for (const t of TRACK_IDS) {
      const s = scoreFromStoredJudgments(t, state)!;
      expect(JSON.stringify({ raw: s.raw, scaled: s.scaled }), `track ${t} stored-judgment drift`)
        .toBe(JSON.stringify({ raw: live[t].score.raw, scaled: live[t].score.scaled }));
    }
  });

  it("(a)≡(c): the research export carries exactly the live numbers", () => {
    for (const t of TRACK_IDS) {
      const row = exported.scores.find((s) => s.trackId === t)!;
      expect(JSON.stringify(row.raw), `track ${t} export raw drift`)
        .toBe(JSON.stringify(live[t].score.raw));
      expect(row.scaled).toBe(live[t].score.scaled);
      expect(JSON.stringify(row.judgments)).toBe(JSON.stringify(
        live[t].judgments.map((j) => ({ dimension: j.dimension, sample: j.sample, value: j.value, modelId: j.modelId })),
      ));
    }
    // Composite in the export ≡ composite recomputed from the reloaded state.
    expect(JSON.stringify(exported.composite)).toBe(JSON.stringify(summary));
    const recomputed = candidateComposite(project(loadAttempt(storage)!))!;
    expect(JSON.stringify(recomputed)).toBe(JSON.stringify(summary));
  });

  it("no track scored the fail-closed sentinel (fixture artifacts are all valid)", () => {
    for (const t of TRACK_IDS) {
      expect(state.tracks[t].score!.raw.invalid).toBeUndefined();
    }
  });
});
