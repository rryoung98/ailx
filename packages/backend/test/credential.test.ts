/**
 * Credentials, against the real schema (PGlite).
 *
 * The behaviours under test are the ones a stranger relies on: a genuine code
 * verifies, a forged or unknown one does not, and a revoked one still
 * resolves and says it is revoked. Everything else is the owner boundary.
 */
import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_CODE_RE,
  CREDENTIAL_LIMITS,
  credentialName,
} from "@ailx/report";
import {
  HOLDER_REVOKED_REASON,
  REVOKE_REASON_MAX,
  getCredentialForAttempt,
  handleGetCredential,
  handleIssueCredential,
  handleRevokeCredential,
  handleVerifyCredential,
  issueCredential,
  newCredentialCode,
  normalizeRevokeReason,
  ownerCredentialView,
  resolveCredential,
  revokeCredential,
} from "../src/credential.js";
import { DevAuthProvider } from "../src/auth.js";
import { StoreError } from "../src/store.js";
import { attachSiteSnapshot, freshDb, openAttempt, scoredAttempt } from "./helpers.js";

const ORIGIN = "https://ailx.example";
const ctxOf = (db: Awaited<ReturnType<typeof freshDb>>) => ({ db, auth: new DevAuthProvider() });
const headersFor = (authRef: string) => ({ "x-ailx-dev-user": authRef.replace(/^dev:/, "") });

describe("issueCredential", () => {
  it("issues a verifiable credential for a finished sitting", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const { credential, issued } = await issueCredential(db, attemptId, participantId);
    expect(issued).toBe(true);
    expect(credential.code).toMatch(CREDENTIAL_CODE_RE);
    expect(credential.status).toBe("valid");
    expect(credential.revokedAt).toBeNull();
    expect(credential.claim.tracksAttempted).toEqual(["T1", "T2", "T3", "T4"]);
    expect(credential.claim.claims).toEqual(["sitting-completed"]);
  });

  it("is idempotent while one is live — a published code is never orphaned", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const first = await issueCredential(db, attemptId, participantId);
    const second = await issueCredential(db, attemptId, participantId);
    expect(second.issued).toBe(false);
    expect(second.credential.code).toBe(first.credential.code);
    const { rows } = await db.query("SELECT count(*) AS n FROM credentials");
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("carries the holder's own artifact when the sitting recorded one", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const digest = await attachSiteSnapshot(db, attemptId, participantId);
    const { credential } = await issueCredential(db, attemptId, participantId);
    expect(credential.claim.artifact).toContain(digest);
  });

  it("refuses a run that is not a finished sitting", async () => {
    const db = await freshDb();
    const { participantId, attempt } = await openAttempt(db);
    await expect(issueCredential(db, attempt.id, participantId)).rejects.toThrow(StoreError);
  });

  it("refuses an attempt the caller does not own", async () => {
    const db = await freshDb();
    const { attemptId } = await scoredAttempt(db);
    const other = await openAttempt(db);
    await expect(issueCredential(db, attemptId, other.participantId)).rejects.toThrow(/not found/);
  });

  it("issues a fresh code after a revocation, leaving the old row resolvable", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const first = await issueCredential(db, attemptId, participantId);
    await revokeCredential(db, attemptId, participantId);
    const second = await issueCredential(db, attemptId, participantId);
    expect(second.issued).toBe(true);
    expect(second.credential.code).not.toBe(first.credential.code);
    expect((await resolveCredential(db, first.credential.code))?.status).toBe("revoked");
    expect((await resolveCredential(db, second.credential.code))?.status).toBe("valid");
  });
});

describe("newCredentialCode", () => {
  it("mints codes in our format, and not the same one twice", () => {
    const codes = new Set(Array.from({ length: 50 }, () => newCredentialCode("2026.1")));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(CREDENTIAL_CODE_RE);
  });
});

describe("revokeCredential", () => {
  it("stamps a revocation with a reason and keeps the row", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const { credential } = await issueCredential(db, attemptId, participantId);
    expect(await revokeCredential(db, attemptId, participantId)).toEqual({ revoked: true });
    const after = await resolveCredential(db, credential.code);
    expect(after?.status).toBe("revoked");
    expect(after?.revokeReason).toBe(HOLDER_REVOKED_REASON);
    expect(after?.revokedAt).not.toBeNull();
    expect(await getCredentialForAttempt(db, attemptId, participantId)).toBeNull();
  });

  it("is idempotent, and never revokes someone else's", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    await issueCredential(db, attemptId, participantId);
    await revokeCredential(db, attemptId, participantId);
    expect(await revokeCredential(db, attemptId, participantId)).toEqual({ revoked: false });
    const other = await openAttempt(db);
    await expect(revokeCredential(db, attemptId, other.participantId)).rejects.toThrow(/not found/);
  });

  it("normalizes a supplied reason and never stores a blank one", () => {
    expect(normalizeRevokeReason("  I made a mistake\n", "fallback")).toBe("I made a mistake");
    expect(normalizeRevokeReason("   ", "fallback")).toBe("fallback");
    expect(normalizeRevokeReason(undefined, "fallback")).toBe("fallback");
    expect(normalizeRevokeReason(42, "fallback")).toBe("fallback");
    expect(normalizeRevokeReason("x".repeat(400), "fallback").length).toBe(REVOKE_REASON_MAX);
  });
});

describe("resolveCredential — what a stranger can check", () => {
  it("confirms a genuine credential", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const { credential } = await issueCredential(db, attemptId, participantId);
    expect((await resolveCredential(db, credential.code))?.id).toBe(credential.id);
  });

  it("refuses a forged, unknown or malformed code", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const { credential } = await issueCredential(db, attemptId, participantId);
    const forged = credential.code.slice(0, -1) + (credential.code.endsWith("Z") ? "Y" : "Z");
    for (const code of [
      forged,
      "AILX-2026.1-0000-0000-0000-0000",
      "AILX-2026.1-AB12-CD34-EF56",
      "' OR 1=1 --",
      "",
      credential.code.toLowerCase(),
    ]) {
      expect(await resolveCredential(db, code), code).toBeNull();
    }
  });
});

describe("handlers", () => {
  it("issues, reads and revokes through the owner's own routes", async () => {
    const db = await freshDb();
    const { attemptId } = await scoredAttempt(db);
    const { rows } = await db.query(
      "SELECT p.auth_ref FROM participants p JOIN attempts a ON a.participant_id = p.id WHERE a.id = $1",
      [attemptId],
    );
    const headers = headersFor(String(rows[0]!.auth_ref));
    const ctx = ctxOf(db);

    const created = await handleIssueCredential(ctx, headers, attemptId, ORIGIN);
    expect(created.status).toBe(201);
    const owner = (created.body as any).credential;
    expect(owner.verifyPath).toBe(`/verify/${owner.code}`);
    expect(owner.linkedIn).toEqual({
      name: credentialName(owner.claim.instrumentVersion),
      organizationName: "AILX",
      issueYear: new Date(owner.issuedAt).getUTCFullYear(),
      issueMonth: new Date(owner.issuedAt).getUTCMonth() + 1,
      credentialId: owner.code,
      credentialUrl: `${ORIGIN}/verify/${owner.code}`,
    });

    expect((await handleIssueCredential(ctx, headers, attemptId, ORIGIN)).status).toBe(200);
    expect((await handleGetCredential(ctx, headers, attemptId, ORIGIN)).status).toBe(200);

    const revoked = await handleRevokeCredential(ctx, headers, attemptId, { reason: "wrong run" });
    expect(revoked.body).toEqual({ revoked: true });
    expect((await handleGetCredential(ctx, headers, attemptId, ORIGIN)).status).toBe(404);

    // The published code STILL verifies, and now says why it should not be trusted.
    const doc = await handleVerifyCredential(ctx, owner.code, ORIGIN);
    expect(doc.status).toBe(200);
    expect((doc.body as any).credentialStatus).toMatchObject({
      status: "revoked",
      revokeReason: "wrong run",
    });
  });

  it("verifies anonymously and states what it does not assert", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const { credential } = await issueCredential(db, attemptId, participantId);
    const result = await handleVerifyCredential(ctxOf(db), credential.code, ORIGIN);
    expect(result.status).toBe(200);
    const body = result.body as any;
    expect(body.id).toBe(`${ORIGIN}/verify/${credential.code}`);
    expect(body.credentialStatus.status).toBe("valid");
    expect(body.credentialSubject.ailx.doesNotAssert).toEqual([...CREDENTIAL_LIMITS]);
    // No score, no band, no attempt id, no participant — ever. The prose
    // fields are excluded: they exist to NAME what is not claimed.
    const { doesNotAssert: _limits, ...facts } = body.credentialSubject.ailx;
    const json = JSON.stringify({ ...body, description: undefined, credentialSubject: { facts } });
    for (const forbidden of [attemptId, participantId, "composite", "percentile", "scaled"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
  });

  it("answers an unknown code with a 404 that refuses to confirm anything", async () => {
    const db = await freshDb();
    const result = await handleVerifyCredential(ctxOf(db), "AILX-2026.1-0000-0000-0000-0000", ORIGIN);
    expect(result.status).toBe(404);
    expect((result.body as any).error.message).toContain("cannot be confirmed");
  });

  it("never serves someone else's credential through the owner routes", async () => {
    const db = await freshDb();
    const { attemptId } = await scoredAttempt(db);
    const stranger = await openAttempt(db);
    const { rows } = await db.query("SELECT auth_ref FROM participants WHERE id = $1", [
      stranger.participantId,
    ]);
    const headers = headersFor(String(rows[0]!.auth_ref));
    const ctx = ctxOf(db);
    expect((await handleGetCredential(ctx, headers, attemptId, ORIGIN)).status).toBe(404);
    expect((await handleIssueCredential(ctx, headers, attemptId, ORIGIN)).status).toBe(404);
    expect((await handleRevokeCredential(ctx, headers, attemptId, {})).status).toBe(404);
  });

  it("refuses an unauthenticated caller on every owner route", async () => {
    const db = await freshDb();
    const { attemptId } = await scoredAttempt(db);
    const ctx = ctxOf(db);
    for (const result of [
      await handleIssueCredential(ctx, {}, attemptId, ORIGIN),
      await handleGetCredential(ctx, {}, attemptId, ORIGIN),
      await handleRevokeCredential(ctx, {}, attemptId, {}),
    ]) {
      expect(result.status).toBe(401);
    }
  });
});

describe("the stored row", () => {
  it("freezes the claim and never updates it", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const { credential } = await issueCredential(db, attemptId, participantId);
    const before = await db.query("SELECT claim FROM credentials WHERE id = $1", [credential.id]);
    await revokeCredential(db, attemptId, participantId);
    const after = await db.query("SELECT claim FROM credentials WHERE id = $1", [credential.id]);
    expect(JSON.stringify(after.rows[0]!.claim)).toBe(JSON.stringify(before.rows[0]!.claim));
  });

  it("cannot record a revocation without a reason (schema constraint)", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const { credential } = await issueCredential(db, attemptId, participantId);
    await expect(
      db.query("UPDATE credentials SET revoked_at = now() WHERE id = $1", [credential.id]),
    ).rejects.toThrow();
  });

  it("reads an unreadable claim as unverifiable rather than crashing", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const { credential } = await issueCredential(db, attemptId, participantId);
    await db.query(`UPDATE credentials SET claim = '{"v":99}'::jsonb WHERE id = $1`, [
      credential.id,
    ]);
    expect(await resolveCredential(db, credential.code)).toBeNull();
    expect((await handleVerifyCredential(ctxOf(db), credential.code, ORIGIN)).status).toBe(404);
  });

  it("exposes the owner view without inventing an origin", async () => {
    const db = await freshDb();
    const { participantId, attemptId } = await scoredAttempt(db);
    const { credential } = await issueCredential(db, attemptId, participantId);
    const view = ownerCredentialView(credential, "https://example.test");
    expect(view.linkedIn.credentialUrl).toBe(`https://example.test/verify/${credential.code}`);
  });
});
