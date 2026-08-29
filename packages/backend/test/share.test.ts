/**
 * Share links against the real schema in in-process Postgres.
 *
 * The properties under test are the product promises: private by default,
 * unguessable, revocable for real, owner-only mutation, and a payload that
 * is an allowlist rather than a redaction.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { TRACK_IDS } from "@ailx/session";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import type { ApiContext } from "../src/handlers.js";
import type { Queryable } from "../src/db.js";
import { SHARE_TOKEN_RE, shareCardPath, shareUrlPath } from "../src/share-url.js";
import {
  AUTO_APPROVER,
  approveShare,
  createShare,
  handleCreateShare,
  handleGetShare,
  handleRevokeShare,
  handleViewShare,
  hashShareToken,
  needsHumanApproval,
  newShareToken,
  publishShare,
  resolveShare,
  revokeShare,
  shareStatus,
  type CreatedShare,
} from "../src/share.js";
import { appendResponse } from "../src/store.js";
import { freshDb, openAttempt } from "./helpers.js";

let db: Queryable;
let ctx: ApiContext;
beforeAll(async () => {
  db = await freshDb();
  ctx = { db, auth: new DevAuthProvider() };
});

/** Mirror of what apps/web writes: whole session-log entries as responses. */
async function mirrorScoredRun(
  attemptId: string,
  participantId: string,
  scaled: readonly number[] = [88, 80, 72, 66],
): Promise<void> {
  const entries: unknown[] = [
    {
      type: "attempt_started",
      attemptId,
      seq: 0,
      ts: 1_767_225_600_000,
      config: { instrument: "ailx", version: "2026.1", locale: "en", demo: true, budgets: { t1: 1, t2: 1, t3: 1, t4: 1 } },
    },
    ...TRACK_IDS.map((t, i) => ({
      type: "track_scored",
      trackId: t,
      seq: i + 1,
      ts: 1_767_225_600_000 + i + 1,
      score: { raw: {}, scaled: scaled[i] },
      rubricVersion: `rv-${t}`,
      scoringDigest: `sd-${t}`,
      modelManifest: { screening: "demo-judge@1" },
    })),
  ];
  for (const [i, payload] of entries.entries()) {
    await appendResponse(db, attemptId, participantId, {
      seq: i,
      payload,
      clientTs: 1_767_225_600_000 + i,
    });
  }
}

async function scoredAttempt(scaled?: readonly number[]) {
  const { participantId, attempt } = await openAttempt(db);
  await mirrorScoredRun(attempt.id, participantId, scaled);
  return { participantId, attemptId: attempt.id };
}

describe("share tokens", () => {
  it("are 43-char base64url and never repeat", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => newShareToken()));
    expect(tokens.size).toBe(500);
    for (const t of tokens) expect(t).toMatch(SHARE_TOKEN_RE);
  });

  it("carry 256 bits of entropy — no positional bias in a large sample", () => {
    // A constant or short-cycling generator would collapse this set.
    const firstChars = new Set(Array.from({ length: 400 }, () => newShareToken()[0]));
    expect(firstChars.size).toBeGreaterThan(8);
  });

  it("hash to a stable sha256 hex that is not the token", async () => {
    const token = newShareToken();
    const digest = await hashShareToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token);
    expect(await hashShareToken(token)).toBe(digest);
  });

  it("stores only the digest — the database holds no working capability", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    const { rows } = await db.query("SELECT token_sha256, payload::text AS p FROM share_links WHERE id = $1", [share.id]);
    expect(rows[0]!.token_sha256).toBe(await hashShareToken(share.token));
    expect(String(rows[0]!.token_sha256)).not.toContain(share.token);
    expect(String(rows[0]!.p)).not.toContain(share.token);
  });
});

describe("url conventions", () => {
  it("builds the share and card paths from one place", () => {
    expect(shareUrlPath("abc")).toBe("/s/abc");
    expect(shareUrlPath("abc", "/ailx")).toBe("/ailx/s/abc");
    expect(shareCardPath("abc")).toBe("/api/share/abc/card.png");
  });
});

describe("creating a share", () => {
  it("is private by default — no share exists until asked for", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const { rows } = await db.query("SELECT count(*) AS n FROM share_links WHERE attempt_id = $1", [attemptId]);
    expect(Number(rows[0]!.n)).toBe(0);
    const read = await handleGetShare(ctx, { [DEV_USER_HEADER]: "nobody" }, attemptId);
    expect(read.status).toBe(404);
  });

  it("freezes the allowlisted payload and starts unlisted", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    expect(share.status).toBe("unlisted");
    expect(share.views).toBe(0);
    expect(share.payload.playerType.code).toHaveLength(4);
    expect(share.payload.tracks).toEqual({ t1: 88, t2: 80, t3: 72, t4: 66 });
    expect(share.payload.site).toBeNull();
  });

  it("is idempotent while live, and never re-issues the token", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const first = (await createShare(db, attemptId, participantId)) as CreatedShare;
    const second = await createShare(db, attemptId, participantId);
    expect(second.id).toBe(first.id);
    expect("token" in second).toBe(false);
  });

  it("refuses an unfinished run", async () => {
    const { participantId, attempt } = await openAttempt(db);
    await expect(createShare(db, attempt.id, participantId)).rejects.toThrow(/nothing to share/);
  });

  it("refuses an attempt owned by somebody else (404, no existence leak)", async () => {
    const { attemptId } = await scoredAttempt();
    const other = await openAttempt(db);
    await expect(createShare(db, attemptId, other.participantId)).rejects.toThrow(/not found/);
  });

  it("includes the live site path only on explicit opt-in", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const digest = `sha256:${"a".repeat(64)}`;
    await appendResponse(db, attemptId, participantId, {
      seq: 99,
      payload: { kind: "t1-site-snapshot", digest, fileCount: 1, totalBytes: 10 },
      clientTs: 1_767_225_700_000,
    });
    const plain = (await createShare(db, attemptId, participantId)) as CreatedShare;
    expect(plain.payload.site).toBeNull();
    await revokeShare(db, attemptId, participantId);
    const withSite = (await createShare(db, attemptId, participantId, { includeSite: true })) as CreatedShare;
    expect(withSite.payload.site).toBe(`/api/site/${digest}/index.html`);
  });
});

describe("resolving a share by token", () => {
  it("serves an unauthenticated read for a valid token", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    const res = await handleViewShare(ctx, share.token);
    expect(res.status).toBe(200);
    expect(res.body.share).toEqual({
      status: "unlisted",
      createdAt: share.createdAt,
      views: 0,
      payload: share.payload,
    });
  });

  it("exposes nothing beyond the payload and the link's own state", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    const json = JSON.stringify((await handleViewShare(ctx, share.token)).body);
    expect(json).not.toContain(attemptId);
    expect(json).not.toContain(participantId);
    expect(json).not.toContain(share.id);
    expect(json).not.toContain(await hashShareToken(share.token));
  });

  it("404s an unknown, malformed or empty token", async () => {
    for (const token of ["", "short", "!".repeat(43), newShareToken(), "../../etc/passwd"]) {
      expect(await resolveShare(db, token)).toBeNull();
      expect((await handleViewShare(ctx, token)).status).toBe(404);
    }
  });

  it("counts views anonymously, and only when asked", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    await resolveShare(db, share.token, false);
    expect((await resolveShare(db, share.token))!.views).toBe(0);
    await resolveShare(db, share.token, true);
    await resolveShare(db, share.token, true);
    expect((await resolveShare(db, share.token))!.views).toBe(2);
    const { rows } = await db.query("SELECT * FROM share_views WHERE share_id = $1", [share.id]);
    // No visitor identity is even storable: three columns, none personal.
    expect(Object.keys(rows[0]!).sort()).toEqual(["id", "share_id", "viewed_on"]);
  });
});

describe("revocation", () => {
  it("stops serving the token immediately and stays revoked", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    expect((await handleViewShare(ctx, share.token)).status).toBe(200);
    expect(await revokeShare(db, attemptId, participantId)).toEqual({ revoked: true });
    expect((await handleViewShare(ctx, share.token)).status).toBe(404);
    expect(await resolveShare(db, share.token)).toBeNull();
    // Idempotent: a second revoke is a no-op, not an error.
    expect(await revokeShare(db, attemptId, participantId)).toEqual({ revoked: false });
    expect((await handleViewShare(ctx, share.token)).status).toBe(404);
  });

  it("keeps the revoked row as the audit trail, never deletes it", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    await createShare(db, attemptId, participantId);
    await revokeShare(db, attemptId, participantId);
    const { rows } = await db.query("SELECT revoked_at FROM share_links WHERE attempt_id = $1", [attemptId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked_at).not.toBeNull();
  });

  it("issues a NEW token when re-shared, and the old one never comes back", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const first = (await createShare(db, attemptId, participantId)) as CreatedShare;
    await revokeShare(db, attemptId, participantId);
    const second = (await createShare(db, attemptId, participantId)) as CreatedShare;
    expect(second.token).not.toBe(first.token);
    expect((await handleViewShare(ctx, first.token)).status).toBe(404);
    expect((await handleViewShare(ctx, second.token)).status).toBe(200);
  });

  it("cannot be revoked by another participant", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    const other = await openAttempt(db);
    await expect(revokeShare(db, attemptId, other.participantId)).rejects.toThrow(/not found/);
    expect((await handleViewShare(ctx, share.token)).status).toBe(200);
  });
});

describe("lifecycle states", () => {
  it("derives status from monotone stamps (unlisted → submitted → published)", () => {
    const base = { revokedAt: null, approvedAt: null, submittedAt: null };
    expect(shareStatus(base)).toBe("unlisted");
    expect(shareStatus({ ...base, submittedAt: "t" })).toBe("submitted");
    expect(shareStatus({ ...base, submittedAt: "t", approvedAt: "t" })).toBe("published");
    // Revoked wins from ANY stage — including an approved gallery entry.
    expect(shareStatus({ submittedAt: "t", approvedAt: "t", revokedAt: "t" })).toBe("revoked");
  });

  it("revokes a gallery-published link too (approval never outranks the candidate)", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    await publishShare(db, attemptId, participantId);
    expect((await resolveShare(db, share.token))!.status).toBe("published");
    await revokeShare(db, attemptId, participantId);
    expect(await resolveShare(db, share.token)).toBeNull();
  });
});

describe("handlers", () => {
  const as = (user: string) => ({ [DEV_USER_HEADER]: user });

  it("require authentication to create, read or revoke", async () => {
    const { attemptId } = await scoredAttempt();
    for (const res of [
      await handleCreateShare(ctx, {}, attemptId, {}),
      await handleGetShare(ctx, {}, attemptId),
      await handleRevokeShare(ctx, {}, attemptId),
    ]) {
      expect(res.status).toBe(401);
    }
  });

  it("create → read → revoke over the API surface, as the owner", async () => {
    const user = as("share-owner");
    const created = await handleCreateAttemptWithRun(user);
    const post = await handleCreateShare(ctx, user, created, { includeSite: false });
    expect(post.status).toBe(201);
    const share = post.body.share as CreatedShare;
    expect(share.token).toMatch(SHARE_TOKEN_RE);

    const get = await handleGetShare(ctx, user, created);
    expect(get.status).toBe(200);
    expect((get.body.share as { id: string }).id).toBe(share.id);
    expect(JSON.stringify(get.body)).not.toContain(share.token);

    const del = await handleRevokeShare(ctx, user, created);
    expect(del.body).toEqual({ revoked: true });
    expect((await handleGetShare(ctx, user, created)).status).toBe(404);
  });

  it("404s create/read/revoke for a stranger's attempt", async () => {
    const owner = as("share-owner-2");
    const attemptId = await handleCreateAttemptWithRun(owner);
    await handleCreateShare(ctx, owner, attemptId, {});
    const stranger = as("share-stranger");
    expect((await handleCreateShare(ctx, stranger, attemptId, {})).status).toBe(404);
    expect((await handleGetShare(ctx, stranger, attemptId)).status).toBe(404);
    expect((await handleRevokeShare(ctx, stranger, attemptId)).status).toBe(404);
    expect((await handleGetShare(ctx, owner, attemptId)).status).toBe(200);
  });
});

describe("hybrid publication policy", () => {
  /** Give an attempt a T1 snapshot row so `includeSite` has something to opt into. */
  async function withSite(attemptId: string, participantId: string, seq = 98) {
    const digest = `sha256:${"b".repeat(64)}`;
    await appendResponse(db, attemptId, participantId, {
      seq,
      payload: { kind: "t1-site-snapshot", digest, fileCount: 1, totalBytes: 10 },
      clientTs: 1_767_225_800_000,
    });
    return digest;
  }

  it("decides from the stored payload, not from any request field", () => {
    expect(needsHumanApproval({ site: null })).toBe(false);
    expect(needsHumanApproval({ site: "/api/site/x/index.html" })).toBe(true);
  });

  it("auto-publishes a card: no human, one step, recorded as auto", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    expect(share.needsHumanApproval).toBe(false);
    expect(await publishShare(db, attemptId, participantId)).toEqual({
      status: "published",
      awaitingApproval: false,
    });
    const live = (await resolveShare(db, share.token))!;
    expect(live.status).toBe("published");
    expect(live.approvedBy).toBe(AUTO_APPROVER);
  });

  it("publishing a card twice is idempotent", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    await createShare(db, attemptId, participantId);
    const first = await publishShare(db, attemptId, participantId);
    expect(await publishShare(db, attemptId, participantId)).toEqual(first);
  });

  it("holds a site-carrying share at `submitted` until a HUMAN approves", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    await withSite(attemptId, participantId);
    const share = (await createShare(db, attemptId, participantId, { includeSite: true })) as CreatedShare;
    expect(share.needsHumanApproval).toBe(true);

    expect(await publishShare(db, attemptId, participantId)).toEqual({
      status: "submitted",
      awaitingApproval: true,
    });
    // Repeated candidate calls can never promote it past the gate.
    await publishShare(db, attemptId, participantId);
    await publishShare(db, attemptId, participantId);
    const held = (await resolveShare(db, share.token))!;
    expect(held.status).toBe("submitted");
    expect(held.approvedBy).toBeNull();

    expect(await approveShare(db, share.id, "human:reviewer-1")).toEqual({ approved: true });
    const published = (await resolveShare(db, share.token))!;
    expect(published.status).toBe("published");
    expect(published.approvedBy).toBe("human:reviewer-1");
  });

  it("cannot be bypassed by client-supplied fields on create", async () => {
    const user = { [DEV_USER_HEADER]: "share-bypass" };
    const { ensureParticipant, createAttempt } = await import("../src/store.js");
    const participant = await ensureParticipant(db, "dev:share-bypass");
    const attempt = await createAttempt(db, participant.id, { instrumentId: "ailx", instrumentVer: "2026.1" });
    await mirrorScoredRun(attempt.id, participant.id);
    await withSite(attempt.id, participant.id);

    const res = await handleCreateShare(ctx, user, attempt.id, {
      includeSite: true,
      // Everything a hostile client might try to smuggle in:
      status: "published",
      approvedAt: "2026-01-01T00:00:00.000Z",
      approvedBy: "human:me",
      needsHumanApproval: false,
      payload: { site: null },
    });
    const share = res.body.share as CreatedShare;
    expect(share.status).toBe("unlisted");
    expect(share.approvedBy).toBeNull();
    expect(share.needsHumanApproval).toBe(true);
    expect(await publishShare(db, attempt.id, participant.id)).toEqual({
      status: "submitted",
      awaitingApproval: true,
    });
  });

  it("refuses a non-human approver reference", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    await expect(approveShare(db, share.id, AUTO_APPROVER)).rejects.toThrow(/human approver/);
    await expect(approveShare(db, share.id, "")).rejects.toThrow(/human approver/);
  });

  it("will not approve an unsubmitted or revoked share", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
    expect(await approveShare(db, share.id, "human:r")).toEqual({ approved: false });
    await publishShare(db, attemptId, participantId);
    await revokeShare(db, attemptId, participantId);
    expect(await approveShare(db, share.id, "human:r")).toEqual({ approved: false });
    expect(await resolveShare(db, share.token)).toBeNull();
  });

  it("refuses to publish when there is no live link", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    await expect(publishShare(db, attemptId, participantId)).rejects.toThrow(/no live share link/);
  });
});

/** Create an attempt through the store for `user` and mirror a scored run. */
async function handleCreateAttemptWithRun(headers: Record<string, string>): Promise<string> {
  const { ensureParticipant, createAttempt } = await import("../src/store.js");
  const authRef = `dev:${headers[DEV_USER_HEADER]}`;
  const participant = await ensureParticipant(db, authRef);
  const attempt = await createAttempt(db, participant.id, { instrumentId: "ailx", instrumentVer: "2026.1" });
  await mirrorScoredRun(attempt.id, participant.id);
  return attempt.id;
}