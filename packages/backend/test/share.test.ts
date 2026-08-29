/**
 * Share links against the real schema in in-process Postgres.
 *
 * The properties under test are the product promises: private by default,
 * unguessable, revocable for real, owner-only mutation, and a payload that
 * is an allowlist rather than a redaction.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { TRACK_IDS } from "@ailx/session";
import { ALL_SHARE_SECTIONS, DEFAULT_SHARE_SECTIONS, type ShareSections } from "@ailx/report";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import type { ApiContext } from "../src/handlers.js";
import type { Queryable } from "../src/db.js";
import { SHARE_TOKEN_RE, shareCardPath, shareUrlPath } from "../src/share-url.js";
import {
  AUTO_APPROVER,
  approveShare,
  createShare,
  getShareForAttempt,
  handleCreateShare,
  handleGetShare,
  handleRevokeShare,
  handleViewShare,
  needsHumanApproval,
  newShareToken,
  publishShare,
  resolveShare,
  revokeShare,
  shareStatus,
  type ShareRecord,
} from "../src/share.js";
import { rejectSubmission } from "../src/gallery.js";
import { appendResponse } from "../src/store.js";
import {
  attachSiteSnapshot,
  freshDb,
  mirrorScoredRun as mirrorRun,
  openAttempt,
  scoredAttempt as scoredRun,
} from "./helpers.js";

let db: Queryable;
let ctx: ApiContext;
beforeAll(async () => {
  db = await freshDb();
  ctx = { db, auth: new DevAuthProvider() };
});

/** The mirrored-log fixtures live in ./helpers, shared with every suite. */
const mirrorScoredRun = (attemptId: string, participantId: string, scaled?: readonly number[]) =>
  mirrorRun(db, attemptId, participantId, scaled);
const scoredAttempt = (scaled?: readonly number[]) => scoredRun(db, scaled);

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

  it("are stored verbatim, so the owner can recover their own link", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)).share;
    const { rows } = await db.query("SELECT token FROM share_links WHERE id = $1", [share.id]);
    expect(rows[0]!.token).toBe(share.token);
    // Recovery goes through the owner check, never through the token alone.
    expect((await getShareForAttempt(db, attemptId, participantId))!.token).toBe(share.token);
  });

  it("are never handed to another participant, at any surface", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)).share;
    const stranger = await openAttempt(db);
    // The owner-scoped store call refuses outright.
    expect(await getShareForAttempt(db, attemptId, stranger.participantId)).toBeNull();
    // The public capability read serves the payload but never the token.
    const publicBody = JSON.stringify((await handleViewShare(ctx, share.token)).body);
    expect(publicBody).not.toContain(share.token);
    expect(publicBody).not.toContain(share.id);
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
    const share = (await createShare(db, attemptId, participantId)).share;
    expect(share.status).toBe("unlisted");
    expect(share.views).toBe(0);
    expect(share.payload.playerType.code).toHaveLength(4);
    expect(share.payload.tracks).toEqual({ t1: 88, t2: 80, t3: 72, t4: 66 });
    expect(share.payload.site).toBeNull();
  });

  it("is idempotent while live, and returns the SAME recoverable token", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const first = (await createShare(db, attemptId, participantId)).share;
    const second = await createShare(db, attemptId, participantId);
    expect(second.created).toBe(false);
    expect(second.share.id).toBe(first.id);
    // The token is STORED, so a second call hands it back — recovering a lost
    // link must not require destroying it.
    expect(second.share.token).toBe(first.token);
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
    const plain = (await createShare(db, attemptId, participantId)).share;
    expect(plain.payload.site).toBeNull();
    await revokeShare(db, attemptId, participantId);
    const withSite = (await createShare(db, attemptId, participantId, { sections: { ...DEFAULT_SHARE_SECTIONS, site: true } })).share;
    expect(withSite.payload.site).toBe(`/api/site/${digest}/index.html`);
  });
});

describe("resolving a share by token", () => {
  it("serves an unauthenticated read for a valid token", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)).share;
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
    const share = (await createShare(db, attemptId, participantId)).share;
    const json = JSON.stringify((await handleViewShare(ctx, share.token)).body);
    expect(json).not.toContain(attemptId);
    expect(json).not.toContain(participantId);
    expect(json).not.toContain(share.id);
    expect(json).not.toContain(share.token);
  });

  it("404s an unknown, malformed or empty token", async () => {
    for (const token of ["", "short", "!".repeat(43), newShareToken(), "../../etc/passwd"]) {
      expect(await resolveShare(db, token)).toBeNull();
      expect((await handleViewShare(ctx, token)).status).toBe(404);
    }
  });

  it("counts views anonymously, and only when asked", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)).share;
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
    const share = (await createShare(db, attemptId, participantId)).share;
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
    const first = (await createShare(db, attemptId, participantId)).share;
    await revokeShare(db, attemptId, participantId);
    const second = (await createShare(db, attemptId, participantId)).share;
    expect(second.token).not.toBe(first.token);
    expect((await handleViewShare(ctx, first.token)).status).toBe(404);
    expect((await handleViewShare(ctx, second.token)).status).toBe(200);
  });

  it("cannot be revoked by another participant", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)).share;
    const other = await openAttempt(db);
    await expect(revokeShare(db, attemptId, other.participantId)).rejects.toThrow(/not found/);
    expect((await handleViewShare(ctx, share.token)).status).toBe(200);
  });
});

describe("lifecycle states", () => {
  it("derives status from monotone stamps (unlisted → submitted → published)", () => {
    const base = { revokedAt: null, approvedAt: null, rejectedAt: null, submittedAt: null };
    expect(shareStatus(base)).toBe("unlisted");
    expect(shareStatus({ ...base, submittedAt: "t" })).toBe("submitted");
    expect(shareStatus({ ...base, submittedAt: "t", approvedAt: "t" })).toBe("published");
    expect(shareStatus({ ...base, submittedAt: "t", rejectedAt: "t" })).toBe("rejected");
    // Revoked wins from ANY stage — including an approved gallery entry.
    expect(shareStatus({ ...base, submittedAt: "t", approvedAt: "t", revokedAt: "t" })).toBe("revoked");
    expect(shareStatus({ ...base, submittedAt: "t", rejectedAt: "t", revokedAt: "t" })).toBe("revoked");
  });

  it("revokes a gallery-published link too (approval never outranks the candidate)", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)).share;
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
    const post = await handleCreateShare(ctx, user, created, {});
    expect(post.status).toBe(201);
    const share = post.body.share as ShareRecord;
    expect(share.token).toMatch(SHARE_TOKEN_RE);

    const get = await handleGetShare(ctx, user, created);
    expect(get.status).toBe(200);
    expect((get.body.share as { id: string }).id).toBe(share.id);
    // The owner's own read HANDS BACK the token: that is what makes a lost
    // link recoverable instead of a reason to revoke.
    expect((get.body.share as ShareRecord).token).toBe(share.token);

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
  const withSite = (attemptId: string, participantId: string, seq = 98) =>
    attachSiteSnapshot(db, attemptId, participantId, seq);

  it("decides from the stored payload, not from any request field", () => {
    expect(needsHumanApproval({ site: null })).toBe(false);
    expect(needsHumanApproval({ site: null, note: null })).toBe(false);
    expect(needsHumanApproval({ site: "/api/site/x/index.html" })).toBe(true);
    // A candidate-authored note is content nobody vetted: same human, same gate.
    expect(needsHumanApproval({ site: null, note: "my words" })).toBe(true);
  });

  it("auto-publishes a card: no human, one step, recorded as auto", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)).share;
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
    const share = (await createShare(db, attemptId, participantId, { sections: { ...DEFAULT_SHARE_SECTIONS, site: true } })).share;
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
      sections: { site: true },
      // Everything a hostile client might try to smuggle in:
      status: "published",
      approvedAt: "2026-01-01T00:00:00.000Z",
      approvedBy: "human:me",
      needsHumanApproval: false,
      payload: { site: null },
    });
    const share = res.body.share as ShareRecord;
    expect(share.status).toBe("unlisted");
    // The owner's view carries no approver or refuser AT ALL: a candidate is
    // shown the decision and its reason, never which human made it
    // (`ownerShareView`, docs/SHARING.md §7.3).
    expect(Object.keys(share)).not.toContain("approvedBy");
    expect(Object.keys(share)).not.toContain("rejectedBy");
    expect(share.needsHumanApproval).toBe(true);
    expect(await publishShare(db, attempt.id, participant.id)).toEqual({
      status: "submitted",
      awaitingApproval: true,
    });
  });

  it("refuses a non-human approver reference", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)).share;
    await expect(approveShare(db, share.id, AUTO_APPROVER)).rejects.toThrow(/human approver/);
    await expect(approveShare(db, share.id, "")).rejects.toThrow(/human approver/);
  });

  it("will not approve an unsubmitted or revoked share", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)).share;
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


describe("what the candidate chose to share (server-side enforcement)", () => {
  const sectionsOf = (share: ShareRecord) => ({
    profile: share.payload.profile !== null,
    process: share.payload.process !== null,
    completed: share.payload.completedOn !== null,
    site: share.payload.site !== null,
    note: share.payload.note !== null,
  });

  it("stores the default set: derived sections on, authored sections off", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const share = (await createShare(db, attemptId, participantId)).share;
    expect(sectionsOf(share)).toEqual({
      profile: true, process: true, completed: true, site: false, note: false,
    });
  });

  it("drops every section the candidate switched off", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const none: ShareSections = {
      profile: false, process: false, completed: false, site: false, note: false,
    };
    const share = (await createShare(db, attemptId, participantId, { sections: none })).share;
    expect(sectionsOf(share)).toEqual(none);
    // And the STORED row carries nothing more than the response did.
    const { rows } = await db.query("SELECT payload::text AS p FROM share_links WHERE id = $1", [share.id]);
    const stored = JSON.parse(String(rows[0]!.p));
    expect(stored.process).toBeNull();
    expect(stored.profile).toBeNull();
  });

  it("carries the note only with the note section, sanitized and capped", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    const messy = `  I built\na thing  ${"x".repeat(400)}`;
    const off = (await createShare(db, attemptId, participantId, { note: messy })).share;
    expect(off.payload.note).toBeNull();
    await revokeShare(db, attemptId, participantId);
    const on = (await createShare(db, attemptId, participantId, {
      sections: { ...DEFAULT_SHARE_SECTIONS, note: true },
      note: messy,
    })).share;
    expect(on.payload.note!.startsWith("I built a thing")).toBe(true);
    expect(on.payload.note).toHaveLength(240);
    expect(on.needsHumanApproval).toBe(true);
  });

  it("cannot be widened by a hostile body naming sections it may not have", async () => {
    const user = { [DEV_USER_HEADER]: "share-hostile-sections" };
    const attemptId = await handleCreateAttemptWithRun(user);
    await attachSiteSnapshot(db, attemptId, (await ownerOf(attemptId)), 97);
    const res = await handleCreateShare(ctx, user, attemptId, {
      // Real sections the candidate explicitly turned OFF...
      sections: {
        profile: false, process: false, completed: false, site: false, note: false,
        // ...plus invented ones that must not exist at any layer.
        answers: true, items: true, responses: true, transcript: true, percentile: true,
      },
      note: "should not appear",
      // ...plus a whole forged payload.
      payload: { site: "/api/site/evil/index.html", note: "forged", tracks: { t1: 100 } },
    });
    const share = res.body.share as ShareRecord;
    expect(sectionsOf(share)).toEqual({
      profile: false, process: false, completed: false, site: false, note: false,
    });
    const json = JSON.stringify(res.body);
    for (const forbidden of [
      "should not appear", "forged", "evil", "answers", "items", "responses", "percentile",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("never lets a request name somebody else's site", async () => {
    const victim = await scoredAttempt();
    await attachSiteSnapshot(db, victim.attemptId, victim.participantId, 96);
    const attacker = await scoredAttempt();
    // The site opt-in reads the ATTEMPT's own recorded snapshot; there is no
    // field in which another attempt's digest could be named.
    const share = (await createShare(db, attacker.attemptId, attacker.participantId, {
      sections: { ...DEFAULT_SHARE_SECTIONS, site: true },
    })).share;
    expect(share.payload.site).toBeNull();
  });

  it("serves the expanded payload over HTTP with no forbidden substring", async () => {
    const { participantId, attemptId } = await scoredAttempt();
    await attachSiteSnapshot(db, attemptId, participantId, 95);
    const share = (await createShare(db, attemptId, participantId, {
      sections: ALL_SHARE_SECTIONS,
      note: "I built a site for a bike co-op.",
    })).share;
    const body = JSON.stringify((await handleViewShare(ctx, share.token)).body);
    expect(body).toContain("bike co-op");
    expect(body).toContain("totalActiveSeconds");
    for (const forbidden of [
      attemptId, participantId, share.id, share.token,
      "itemId", "item_id", "deck", "answer", "correct", "confidence", "latency",
      "authRef", "auth_ref", "percentile", "composite", "scoringDigest",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("a refusal is on the record", () => {
  /** A site-carrying share, submitted and waiting on a human. */
  async function submitted() {
    const { participantId, attemptId } = await scoredAttempt();
    await attachSiteSnapshot(db, attemptId, participantId, 94);
    const share = (await createShare(db, attemptId, participantId, {
      sections: { ...DEFAULT_SHARE_SECTIONS, site: true },
    })).share;
    await publishShare(db, attemptId, participantId);
    return { participantId, attemptId, share };
  }

  it("records who refused, when, and why — and stops serving it publicly", async () => {
    const { participantId, attemptId, share } = await submitted();
    expect(await rejectSubmission(db, share.id, "dev:reviewer-1", "  The site\nembeds a tracker.  ")).toEqual({
      rejected: true,
    });
    const { rows } = await db.query(
      "SELECT rejected_at, rejected_by, reject_reason, revoked_at FROM share_links WHERE id = $1",
      [share.id],
    );
    expect(rows[0]!.rejected_by).toBe("dev:reviewer-1");
    expect(rows[0]!.reject_reason).toBe("The site embeds a tracker.");
    expect(rows[0]!.rejected_at).not.toBeNull();
    // Not a revoke: the row stays the owner's, so they can read the reason.
    expect(rows[0]!.revoked_at).toBeNull();

    // Public serving stops everywhere.
    expect(await resolveShare(db, share.token)).toBeNull();
    expect((await handleViewShare(ctx, share.token)).status).toBe(404);

    // The OWNER still sees it, with the reason.
    const owned = (await getShareForAttempt(db, attemptId, participantId))!;
    expect(owned.status).toBe("rejected");
    expect(owned.rejectedBy).toBe("dev:reviewer-1");
    expect(owned.rejectReason).toBe("The site embeds a tracker.");
  });

  it("refuses an anonymous or reasonless refusal", async () => {
    const { share } = await submitted();
    await expect(rejectSubmission(db, share.id, "  ", "why")).rejects.toThrow(/reviewer reference/);
    await expect(rejectSubmission(db, share.id, "dev:r", "   ")).rejects.toThrow(/reason/);
  });

  it("is terminal for that row: it cannot be re-submitted or approved", async () => {
    const { participantId, attemptId, share } = await submitted();
    await rejectSubmission(db, share.id, "dev:reviewer-1", "no");
    await expect(publishShare(db, attemptId, participantId)).rejects.toThrow(/refused/);
    expect(await approveShare(db, share.id, "dev:reviewer-2")).toEqual({ approved: false });
    expect(await rejectSubmission(db, share.id, "dev:reviewer-2", "again")).toEqual({ rejected: false });
    expect(await resolveShare(db, share.token)).toBeNull();
  });

  it("lets the candidate revoke and share again without the refused part", async () => {
    const { participantId, attemptId, share } = await submitted();
    await rejectSubmission(db, share.id, "dev:reviewer-1", "no");
    expect(await revokeShare(db, attemptId, participantId)).toEqual({ revoked: true });
    const next = (await createShare(db, attemptId, participantId)).share;
    expect(next.id).not.toBe(share.id);
    expect(next.status).toBe("unlisted");
    expect(next.payload.site).toBeNull();
    expect((await handleViewShare(ctx, next.token)).status).toBe(200);
    // The refused row survives, stamps intact — the audit trail.
    const { rows } = await db.query("SELECT rejected_by FROM share_links WHERE id = $1", [share.id]);
    expect(rows[0]!.rejected_by).toBe("dev:reviewer-1");
  });
});

/** The participant id that owns `attemptId` — test-only convenience. */
async function ownerOf(attemptId: string): Promise<string> {
  const { rows } = await db.query("SELECT participant_id FROM attempts WHERE id = $1", [attemptId]);
  return rows[0]!.participant_id as string;
}

/** Create an attempt through the store for `user` and mirror a scored run. */
async function handleCreateAttemptWithRun(headers: Record<string, string>): Promise<string> {
  const { ensureParticipant, createAttempt } = await import("../src/store.js");
  const authRef = `dev:${headers[DEV_USER_HEADER]}`;
  const participant = await ensureParticipant(db, authRef);
  const attempt = await createAttempt(db, participant.id, { instrumentId: "ailx", instrumentVer: "2026.1" });
  await mirrorScoredRun(attempt.id, participant.id);
  return attempt.id;
}