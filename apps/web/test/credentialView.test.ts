/**
 * `lib/credentialView.ts` — unwrapping the public Open Badges document.
 *
 * /verify/<code> renders a stranger's only source of truth, from a PUBLIC
 * endpoint, so this parser has to be hostile-input safe: a document that is
 * not ours yields null and the page says "cannot be confirmed", rather than a
 * page of `undefined` that still looks like a verification.
 */
import { describe, expect, it } from "vitest";
import { buildCredentialClaim, credentialDocument, type CredentialClaim } from "@ailx/report";
import { initialState, TRACK_IDS, type SessionState } from "@ailx/session";
import { credentialViewFrom } from "../lib/credentialView";

const ORIGIN = "https://ailx.example";
const CODE = "AILX-2026.1-AB12-CD34-EF56-GH78";

function completedState(): SessionState {
  const s = initialState();
  s.phase = "completed";
  s.config = {
    instrument: "ailx", version: "2026.1", locale: "en",
    budgets: { t1: 600, t2: 300, t3: 600, t4: 480 },
  };
  s.lastTs = Date.parse("2026-02-03T11:00:00.000Z");
  for (const t of TRACK_IDS) {
    s.tracks[t] = { trackId: t, status: "completed", activeMs: 60_000, events: [], score: { raw: {}, scaled: 50 } };
  }
  return s;
}

const claim: CredentialClaim = buildCredentialClaim(
  completedState(),
  { t1: 88.2, t2: 30.5, t3: 71.1, t4: 66.9 },
  { artifact: "/api/site/sha256:abc/index.html" },
)!;

const state = {
  code: CODE,
  status: "valid" as const,
  issuedAt: "2026-02-04T09:30:00.000Z",
  revokedAt: null,
  revokeReason: null,
};

const doc = (over: Partial<typeof state> = {}): Record<string, unknown> =>
  credentialDocument(claim, { ...state, ...over }, ORIGIN);

describe("a real document", () => {
  it("recovers every fact the page prints", () => {
    const view = credentialViewFrom(doc())!;
    expect(view.code).toBe(CODE);
    expect(view.status).toBe("valid");
    expect(view.issuedAt).toBe(state.issuedAt);
    expect(view.instrument).toBe(claim.instrument);
    expect(view.completedOn).toBe(claim.completedOn);
    expect(view.tracksAttempted).toEqual([...claim.tracksAttempted]);
    expect(view.playerType).toEqual({ code: claim.playerType.code, name: claim.playerType.name });
    expect(view.name).toMatch(/2026\.1/);
    expect(view.documentUrl).toBe(`${ORIGIN}/api/credentials/${CODE}`);
  });

  it("gives the artifact back as a stored PATH, so siteHref can validate it", () => {
    // The document carries `<issuer origin><path>`; the page must never
    // resolve an arbitrary absolute URL out of a payload.
    expect(credentialViewFrom(doc())!.artifactPath).toBe("/api/site/sha256:abc/index.html");
  });

  it("carries a revocation with its date and reason", () => {
    const view = credentialViewFrom(
      doc({ status: "revoked", revokedAt: "2026-03-01T08:00:00.000Z", revokeReason: "withdrawn sitting" }),
    )!;
    expect(view.status).toBe("revoked");
    expect(view.revokedAt).toBe("2026-03-01T08:00:00.000Z");
    expect(view.revokeReason).toBe("withdrawn sitting");
  });

  it("reads the code from the document, not from whatever the URL said", () => {
    // A reader may arrive with a differently-cased or padded code; the page
    // prints the one the issuer actually stored.
    expect(credentialViewFrom(doc())!.code).toBe(CODE);
  });
});

describe("anything that is not our document", () => {
  it("refuses non-objects outright", () => {
    for (const bad of [null, undefined, 3, "x", [], true]) {
      expect(credentialViewFrom(bad), String(bad)).toBeNull();
    }
  });

  it("refuses a document missing any fact the page would print", () => {
    for (const kill of [
      "credentialSubject",
      "credentialStatus",
      "name",
      "validFrom",
    ]) {
      const d = doc();
      delete d[kill];
      expect(credentialViewFrom(d), kill).toBeNull();
    }
  });

  it("refuses a subject with no ailx block, and an ailx block with no player type", () => {
    const noAilx = doc();
    (noAilx.credentialSubject as Record<string, unknown>).ailx = undefined;
    expect(credentialViewFrom(noAilx)).toBeNull();
    const noType = doc();
    ((noType.credentialSubject as Record<string, unknown>).ailx as Record<string, unknown>).playerType = null;
    expect(credentialViewFrom(noType)).toBeNull();
  });

  it("never reads a MISSING status as a revocation", () => {
    const d = doc();
    delete (d.credentialStatus as Record<string, unknown>).status;
    expect(credentialViewFrom(d)!.status).toBe("valid");
  });

  it("drops an artifact that does not belong to the issuer that signed it", () => {
    const d = doc();
    ((d.credentialSubject as Record<string, unknown>).ailx as Record<string, unknown>).artifact =
      "https://evil.example/api/site/sha256:abc/index.html";
    expect(credentialViewFrom(d)!.artifactPath).toBeNull();
  });

  it("keeps a null artifact null", () => {
    const bare = buildCredentialClaim(completedState(), { t1: 1, t2: 2, t3: 3, t4: 4 }, {})!;
    const d = credentialDocument(bare, state, ORIGIN);
    expect(credentialViewFrom(d)!.artifactPath).toBeNull();
  });

  it("drops non-string entries from tracksAttempted rather than rendering them", () => {
    const d = doc();
    ((d.credentialSubject as Record<string, unknown>).ailx as Record<string, unknown>).tracksAttempted = [
      "T1",
      7,
      null,
    ];
    expect(credentialViewFrom(d)!.tracksAttempted).toEqual(["T1"]);
  });
});
