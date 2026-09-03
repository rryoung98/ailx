/**
 * Bundled sample attempt fixture — a complete, deterministic four-track
 * session log used by the /validate page to exercise the entire scoring
 * path (machine → REAL plugin scorers → composite) with fixed timestamps.
 * Artifacts carry each track's REAL shape so plugin.score() runs on them.
 */

import {
  append,
  type SequencedEntry, type SessionConfig, type TrackId,
} from "@ailx/session";
import { t2Items } from "./instrument";

const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z — fixed, never Date.now()

const CFG: SessionConfig = {
  instrument: "ailx",
  version: "2026.1",
  locale: "en",
  budgets: { t1: 600, t2: 300, t3: 600, t4: 480 },
  demo: true,
};

const VERBS: Record<TrackId, string[]> = {
  t1: ["prompted", "revised", "prompted", "revised", "verified"],
  t2: ["prompted", "verified"],
  t3: ["prompted", "assisted", "challenged", "verified", "prompted", "accepted"],
  t4: ["prompted", "regenerated", "revised", "verified"],
};

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * T3 stance and verification events name the CLAIM they act on, exactly as
 * the runner emits them. Both the scorer and the report count claims, never
 * clicks (F5), so a fixture with anonymous objects would describe behaviour
 * the product no longer records.
 */
const T3_CLAIM_VERBS = new Set(["challenged", "accepted", "verified"]);

function eventObject(trackId: TrackId, verb: string): string {
  return trackId === "t3" && T3_CLAIM_VERBS.has(verb) ? "claim:ca-cluster" : `${trackId}:${verb}`;
}

/**
 * REAL per-track artifact shapes, deterministic content. Exported because the
 * e2e fixtures seed mid-run logs with the same artifacts: a second private
 * copy of "what a completed T3 looks like" would drift from this one.
 */
export function fixtureArtifact(trackId: TrackId): unknown {
  switch (trackId) {
    case "t1":
      return {
        html:
          "<html><head><style>body{font:16px/1.5 serif;color:#123}</style></head>" +
          "<body><header><h1>Avery Chen</h1></header><main><section><p>I build measurement tools. " +
          "Contact: avery@example.org</p></section></main></body></html>",
        promptLog: [
          { kind: "prompted", prompt: "draft a single-column personal site", clientTs: iso(T0 + 30_000) },
          { kind: "revised", clientTs: iso(T0 + 60_000) },
          { kind: "prompted", prompt: "raise the contrast on body text", clientTs: iso(T0 + 90_000) },
          { kind: "revised", clientTs: iso(T0 + 120_000) },
        ],
        selfReport:
          "Single-column layout, high-contrast type, one flourish kept purposeful. " +
          "Iterated the hero twice after checking rendering at three viewports.",
      };
    case "t2": {
      const items = t2Items("en");
      return {
        responses: items.map((i, idx) => ({
          itemId: i.id,
          // Mostly right, two deliberate misses — a realistic partial run.
          choice: idx % 5 === 3 ? (i.key + 1) % i.options.length : i.key,
          confidence: idx % 5 === 3 ? 80 : 60,
          latencyMs: 1200 + idx * 100,
        })),
      };
    }
    case "t3":
      return {
        transcript: [
          { seq: 0, verb: "prompted", object: "prompt:1", text: "Summarise the memorandum position.", clientTs: iso(T0) },
          { seq: 1, verb: "assisted", object: "assist:1", claimIds: ["pe-figure", "ca-cluster"], clientTs: iso(T0 + 1000) },
          { seq: 2, verb: "challenged", object: "claim:pe-figure", clientTs: iso(T0 + 2000) },
          { seq: 3, verb: "verified", object: "claim:ca-cluster", claimIds: ["ca-cluster"], clientTs: iso(T0 + 3000) },
          { seq: 4, verb: "prompted", object: "prompt:2", text: "What about small employers?", clientTs: iso(T0 + 4000) },
          { seq: 5, verb: "accepted", object: "claim:ca-cluster", clientTs: iso(T0 + 5000) },
        ],
        finalAnswer:
          ("The delegation should adopt the shared certification track with a small-employer fee cap. " +
            "The memorandum's 41% processing-time reduction and the fall in withdrawal rates justify the reform, " +
            "while Section 5.3's regressive cost effect is offset by the cap. ").repeat(3),
      };
    case "t4":
      return {
        drafts: [
          { index: 0, prompt: "warm dawn palette poster", svg: "<svg/>", clientTs: iso(T0) },
          { index: 1, prompt: "warm dawn palette poster, single focal figure, wide margin composition", svg: "<svg/>", clientTs: iso(T0 + 1000) },
          { index: 2, prompt: "same composition, stronger typographic hierarchy for the headline", svg: "<svg/>", clientTs: iso(T0 + 2000) },
        ],
        finals: {
          images: [
            { kind: "image", fromDraftIndex: 2, prompt: "same composition, stronger typographic hierarchy for the headline", asset: "<svg/>", clientTs: iso(T0 + 3000) },
          ],
        },
        chosenSet: [0],
        disclosed: true,
        note:
          "Two generations spent on composition, one on hierarchy; the chosen frame keeps the " +
          "focal figure the viewer should read first. Disclosure statement attached to every delivered asset.",
      };
  }
}

export function buildSampleAttemptLog(): SequencedEntry[] {
  let log = append([], { type: "attempt_started", attemptId: "att-fixture-0001", config: CFG, ts: T0 });
  let t = T0;
  for (const trackId of ["t1", "t2", "t3", "t4"] as const) {
    t += 5_000;
    log = append(log, { type: "track_started", trackId, ts: t });
    for (const verb of VERBS[trackId]) {
      t += 30_000;
      log = append(log, {
        type: "track_event", trackId,
        event: { verb, object: eventObject(trackId, verb), context: { demo: true }, clientTs: new Date(t).toISOString() },
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
      artifact: fixtureArtifact(trackId),
    });
  }
  return log;
}
