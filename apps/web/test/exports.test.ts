import { describe, expect, it } from "vitest";
import { append, project, TRACK_IDS } from "@ailx/session";
import {
  candidateComposite, participantExport, researchExport,
} from "@ailx/report";
import { scoreTrack, trackScoredEntry } from "../lib/instrument/registry";
import { buildSampleAttemptLog } from "../lib/instrument/sampleAttempt";

function scoredLog() {
  let log = buildSampleAttemptLog();
  const state = project(log);
  let ts = log[log.length - 1].ts;
  for (const t of TRACK_IDS) {
    ts += 1000;
    const rec = scoreTrack(t, state.tracks[t].artifact);
    log = append(log, trackScoredEntry(t, rec, ts));
  }
  return append(log, { type: "attempt_completed", ts: ts + 1000 });
}

describe("export tiers (spec §16 shapes)", () => {
  const log = scoredLog();
  const state = project(log);
  const summary = candidateComposite(state)!;

  it("individual tier carries scores, composite, band, diagnostics AND the candidate's own artifacts, labelled", () => {
    const x = participantExport(state, summary);
    expect(x.tier).toBe("individual");
    expect(x.label).toContain("NOT de-identified");
    expect(x.tracks).toHaveLength(4);
    expect(x.tracks[0].rubricVersion).toHaveLength(64);
    expect(x.tracks[0].artifact).not.toBeNull(); // own data stays
    expect(x.composite.band).toBe(summary.band);
    expect(x.processDiagnostics).toHaveLength(4);
    expect(x.demo).toBe(true);
  });

  it("research tier is de-identified and follows the allowlist schema", () => {
    const x = researchExport(state, log, summary);
    expect(x.schema).toBe("ailx.research.v2");
    expect(x.pid).toMatch(/^pid-[0-9a-f]{16}$/);
    expect(JSON.stringify(x)).not.toContain(state.attemptId!.slice(4)); // pid is hashed, attemptId absent
    expect(x.statements.length).toBe(log.filter((e) => e.type === "track_event").length);
    expect(x.statements[0].tRelMs).toBeGreaterThanOrEqual(0);
    expect(x.statements[0].verb).toBeTruthy();
    expect(x.trackVersions.every((tv) => (tv.scoringDigest ?? "").length === 64)).toBe(true);
    // judgments + subscores are present for reproduction
    expect(x.scores.every((s) => Array.isArray(s.judgments))).toBe(true);
    // T2 responses (item ids + structured responses) are allowlisted in
    expect(x.t2Responses.length).toBeGreaterThan(0);
    expect(x.t2Responses[0].itemId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("research tier contains NO raw artifacts, free text, html, transcripts, or notes (F15)", () => {
    const x = researchExport(state, log, summary);
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v !== null && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) { keys.add(k); walk(val); }
      }
    };
    walk(x);
    for (const banned of ["html", "finalAnswer", "note", "selfReport", "transcript",
      "promptLog", "generations", "artifact", "sessionLog", "object", "result",
      "context", "text", "evidence", "prompt", "svg"]) {
      expect(keys.has(banned), `research export leaks key "${banned}"`).toBe(false);
    }
    // The fixture's artifacts contain these strings — none may survive.
    const json = JSON.stringify(x);
    expect(json).not.toContain("Avery Chen");                    // t1 html
    expect(json).not.toContain("shared certification track");    // t3 finalAnswer
    expect(json).not.toContain("warm dawn palette");             // t4 prompts
  });

  it("is reproducible: same log, same export bytes", () => {
    expect(JSON.stringify(researchExport(state, log, summary)))
      .toBe(JSON.stringify(researchExport(state, log, summary)));
  });
});

describe("audit hardening: eventCounts + per-track latency anchors", () => {
  const log = scoredLog();
  const state = project(log);
  const summary = candidateComposite(state)!;
  const x = researchExport(state, log, summary);

  it("eventCounts tally EVERY persisted track_event, by verb, per track", () => {
    expect(x.eventCounts).toHaveLength(4);
    for (const ec of x.eventCounts) {
      const expected = log.filter((e) => e.type === "track_event" && e.trackId === ec.trackId);
      expect(ec.total).toBe(expected.length);
      const verbSum = Object.values(ec.byVerb).reduce((a, b) => a + b, 0);
      expect(verbSum).toBe(ec.total);
    }
    // Fixture sanity: T3 records 6 events incl. 1 challenged + 1 verified.
    const t3 = x.eventCounts.find((e) => e.trackId === "t3")!;
    expect(t3.total).toBe(6);
    expect(t3.byVerb.challenged).toBe(1);
    expect(t3.byVerb.verified).toBe(1);
  });

  it("statements latencyMs never spans a track boundary (per-track anchor)", () => {
    const seenTracks = new Set<string>();
    for (const s of x.statements) {
      if (!seenTracks.has(s.trackId)) {
        // First event of each track: no previous same-track anchor.
        expect(s.latencyMs).toBeNull();
        seenTracks.add(s.trackId);
      } else {
        // Fixture emits same-track events exactly 30 s apart.
        expect(s.latencyMs).toBe(30_000);
      }
    }
    expect(seenTracks.size).toBe(4);
  });
});
