/**
 * Bundled sample attempt fixture — a complete, deterministic four-track
 * session log used by the /validate page to exercise the entire scoring
 * path (machine → demo scorers → composite) with fixed timestamps.
 */

import {
  append,
  type SequencedEntry, type SessionConfig, type TrackId,
} from "@ailx/session";

const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z — fixed, never Date.now()

const CFG: SessionConfig = {
  instrument: "ailx",
  version: "2026.1",
  locale: "en",
  budgets: { t1: 600, t2: 480, t3: 600, t4: 480 },
  demo: true,
};

const SCRIPT: Record<TrackId, { verbs: string[]; response: string }> = {
  t1: {
    verbs: ["prompted", "revised", "prompted", "revised", "verified"],
    response:
      "Single-column layout, high-contrast type, one WebGL flourish kept purposeful. Iterated the hero twice after checking rendering at three viewports.",
  },
  t2: {
    verbs: ["prompted", "verified"],
    response: "Leaned on provenance signals over surface artefacts; flagged low confidence where exposure was too short.",
  },
  t3: {
    verbs: ["prompted", "revised", "verified", "prompted", "revised", "verified"],
    response:
      "The assistant's third output contradicted the primary table; recomputed by hand and rejected it, kept the two suggestions that survived verification.",
  },
  t4: {
    verbs: ["prompted", "regenerated", "revised", "verified"],
    response: "Two generations spent on composition, one on grade; disclosure statement attached to every delivered asset.",
  },
};

export function buildSampleAttemptLog(): SequencedEntry[] {
  let log = append([], { type: "attempt_started", attemptId: "att-fixture-0001", config: CFG, ts: T0 });
  let t = T0;
  for (const trackId of ["t1", "t2", "t3", "t4"] as const) {
    t += 5_000;
    log = append(log, { type: "track_started", trackId, ts: t });
    const s = SCRIPT[trackId];
    for (const verb of s.verbs) {
      t += 30_000;
      log = append(log, {
        type: "track_event", trackId,
        event: { verb, object: `${trackId}:${verb}`, context: { demo: true }, clientTs: new Date(t).toISOString() },
        ts: t,
      });
    }
    // one pause/resume inside T3 to exercise the clock accounting
    if (trackId === "t3") {
      t += 10_000;
      log = append(log, { type: "paused", ts: t });
      t += 120_000;
      log = append(log, { type: "resumed", ts: t });
    }
    t += 20_000;
    log = append(log, {
      type: "track_completed", trackId, timedOut: false, ts: t,
      artifact: { demo: true, trackId, response: s.response, interactions: s.verbs },
    });
  }
  return log;
}
