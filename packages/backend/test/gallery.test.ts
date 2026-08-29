/**
 * The public gallery, against the real schema in in-process Postgres.
 *
 * The properties under test are the governance promises:
 *  - only APPROVED, non-revoked rows are ever listed (submitted and revoked
 *    are invisible, and a revoked entry never comes back);
 *  - a site-carrying share cannot reach the gallery without a HUMAN, however
 *    hostile the request that submitted it;
 *  - reviewer surfaces reject non-reviewers on the server, not in the UI.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import type { ApiContext } from "../src/handlers.js";
import type { Queryable } from "../src/db.js";
import {
  FORBIDDEN_RESULT,
  GALLERY_MAX_PAGE_SIZE,
  GALLERY_PAGE_SIZE,
  galleryFacets,
  handleListGallery,
  handleReviewDecision,
  handleReviewQueue,
  isReviewer,
  listGallery,
  listSubmissions,
  parseGalleryQuery,
  rejectSubmission,
  reviewerRefs,
} from "../src/gallery.js";
import {
  approveShare,
  createShare,
  handleCreateShare,
  publishShare,
  resolveShare,
  revokeShare,
  type CreatedShare,
} from "../src/share.js";
import { attachSiteSnapshot, freshDb, scoredAttempt } from "./helpers.js";

let db: Queryable;
let ctx: ApiContext;
const REVIEWER = "dev:reviewer-1";
const ENV = { AILX_REVIEWERS: `${REVIEWER}, dev:reviewer-2` };
const as = (user: string) => ({ [DEV_USER_HEADER]: user });

beforeEach(async () => {
  db = await freshDb();
  ctx = { db, auth: new DevAuthProvider() };
});

/** A published player-type card (auto-approved), the common gallery row. */
async function publishedCard(scaled?: readonly number[]): Promise<CreatedShare> {
  const { participantId, attemptId } = await scoredAttempt(db, scaled);
  const share = (await createShare(db, attemptId, participantId)) as CreatedShare;
  await publishShare(db, attemptId, participantId);
  return share;
}

/** A site-carrying share, submitted and waiting on a human. */
async function submittedSite(): Promise<{ share: CreatedShare; attemptId: string; participantId: string }> {
  const { participantId, attemptId } = await scoredAttempt(db);
  await attachSiteSnapshot(db, attemptId, participantId);
  const share = (await createShare(db, attemptId, participantId, { includeSite: true })) as CreatedShare;
  await publishShare(db, attemptId, participantId);
  return { share, attemptId, participantId };
}

describe("what the gallery lists", () => {
  it("lists an auto-published card with its frozen payload", async () => {
    const share = await publishedCard();
    const { entries, total } = await listGallery(db);
    expect(total).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(share.id);
    expect(entries[0]!.playerType.code).toMatch(/^[MP][ST][VA][DE]$/);
    expect(entries[0]!.approvedBy).toBe("auto:card");
    expect(entries[0]!.site).toBeNull();
  });

  it("excludes an unlisted share — creating a link is not publishing", async () => {
    const { participantId, attemptId } = await scoredAttempt(db);
    await createShare(db, attemptId, participantId);
    expect((await listGallery(db)).entries).toEqual([]);
  });

  it("excludes a SUBMITTED site share — approval is the gate, not submission", async () => {
    await submittedSite();
    const listing = await listGallery(db);
    expect(listing.entries).toEqual([]);
    expect(listing.total).toBe(0);
  });

  it("excludes a REVOKED entry, even after it was published", async () => {
    const { participantId, attemptId } = await scoredAttempt(db);
    await createShare(db, attemptId, participantId);
    await publishShare(db, attemptId, participantId);
    expect((await listGallery(db)).total).toBe(1);
    await revokeShare(db, attemptId, participantId);
    expect((await listGallery(db)).entries).toEqual([]);
    expect((await listGallery(db)).total).toBe(0);
  });

  it("lists a site share once, and only once, a human approves it", async () => {
    const { share } = await submittedSite();
    expect((await listGallery(db)).entries).toEqual([]);
    await approveShare(db, share.id, "human:ada");
    const { entries } = await listGallery(db);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.site).toMatch(/^\/api\/site\/sha256:[0-9a-f]{64}\/index\.html$/);
    expect(entries[0]!.approvedBy).toBe("human:ada");
  });

  it("never exposes a token, a digest, an attempt or a participant", async () => {
    const share = await publishedCard();
    await submittedSite();
    const serialized = JSON.stringify(await listGallery(db));
    expect(serialized).not.toContain(share.token);
    for (const forbidden of ["token_sha256", "tokenSha", "attemptId", "attempt_id", "participant", "site_digest"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("browsing", () => {
  beforeEach(async () => {
    await publishedCard([95, 95, 95, 95]);
    await publishedCard([95, 95, 95, 95]);
    await publishedCard([2, 2, 2, 2]);
  });

  it("filters by player type and counts the filtered total, not the page", async () => {
    const facets = await galleryFacets(db);
    expect(facets.reduce((a, f) => a + f.count, 0)).toBe(3);
    const top = facets[0]!;
    const filtered = await listGallery(db, parseGalleryQuery({ type: top.code }));
    expect(filtered.total).toBe(top.count);
    expect(filtered.entries.every((e) => e.playerType.code === top.code)).toBe(true);
  });

  it("ignores a filter that is not a player-type code instead of failing", async () => {
    const listing = await listGallery(db, parseGalleryQuery({ type: "'; DROP TABLE share_links; --" }));
    expect(listing.query.type).toBeNull();
    expect(listing.total).toBe(3);
  });

  it("sorts by recency by default and by type on request, deterministically", async () => {
    const recent = await listGallery(db, parseGalleryQuery({ sort: "recent" }));
    const oldest = await listGallery(db, parseGalleryQuery({ sort: "oldest" }));
    expect(recent.entries.map((e) => e.id)).toEqual([...oldest.entries.map((e) => e.id)].reverse());
    const byType = await listGallery(db, parseGalleryQuery({ sort: "type" }));
    const codes = byType.entries.map((e) => e.playerType.code);
    expect([...codes].sort()).toEqual(codes);
  });

  it("pages: the second page continues the first and never repeats it", async () => {
    const first = await listGallery(db, parseGalleryQuery({ limit: "2", offset: "0" }));
    const second = await listGallery(db, parseGalleryQuery({ limit: "2", offset: "2" }));
    expect(first.entries).toHaveLength(2);
    expect(second.entries).toHaveLength(1);
    expect(second.total).toBe(3);
    const ids = new Set([...first.entries, ...second.entries].map((e) => e.id));
    expect(ids.size).toBe(3);
  });

  it("filters to entries that carry a built site", async () => {
    const { share } = await submittedSite();
    await approveShare(db, share.id, "human:ada");
    const sites = await listGallery(db, parseGalleryQuery({ site: "1" }));
    expect(sites.entries.map((e) => e.id)).toEqual([share.id]);
  });
});

describe("query hardening", () => {
  it("clamps a hostile page size and a negative offset", () => {
    expect(parseGalleryQuery({ limit: "1000000" }).limit).toBe(GALLERY_MAX_PAGE_SIZE);
    expect(parseGalleryQuery({ limit: "0" }).limit).toBe(1);
    expect(parseGalleryQuery({ limit: "abc" }).limit).toBe(GALLERY_PAGE_SIZE);
    expect(parseGalleryQuery({ offset: "-5" }).offset).toBe(0);
    const huge = parseGalleryQuery({ offset: "999999999999999999999999999" }).offset;
    expect(Number.isSafeInteger(huge)).toBe(true);
  });

  it("falls back to a known sort key rather than trusting the string", () => {
    expect(parseGalleryQuery({ sort: "recent" }).sort).toBe("recent");
    expect(parseGalleryQuery({ sort: "id; DELETE FROM share_links" }).sort).toBe("recent");
    expect(parseGalleryQuery({}).sort).toBe("recent");
  });

  it("treats any site value but 1 as off", () => {
    expect(parseGalleryQuery({ site: "1" }).withSite).toBe(true);
    expect(parseGalleryQuery({ site: "true" }).withSite).toBe(false);
    expect(parseGalleryQuery({}).withSite).toBe(false);
  });
});

describe("the review queue", () => {
  it("holds site submissions only — a card is never in a human's queue", async () => {
    await publishedCard();
    const { share } = await submittedSite();
    const queue = await listSubmissions(db);
    expect(queue.map((e) => e.id)).toEqual([share.id]);
    expect(queue[0]!.site).not.toBeNull();
  });

  it("drops an entry once it is decided, either way", async () => {
    const a = await submittedSite();
    const b = await submittedSite();
    await approveShare(db, a.share.id, "human:ada");
    expect(await rejectSubmission(db, b.share.id)).toEqual({ rejected: true });
    expect(await listSubmissions(db)).toEqual([]);
    // Rejection revokes: the link stops resolving at all, and never lists.
    expect(await resolveShare(db, b.share.token)).toBeNull();
    expect((await listGallery(db)).entries.map((e) => e.id)).toEqual([a.share.id]);
  });

  it("refuses to reject anything that is not waiting for review", async () => {
    const card = await publishedCard();
    expect(await rejectSubmission(db, card.id)).toEqual({ rejected: false });
    expect((await listGallery(db)).total).toBe(1);
    expect(await rejectSubmission(db, "00000000-0000-0000-0000-000000000000")).toEqual({ rejected: false });
  });

  it("caps how much of the queue one read can pull", async () => {
    expect((await listSubmissions(db, 10_000)).length).toBeLessThanOrEqual(GALLERY_MAX_PAGE_SIZE);
  });
});

describe("reviewer access", () => {
  it("is an allowlist of auth refs that fails closed", () => {
    expect(isReviewer(REVIEWER, ENV)).toBe(true);
    expect(isReviewer("dev:reviewer-2", ENV)).toBe(true);
    expect(isReviewer("dev:someone", ENV)).toBe(false);
    expect(isReviewer(REVIEWER, {})).toBe(false);
    expect(isReviewer(REVIEWER, { AILX_REVIEWERS: "" })).toBe(false);
    expect(isReviewer(null, ENV)).toBe(false);
    expect(isReviewer("", { AILX_REVIEWERS: "" })).toBe(false);
  });

  it("never reads a wildcard as everyone", () => {
    expect(isReviewer("dev:anyone", { AILX_REVIEWERS: "*" })).toBe(false);
    expect(reviewerRefs({ AILX_REVIEWERS: "*, dev:a" })).toEqual(new Set(["dev:a"]));
  });

  it("splits on commas and whitespace, and ignores blanks", () => {
    expect(reviewerRefs({ AILX_REVIEWERS: " dev:a ,, \n clerk:b  " })).toEqual(new Set(["dev:a", "clerk:b"]));
  });

  it("401s an anonymous caller and 403s a signed-in non-reviewer", async () => {
    await submittedSite();
    expect((await handleReviewQueue(ctx, {}, ENV)).status).toBe(401);
    const outsider = await handleReviewQueue(ctx, as("intruder"), ENV);
    expect(outsider).toEqual(FORBIDDEN_RESULT);
    expect(JSON.stringify(outsider)).not.toContain("site");
  });

  it("serves the queue to a listed reviewer", async () => {
    const { share } = await submittedSite();
    const res = await handleReviewQueue(ctx, as("reviewer-1"), ENV);
    expect(res.status).toBe(200);
    expect((res.body.submissions as { id: string }[]).map((s) => s.id)).toEqual([share.id]);
  });
});

describe("the decision route", () => {
  it("refuses non-reviewers before it touches the row", async () => {
    const { share } = await submittedSite();
    expect((await handleReviewDecision(ctx, {}, { shareId: share.id, decision: "approve" }, ENV)).status).toBe(401);
    expect(
      (await handleReviewDecision(ctx, as("intruder"), { shareId: share.id, decision: "approve" }, ENV)).status,
    ).toBe(403);
    expect((await listGallery(db)).entries).toEqual([]);
    expect(await listSubmissions(db)).toHaveLength(1);
  });

  it("cannot be talked past the gate by request fields", async () => {
    const { share } = await submittedSite();
    const hostile = await handleReviewDecision(
      ctx,
      as("intruder"),
      { shareId: share.id, decision: "approve", reviewer: REVIEWER, approvedBy: "human:me", status: "published" },
      ENV,
    );
    expect(hostile.status).toBe(403);
    expect((await listGallery(db)).entries).toEqual([]);
  });

  it("stamps the VERIFIED caller as the approver, not a body field", async () => {
    const { share } = await submittedSite();
    const res = await handleReviewDecision(
      ctx,
      as("reviewer-1"),
      { shareId: share.id, decision: "approve", reviewer: "human:someone-else" },
      ENV,
    );
    expect(res.status).toBe(200);
    const listed = (await listGallery(db)).entries;
    expect(listed).toHaveLength(1);
    expect(listed[0]!.approvedBy).toBe(REVIEWER);
  });

  it("rejects a submission by revoking it, and says so once", async () => {
    const { share } = await submittedSite();
    const first = await handleReviewDecision(ctx, as("reviewer-1"), { shareId: share.id, decision: "reject" }, ENV);
    expect(first.status).toBe(200);
    const second = await handleReviewDecision(ctx, as("reviewer-1"), { shareId: share.id, decision: "reject" }, ENV);
    expect(second.status).toBe(404);
    expect(await resolveShare(db, share.token)).toBeNull();
  });

  it("validates the body before it reaches the store", async () => {
    const reviewer = as("reviewer-1");
    for (const body of [
      {},
      null,
      { shareId: "not-a-uuid", decision: "approve" },
      { shareId: "00000000-0000-0000-0000-000000000000", decision: "publish" },
      { shareId: "00000000-0000-0000-0000-000000000000" },
    ]) {
      expect((await handleReviewDecision(ctx, reviewer, body, ENV)).status, JSON.stringify(body)).toBe(400);
    }
    const missing = await handleReviewDecision(
      ctx,
      reviewer,
      { shareId: "00000000-0000-0000-0000-000000000000", decision: "approve" },
      ENV,
    );
    expect(missing.status).toBe(404);
  });

  it("will not approve a share that no candidate ever submitted", async () => {
    const { participantId, attemptId } = await scoredAttempt(db);
    await attachSiteSnapshot(db, attemptId, participantId);
    const share = (await createShare(db, attemptId, participantId, { includeSite: true })) as CreatedShare;
    const res = await handleReviewDecision(ctx, as("reviewer-1"), { shareId: share.id, decision: "approve" }, ENV);
    expect(res.status).toBe(404);
    expect((await listGallery(db)).entries).toEqual([]);
  });
});

describe("the public listing handler", () => {
  it("returns the same listing the page renders, with the query it used", async () => {
    await publishedCard();
    const res = await handleListGallery(ctx, { limit: "1" });
    expect(res.status).toBe(200);
    const gallery = res.body.gallery as { entries: unknown[]; query: { limit: number } };
    expect(gallery.entries).toHaveLength(1);
    expect(gallery.query.limit).toBe(1);
  });

  it("needs no authentication — the wall is public", async () => {
    await publishedCard();
    expect((await handleListGallery(ctx)).status).toBe(200);
  });

  it("survives a share row whose stored payload no longer parses", async () => {
    const share = await publishedCard();
    await db.query("UPDATE share_links SET payload = '{\"v\":999}'::jsonb WHERE id = $1", [share.id]);
    const listing = await listGallery(db);
    expect(listing.entries).toEqual([]);
    // The row still counts as listed; it is simply not renderable.
    expect(listing.total).toBe(1);
  });
});

describe("a hostile candidate cannot list a site", () => {
  it("smuggling approval fields through create+publish changes nothing", async () => {
    const { participantId, attemptId } = await scoredAttempt(db);
    await attachSiteSnapshot(db, attemptId, participantId);
    const { rows } = await db.query("SELECT auth_ref FROM participants WHERE id = $1", [participantId]);
    const owner = as(String(rows[0]!.auth_ref).replace(/^dev:/, ""));

    const res = await handleCreateShare(ctx, owner, attemptId, {
      includeSite: true,
      // Everything a hostile client might try to smuggle past the gate.
      status: "published",
      approvedAt: "2026-01-01T00:00:00.000Z",
      approvedBy: "human:me",
      needsHumanApproval: false,
      site_digest: null,
    });
    expect(res.status).toBe(201);
    await publishShare(db, attemptId, participantId);
    expect((await listGallery(db)).entries).toEqual([]);
    expect(await listSubmissions(db)).toHaveLength(1);
  });

  it("404s a share created against somebody else's attempt", async () => {
    const { attemptId } = await scoredAttempt(db);
    expect((await handleCreateShare(ctx, as("intruder"), attemptId, { includeSite: true })).status).toBe(404);
    expect((await listGallery(db)).entries).toEqual([]);
  });
});
