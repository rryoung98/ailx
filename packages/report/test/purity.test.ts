/**
 * Purity harness for every derivation in @ailx/report (FRONTEND.md §2.1/§2.2).
 *
 * These functions decide scores, report figures and audit-export fields, so
 * they must run where fetch, Date.now and Math.random throw. This is the gate
 * that was structurally impossible while the code lived in apps/web.
 */
import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import {
  initialState, TRACK_IDS, type SequencedEntry, type SessionState,
} from "@ailx/session";
import {
  calibrationBins, candidateComposite, cohortMedians, demoRubricVersion,
  judgeT1, judgeT3, judgeT4, narratives, participantExport, playerProfile,
  playerType, researchExport, t2ResponsesFromArtifact, trackInsights,
  buildSharePayload,
} from "../src/index.js";

/** A fully scored synthetic attempt — no app, no storage, no clock. */
function scoredState(): SessionState {
  const s = initialState();
  s.attemptId = "attempt-fixture";
  s.phase = "completed";
  s.config = {
    instrument: "ailx", version: "2026.1", locale: "en", demo: true,
    budgets: { t1: 600, t2: 300, t3: 600, t4: 480 },
  };
  TRACK_IDS.forEach((t, i) => {
    s.tracks[t] = {
      trackId: t,
      status: "completed",
      activeMs: (i + 1) * 60_000,
      events: [
        { verb: "prompted", object: "p1", clientTs: "2026-01-01T00:00:00.000Z" },
        { verb: "revised", object: "p1", clientTs: "2026-01-01T00:01:00.000Z" },
        { verb: "challenged", object: "claim-1", clientTs: "2026-01-01T00:02:00.000Z" },
        { verb: "challenged", object: "claim-1", clientTs: "2026-01-01T00:03:00.000Z" },
        { verb: "verified", object: "src-1", clientTs: "2026-01-01T00:04:00.000Z" },
      ],
      artifact: { responses: [{ itemId: "i1", choice: 1, confidence: 80, latencyMs: 900 }] },
      score: {
        raw: t === "t2"
          ? { dPrime: 1.4, brier: 0.14, answeredBinary: 4, nSignal: 3, nNoise: 3, sensitivity: 42 }
          : { component: 1 },
        scaled: 50 + i * 5,
      },
      rubricVersion: `rv-${t}`,
      scoringDigest: `sd-${t}`,
      modelManifest: { screening: "demo-judge@1" },
      judgments: [{ dimension: "d", sample: 0, value: 0.5, evidence: "e", modelId: "m@1" }],
    };
  });
  return s;
}

const LOG: SequencedEntry[] = [
  { seq: 0, type: "attempt_started", attemptId: "attempt-fixture", ts: 1_767_225_600_000 } as SequencedEntry,
  {
    seq: 1, type: "track_event", trackId: "t1", ts: 1_767_225_601_000,
    event: { verb: "prompted", object: "p1", clientTs: "2026-01-01T00:00:01.000Z" },
  } as SequencedEntry,
  {
    seq: 2, type: "track_event", trackId: "t1", ts: 1_767_225_602_000,
    event: { verb: "revised", object: "p1", clientTs: "2026-01-01T00:00:02.000Z" },
  } as SequencedEntry,
];

describe("@ailx/report purity", () => {
  const state = scoredState();

  it("runs every derivation with fetch/Date.now/Math.random trapped", () => {
    const out = runPure(() => {
      const insights = trackInsights(state);
      const composite = candidateComposite(state);
      if (!composite) throw new Error("composite must derive from a fully scored state");
      return {
        insights,
        narratives: narratives(insights),
        composite,
        medians: cohortMedians(),
        playerType: playerType(composite.trackRaw),
        share: buildSharePayload(state, { site: "/api/site/abc/index.html" }),
        profile: playerProfile(state, insights),
        participant: participantExport(state, composite),
        research: researchExport(state, LOG, composite),
        rubricVersions: TRACK_IDS.map((t) => demoRubricVersion(t)),
        calibration: calibrationBins(
          t2ResponsesFromArtifact(state.tracks.t2.artifact), { i1: 1 },
        ),
        judgments: [
          judgeT1({ html: "<main><h1>x</h1></main>", promptLog: [], selfReport: "why" }),
          judgeT3({ transcript: [], finalAnswer: "an analysis" }),
          judgeT4({
            drafts: [{ prompt: "a bold poster" }],
            finals: { images: [{ prompt: "a bold poster" }] },
            chosenSet: [0], note: "note", disclosed: true,
          }),
        ],
      };
    });
    expect(out.composite.cohortSize).toBe(45);
    expect(out.share?.site).toBe("/api/site/abc/index.html");
    expect(out.profile).not.toBeNull();
    expect(out.research.schema).toBe("ailx.research.v2");
  });

  it("traps an impure derivation, proving the harness is live", () => {
    expect(() => runPure(() => Math.random())).toThrow(/Purity violation/);
  });

  it("is deterministic — two runs are byte-identical", () => {
    const once = JSON.stringify(runPure(() => candidateComposite(scoredState())));
    const twice = JSON.stringify(runPure(() => candidateComposite(scoredState())));
    expect(twice).toBe(once);
  });
});
