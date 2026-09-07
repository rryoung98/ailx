/**
 * A PARTIAL SITTING, DOWNSTREAM (TEN-149).
 *
 * A candidate with no model connected sits the model-free tracks and stops
 * there. Everything after the run must say so: the composite is withheld
 * rather than renormalised over a subset, the credential is NAMED a partial
 * sitting, and no four-letter player type is minted from axes that were
 * never read (docs/ADR-profile-and-type.md §6.2).
 */
import { describe, expect, it } from "vitest";
import {
  append, project,
  type SequencedEntry, type SessionConfig, type TrackId, type TrackRawScores,
} from "@ailx/session";
import {
  attemptedTrackCodes, buildCredentialClaim, candidateComposite, credentialName,
  CREDENTIAL_ASSERTS, isFullSitting, NO_PLAYER_TYPE,
} from "../src/index.js";

const CFG: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 }, demo: true,
};
const T0 = 1_760_000_000_000;

/** A finished run that sat `done` and nothing else. */
function sitting(done: readonly TrackId[]) {
  let ts = T0;
  let log: SequencedEntry[] = append([], { type: "attempt_started", attemptId: "att-partial", config: CFG, ts });
  for (const t of done) {
    ts += 1000;
    log = append(log, { type: "track_started", trackId: t, ts });
    ts += 1000;
    log = append(log, { type: "track_completed", trackId: t, artifact: { t }, timedOut: false, ts });
  }
  log = append(log, { type: "attempt_completed", ts: ts + 1000 });
  return project(log);
}

/** Numbers a caller might have for all four tracks even on a partial sitting. */
const RAW: TrackRawScores = { t1: 55, t2: 60, t3: 58, t4: 52 };

describe("the composite", () => {
  it("is withheld, not renormalised, when a track was never sat", () => {
    expect(candidateComposite(sitting(["t2", "t3"]))).toBeNull();
  });
});

describe("the credential", () => {
  it("lists only the tracks that were sat", () => {
    expect(attemptedTrackCodes(sitting(["t2", "t3"]))).toEqual(["T2", "T3"]);
  });

  it("cannot present a two-track sitting as a full one", () => {
    const claim = buildCredentialClaim(sitting(["t2", "t3"]), RAW)!;
    expect(claim).not.toBeNull();
    expect(claim.tracksAttempted).toEqual(["T2", "T3"]);
    // The NAME is the field that travels furthest with no page around it.
    expect(credentialName(claim.instrumentVersion, claim.tracksAttempted)).toBe(
      "Foray 2026.1 — Partial Sitting (T2, T3)",
    );
    expect(isFullSitting(claim.tracksAttempted)).toBe(false);
  });

  it("mints no player type from axes that were never read", () => {
    const claim = buildCredentialClaim(sitting(["t2", "t3"]), RAW)!;
    expect(claim.playerType).toEqual(NO_PLAYER_TYPE);
    expect(claim.playerType.code).toBe("");
    expect(claim.playerType.name).toBe("");
  });

  it("is unchanged for a full sitting: the name and a four-letter code", () => {
    const claim = buildCredentialClaim(sitting(["t1", "t2", "t3", "t4"]), RAW)!;
    expect(isFullSitting(claim.tracksAttempted)).toBe(true);
    expect(credentialName(claim.instrumentVersion, claim.tracksAttempted)).toBe(
      "Foray 2026.1 — Sitting Completed",
    );
    expect(claim.playerType.code).toHaveLength(4);
    expect(claim.playerType.name.length).toBeGreaterThan(0);
  });

  it("asserts completion of the tracks LISTED, never of the instrument", () => {
    expect(CREDENTIAL_ASSERTS[0]).toContain("completed the tracks listed");
    expect(CREDENTIAL_ASSERTS.join(" ")).toContain("partial sitting");
  });
});
