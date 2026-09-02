/**
 * The credential is a PUBLIC CLAIM, so it is tested the way the share payload
 * is: the stored claim as an exact object, the served document as an exact
 * key set, and a forbidden-substring check that fails the moment a score, a
 * band or an item ever reaches it.
 */
import { describe, expect, it } from "vitest";
import { initialState, TRACK_IDS, type SessionState, type TrackRawScores } from "@ailx/session";
import {
  CREDENTIAL_ASSERTS,
  CREDENTIAL_CLAIM_KEYS,
  CREDENTIAL_CLAIM_VERSION,
  CREDENTIAL_CODE_RE,
  CREDENTIAL_CONTEXT,
  CREDENTIAL_ISSUER,
  CREDENTIAL_LIMITS,
  attemptedTrackCodes,
  buildCredentialClaim,
  credentialApiPath,
  credentialDocument,
  credentialName,
  formatCredentialCode,
  linkedInAddUrl,
  linkedInCertification,
  parseCredentialClaim,
  verifyUrlPath,
  type CredentialState,
} from "../src/credential.js";
import { playerTypeFor } from "../src/playerType.js";

const ORIGIN = "https://ailx.example";
const shape = (v: number[]): TrackRawScores => ({ t1: v[0], t2: v[1], t3: v[2], t4: v[3] });
const RAW = shape([72.5, 40.25, 61, 58]);

function completedState(): SessionState {
  const s = initialState();
  s.attemptId = "attempt-fixture";
  s.phase = "completed";
  s.config = { instrument: "ailx", version: "2026.1", locale: "en", budgets: { t1: 600, t2: 300, t3: 600, t4: 480 } };
  s.lastTs = Date.parse("2026-02-03T11:00:00.000Z");
  for (const t of TRACK_IDS) {
    s.tracks[t] = {
      trackId: t,
      status: "completed",
      activeMs: 60_000,
      events: [{ verb: "prompted", object: "p1", clientTs: "2026-02-03T10:00:00.000Z" }],
      score: { raw: {}, scaled: 50 },
    };
  }
  return s;
}

const VALID: CredentialState = {
  code: "AILX-2026.1-AB12-CD34-EF56-GH78",
  status: "valid",
  issuedAt: "2026-02-04T09:30:00.000Z",
  revokedAt: null,
  revokeReason: null,
};

const REVOKED: CredentialState = {
  ...VALID,
  status: "revoked",
  revokedAt: "2026-03-01T00:00:00.000Z",
  revokeReason: "issued against a withdrawn sitting",
};

describe("credential code", () => {
  it("formats four readable groups from raw bytes, in the safe alphabet", () => {
    const bytes = new Uint8Array(16).map((_, i) => i);
    const code = formatCredentialCode("2026.1", bytes);
    expect(code).toMatch(CREDENTIAL_CODE_RE);
    expect(code.startsWith("AILX-2026.1-")).toBe(true);
    // The random body avoids I, L, O and U so it survives being read aloud.
    expect(code.slice("AILX-2026.1-".length)).not.toMatch(/[ILOU]/);
  });

  it("is deterministic in its bytes and ignores anything beyond what it needs", () => {
    const bytes = new Uint8Array(40).map((_, i) => (i * 7) % 251);
    expect(formatCredentialCode("2026.1", bytes)).toBe(
      formatCredentialCode("2026.1", bytes.slice(0, 16)),
    );
  });

  it("refuses to make a short code out of too little entropy", () => {
    expect(() => formatCredentialCode("2026.1", new Uint8Array(15))).toThrow(/16 bytes/);
  });

  it("rejects a code that is not ours", () => {
    for (const bad of [
      "",
      "AILX-2026.1-AB12-CD34-EF56",
      "AILX-2026.1-AB12-CD34-EF56-GH789",
      "AILX-2026.1-AB1I-CD34-EF56-GH78",
      "OTHER-2026.1-AB12-CD34-EF56-GH78",
      "AILX-2026.1-ab12-cd34-ef56-gh78",
      "AILX-2026.1-AB12-CD34-EF56-GH78 ",
    ]) {
      expect(CREDENTIAL_CODE_RE.test(bad), bad).toBe(false);
    }
    expect(CREDENTIAL_CODE_RE.test(VALID.code)).toBe(true);
  });

  it("spells its own URLs once", () => {
    expect(verifyUrlPath(VALID.code)).toBe(`/verify/${VALID.code}`);
    expect(verifyUrlPath(VALID.code, "/ailx")).toBe(`/ailx/verify/${VALID.code}`);
    expect(credentialApiPath(VALID.code)).toBe(`/api/credentials/${VALID.code}`);
    // A hostile code can never break out of the path it is put in.
    expect(verifyUrlPath("../../etc")).toBe("/verify/..%2F..%2Fetc");
  });
});

describe("buildCredentialClaim", () => {
  it("stores exactly the allowlisted claim fields, and no score", () => {
    const claim = buildCredentialClaim(completedState(), RAW, { artifact: "/api/site/abc/index.html" });
    expect(claim).toEqual({
      v: CREDENTIAL_CLAIM_VERSION,
      instrument: "ailx 2026.1",
      instrumentVersion: "2026.1",
      completedOn: "2026-02-03",
      tracksAttempted: ["T1", "T2", "T3", "T4"],
      playerType: (({ code, name }) => ({ code, name }))(playerTypeFor(completedState(), RAW)),
      artifact: "/api/site/abc/index.html",
      claims: ["sitting-completed"],
    });
    expect(Object.keys(claim!).sort()).toEqual([...CREDENTIAL_CLAIM_KEYS].sort());
  });

  it("defaults the artifact to null — an opt-in, never assumed", () => {
    expect(buildCredentialClaim(completedState(), RAW)!.artifact).toBeNull();
  });

  it("lists only the tracks the run actually reached", () => {
    const s = completedState();
    s.tracks.t3 = { trackId: "t3", status: "pending", activeMs: 0, events: [] };
    s.tracks.t4 = { trackId: "t4", status: "pending", activeMs: 0, events: [] };
    expect(attemptedTrackCodes(s)).toEqual(["T1", "T2"]);
    expect(buildCredentialClaim(s, RAW)!.tracksAttempted).toEqual(["T1", "T2"]);
  });

  it("issues nothing for a run that is not a sitting", () => {
    const empty = initialState();
    expect(buildCredentialClaim(empty, RAW)).toBeNull();          // no stamp, no tracks
    const noStamp = completedState();
    noStamp.lastTs = undefined;
    expect(buildCredentialClaim(noStamp, RAW)).toBeNull();
    const untouched = completedState();
    for (const t of TRACK_IDS) untouched.tracks[t] = { trackId: t, status: "pending", activeMs: 0, events: [] };
    untouched.lastTs = Date.parse("2026-02-03T11:00:00.000Z");
    expect(buildCredentialClaim(untouched, RAW)).toBeNull();
    expect(buildCredentialClaim(completedState(), null)).toBeNull(); // nothing scored
  });

  it("falls back to the current instrument version rather than inventing one", () => {
    const s = completedState();
    s.config = undefined;
    const claim = buildCredentialClaim(s, RAW)!;
    expect(claim.instrument).toBe("ailx 2026.1");
    expect(claim.instrumentVersion).toBe("2026.1");
  });
});

describe("parseCredentialClaim", () => {
  const claim = buildCredentialClaim(completedState(), RAW, { artifact: "/api/site/abc/index.html" })!;

  it("round-trips a stored row byte-for-byte", () => {
    expect(parseCredentialClaim(JSON.parse(JSON.stringify(claim)))).toEqual(claim);
  });

  it("drops fields a row is not allowed to carry", () => {
    const parsed = parseCredentialClaim({ ...claim, band: "Distinction", composite: 71.2 })!;
    expect(parsed).toEqual(claim);
  });

  it("reads an unreadable row as null instead of throwing", () => {
    for (const bad of [
      null,
      "a string",
      42,
      {},
      { ...claim, v: 99 },
      { ...claim, playerType: null },
      { ...claim, claims: [] },
      { ...claim, claims: ["invented"] },
      { ...claim, tracksAttempted: [] },
      { ...claim, tracksAttempted: ["T9"] },
      { ...claim, completedOn: "3 Feb 2026" },
    ]) {
      expect(parseCredentialClaim(bad)).toBeNull();
    }
  });

  it("keeps a future 'scored' claim, so the upgrade reads back", () => {
    const upgraded = parseCredentialClaim({ ...claim, claims: ["sitting-completed", "scored"] })!;
    expect(upgraded.claims).toEqual(["sitting-completed", "scored"]);
  });

  it("coerces a non-string artifact to null rather than serving it", () => {
    expect(parseCredentialClaim({ ...claim, artifact: { evil: true } })!.artifact).toBeNull();
  });
});

describe("credentialDocument", () => {
  const claim = buildCredentialClaim(completedState(), RAW, { artifact: "/api/site/abc/index.html" })!;

  it("emits an Open Badges 3.0 shaped object with dereferenceable ids", () => {
    const doc = credentialDocument(claim, VALID, ORIGIN) as Record<string, any>;
    expect(doc["@context"]).toEqual([...CREDENTIAL_CONTEXT]);
    expect(doc.type).toEqual(["VerifiableCredential", "OpenBadgeCredential"]);
    expect(doc.id).toBe(`${ORIGIN}/verify/${VALID.code}`);
    expect(doc.issuer).toEqual({ id: ORIGIN, type: ["Profile"], name: CREDENTIAL_ISSUER });
    expect(doc.validFrom).toBe(VALID.issuedAt);
    expect(doc.name).toBe("AILX 2026.1 — Sitting Completed");
    expect(doc.credentialSubject.type).toEqual(["AchievementSubject"]);
    expect(doc.credentialSubject.ailx.artifact).toBe(`${ORIGIN}/api/site/abc/index.html`);
    expect(doc.credentialStatus).toEqual({
      id: `${ORIGIN}/api/credentials/${VALID.code}`,
      type: "AilxHostedStatus",
      status: "valid",
    });
  });

  it("says what it does NOT assert, inside the document itself", () => {
    const doc = credentialDocument(claim, VALID, ORIGIN) as Record<string, any>;
    expect(doc.credentialSubject.ailx.doesNotAssert).toEqual([...CREDENTIAL_LIMITS]);
    expect(doc.description).toBe(CREDENTIAL_ASSERTS.join(" "));
    expect(doc.credentialSubject.ailx.claims).toEqual(["sitting-completed"]);
  });

  it("shows revocation, with its date and reason — never a silent 404", () => {
    const doc = credentialDocument(claim, REVOKED, ORIGIN) as Record<string, any>;
    expect(doc.credentialStatus.status).toBe("revoked");
    expect(doc.credentialStatus.revokedAt).toBe(REVOKED.revokedAt);
    expect(doc.credentialStatus.revokeReason).toBe(REVOKED.revokeReason);
  });

  it("never carries a score, a band, a percentile or an item", () => {
    // The prose fields are excluded: they exist precisely to NAME what the
    // credential refuses to claim ("does NOT report a score, a grade ...").
    const doc = credentialDocument(claim, VALID, ORIGIN) as Record<string, any>;
    delete doc.description;
    delete doc.credentialSubject.achievement;
    delete doc.credentialSubject.ailx.doesNotAssert;
    const json = JSON.stringify(doc);
    for (const forbidden of [
      "band", "Distinction", "Merit", "composite", "percentile", "cohort", "score",
      "itemId", "item_id", "deck", "bank", "answer", "confidence", "latency",
      "attemptId", "participant", "authRef", "dPrime", "brier", "eventCount", "verbCounts",
      "pass", "passed", "grade",
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps null out of the artifact link when there is no artifact", () => {
    const noSite = { ...claim, artifact: null };
    const doc = credentialDocument(noSite, VALID, ORIGIN) as Record<string, any>;
    expect(doc.credentialSubject.ailx.artifact).toBeNull();
  });

  it("is a copy, never a reference into the stored claim", () => {
    const doc = credentialDocument(claim, VALID, ORIGIN) as Record<string, any>;
    doc.credentialSubject.ailx.tracksAttempted.push("T9");
    doc.credentialSubject.ailx.claims.push("scored");
    expect(claim.tracksAttempted).toEqual(["T1", "T2", "T3", "T4"]);
    expect(claim.claims).toEqual(["sitting-completed"]);
  });
});

describe("LinkedIn metadata", () => {
  const claim = buildCredentialClaim(completedState(), RAW)!;

  it("fills the five fields LinkedIn's certification form asks for", () => {
    expect(linkedInCertification(claim, VALID, ORIGIN)).toEqual({
      name: "AILX 2026.1 — Sitting Completed",
      organizationName: "AILX",
      issueYear: 2026,
      issueMonth: 2,
      credentialId: VALID.code,
      credentialUrl: `${ORIGIN}/verify/${VALID.code}`,
    });
  });

  it("uses a 1-based issue month (LinkedIn's, not JavaScript's)", () => {
    const december = { ...VALID, issuedAt: "2026-12-31T23:59:59.000Z" };
    const cert = linkedInCertification(claim, december, ORIGIN);
    expect(cert.issueMonth).toBe(12);
    expect(cert.issueYear).toBe(2026);
  });

  it("builds an Add-to-profile link with every parameter encoded", () => {
    const url = new URL(linkedInAddUrl(linkedInCertification(claim, VALID, ORIGIN)));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/profile/add");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      startTask: "CERTIFICATION_NAME",
      name: "AILX 2026.1 — Sitting Completed",
      organizationName: "AILX",
      issueYear: "2026",
      issueMonth: "2",
      certId: VALID.code,
      certUrl: `${ORIGIN}/verify/${VALID.code}`,
    });
  });

  it("never advertises a credential as passed, graded or scored", () => {
    const name = credentialName("2026.1");
    expect(name).toContain("Completed");
    expect(name.toLowerCase()).not.toContain("pass");
    expect(name.toLowerCase()).not.toContain("certified");
    expect(name.toLowerCase()).not.toContain("score");
  });
});
