/**
 * The moderation trail, against the real schema in in-process Postgres.
 *
 * The properties under test are the accountability promises of
 * docs/SHARING.md §7.6:
 *  - every moderation surface refuses a non-reviewer ON THE SERVER (401
 *    anonymous, 403 stranger), and a candidate reaches only their OWN case;
 *  - an internal note never appears in a candidate-visible payload — asserted
 *    on the EXACT serialized object, not on a rendered string;
 *  - the reviewer's identity never reaches the candidate, in any field;
 *  - the trail is append-only: an edit and a retraction are inserts, the
 *    replaced row survives byte-for-byte, and nothing can fork it;
 *  - a refusal stays terminal; an appeal moves the CASE, never the row.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import type { ApiContext } from "../src/handlers.js";
import type { Queryable } from "../src/db.js";
import { DEFAULT_SHARE_SECTIONS } from "@ailx/report";
import {
  approveShare,
  createShare,
  handleGetShare,
  publishShare,
  revokeShare,
  type ShareRecord,
} from "../src/share.js";
import { handleReviewDecision, rejectSubmission } from "../src/gallery.js";
import {
  COMMENT_BODY_MAX,
  addComment,
  candidateThread,
  getCase,
  handleCandidateReply,
  handleCandidateThread,
  handleModerationCase,
  handleModerationCases,
  handleModerationComment,
  listCases,
  listComments,
  normalizeCommentBody,
  parseCaseQuery,
  type CandidateComment,
  type ModerationComment,
} from "../src/moderation.js";
import { attachSiteSnapshot, freshDb, scoredAttempt } from "./helpers.js";

let db: Queryable;
let ctx: ApiContext;
const REVIEWER = "dev:reviewer-1";
const OTHER_REVIEWER = "dev:reviewer-2";
const ENV = { AILX_REVIEWERS: `${REVIEWER}, ${OTHER_REVIEWER}` };
const as = (user: string) => ({ [DEV_USER_HEADER]: user });

beforeEach(async () => {
  db = await freshDb();
  ctx = { db, auth: new DevAuthProvider() };
});

interface Case {
  share: ShareRecord;
  attemptId: string;
  participantId: string;
  /** The dev user the attempt's participant signs in as. */
  user: string;
}

let userSeq = 0;

/** A site-carrying share, submitted and waiting on a human. */
async function submittedSite(): Promise<Case> {
  const user = `owner-${userSeq++}`;
  const { rows } = await db.query(
    "INSERT INTO participants (auth_ref) VALUES ($1) RETURNING id",
    [`dev:${user}`],
  );
  const participantId = rows[0]!.id as string;
  const seeded = await scoredAttempt(db);
  // Re-point the seeded attempt at the participant this test can sign in as.
  await db.query("UPDATE attempts SET participant_id = $1 WHERE id = $2", [participantId, seeded.attemptId]);
  await attachSiteSnapshot(db, seeded.attemptId, participantId);
  const share = (
    await createShare(db, seeded.attemptId, participantId, {
      sections: { ...DEFAULT_SHARE_SECTIONS, site: true },
    })
  ).share;
  await publishShare(db, seeded.attemptId, participantId);
  return { share, attemptId: seeded.attemptId, participantId, user };
}

async function refused(reason = "The site embeds a third-party tracker."): Promise<Case> {
  const c = await submittedSite();
  await rejectSubmission(db, c.share.id, REVIEWER, reason);
  return c;
}

const reviewerTrail = async (shareId: string) =>
  (await listComments(db, shareId, "reviewer")) as ModerationComment[];
const candidateTrail = async (shareId: string) =>
  (await listComments(db, shareId, "candidate")) as CandidateComment[];

// ---------------------------------------------------------------------------

describe("who may reach a moderation surface", () => {
  it("refuses an anonymous caller with 401 on every reviewer route", async () => {
    const c = await submittedSite();
    for (const result of [
      await handleModerationCases(ctx, {}, {}, ENV),
      await handleModerationCase(ctx, {}, c.share.id, ENV),
      await handleModerationComment(ctx, {}, c.share.id, { body: "note" }, ENV),
    ]) {
      expect(result.status).toBe(401);
    }
  });

  it("refuses a signed-in stranger with 403 on every reviewer route", async () => {
    const c = await submittedSite();
    const stranger = as("nobody");
    for (const result of [
      await handleModerationCases(ctx, stranger, {}, ENV),
      await handleModerationCase(ctx, stranger, c.share.id, ENV),
      await handleModerationComment(ctx, stranger, c.share.id, { body: "note" }, ENV),
    ]) {
      expect(result.status).toBe(403);
    }
  });

  it("refuses everyone when AILX_REVIEWERS is unset, or a wildcard", async () => {
    const c = await submittedSite();
    for (const env of [{}, { AILX_REVIEWERS: "" }, { AILX_REVIEWERS: "*" }]) {
      expect((await handleModerationCases(ctx, as("reviewer-1"), {}, env)).status).toBe(403);
      expect((await handleModerationComment(ctx, as("reviewer-1"), c.share.id, { body: "x" }, env)).status).toBe(403);
    }
  });

  it("writes nothing when a stranger tries to comment", async () => {
    const c = await submittedSite();
    await handleModerationComment(ctx, as("nobody"), c.share.id, { body: "let me in" }, ENV);
    expect(await reviewerTrail(c.share.id)).toEqual([]);
  });

  it("404s an unknown or malformed case id for a real reviewer", async () => {
    for (const id of ["11111111-2222-3333-4444-555555555555", "not-a-uuid", ""]) {
      expect((await handleModerationCase(ctx, as("reviewer-1"), id, ENV)).status).toBe(404);
      expect((await handleModerationComment(ctx, as("reviewer-1"), id, { body: "x" }, ENV)).status).toBe(404);
    }
  });
});

describe("the dashboard lanes", () => {
  it("puts a waiting submission in `pending`, and counts every lane", async () => {
    const c = await submittedSite();
    const listing = await listCases(db, parseCaseQuery({ lane: "pending" }));
    expect(listing.cases.map((k) => k.entry.id)).toEqual([c.share.id]);
    expect(listing.cases[0]!.status).toBe("submitted");
    expect(listing.counts).toEqual({ pending: 1, appeals: 0, decided: 0 });
  });

  it("moves a decided case out of `pending` and into the history, with who and why", async () => {
    const c = await refused("Copied someone else's site.");
    expect((await listCases(db, parseCaseQuery({ lane: "pending" }))).cases).toEqual([]);
    const history = await listCases(db, parseCaseQuery({ lane: "decided" }));
    expect(history.cases).toHaveLength(1);
    const decided = history.cases[0]!;
    expect(decided.status).toBe("rejected");
    expect(decided.decidedBy).toBe(REVIEWER);
    expect(decided.rejectReason).toBe("Copied someone else's site.");
    expect(decided.decidedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("records an approval in the history too — both decisions, not just refusals", async () => {
    const c = await submittedSite();
    await approveShare(db, c.share.id, OTHER_REVIEWER);
    const history = await listCases(db, parseCaseQuery({ lane: "decided" }));
    expect(history.cases.map((k) => [k.status, k.decidedBy])).toEqual([["published", OTHER_REVIEWER]]);
  });

  it("keeps the auto-published card flood out of the history unless asked", async () => {
    const { participantId, attemptId } = await scoredAttempt(db);
    await createShare(db, attemptId, participantId);
    await publishShare(db, attemptId, participantId); // auto:card
    expect((await listCases(db, parseCaseQuery({ lane: "decided" }))).cases).toEqual([]);
    const withAuto = await listCases(db, parseCaseQuery({ lane: "decided", auto: "1" }));
    expect(withAuto.cases.map((k) => k.decidedBy)).toEqual(["auto:card"]);
  });

  it("normalizes a hostile query instead of trusting it", () => {
    expect(parseCaseQuery({ lane: "'; DROP TABLE share_links; --", limit: "10000", offset: "-5" })).toEqual({
      lane: "pending",
      includeAuto: false,
      limit: 100,
      offset: 0,
    });
    expect(parseCaseQuery({}).lane).toBe("pending");
  });

  it("pages a lane without losing the total", async () => {
    await submittedSite();
    await submittedSite();
    await submittedSite();
    const page = await listCases(db, parseCaseQuery({ lane: "pending", limit: "2" }));
    expect(page.cases).toHaveLength(2);
    expect(page.total).toBe(3);
    const rest = await listCases(db, parseCaseQuery({ lane: "pending", limit: "2", offset: "2" }));
    expect(rest.cases).toHaveLength(1);
  });

  it("serves the lanes to a reviewer over HTTP, and to nobody else", async () => {
    await submittedSite();
    const ok = await handleModerationCases(ctx, as("reviewer-1"), { lane: "pending" }, ENV);
    expect(ok.status).toBe(200);
    expect((ok.body.listing as { cases: unknown[] }).cases).toHaveLength(1);
  });
});

describe("comments are inserts, and the trail cannot be rewritten", () => {
  it("appends a moderator note and keeps who wrote it", async () => {
    const c = await submittedSite();
    const note = await addComment(db, {
      shareId: c.share.id,
      author: REVIEWER,
      role: "reviewer",
      visibility: "internal",
      body: "  Second opinion wanted:\r\n\n\n  the footer links out.  ",
    });
    expect(note.author).toBe(REVIEWER);
    expect(note.visibility).toBe("internal");
    // Line indentation is the author's; only trailing space and blank-line
    // runs are normalized, and the outer whitespace trimmed.
    expect(note.body).toBe("Second opinion wanted:\n\n  the footer links out.");
    expect(note.current).toBe(true);
    expect(note.retracted).toBe(false);
  });

  it("keeps the replaced row when a note is edited — the edit is a new row", async () => {
    const c = await submittedSite();
    const first = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "Looks fine to me.",
    });
    const second = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal",
      body: "Actually the footer links out.", supersedesId: first.id,
    });
    const trail = await reviewerTrail(c.share.id);
    expect(trail).toHaveLength(2);
    expect(trail[0]!.body).toBe("Looks fine to me.");
    expect(trail[0]!.current).toBe(false);
    expect(trail[1]!.current).toBe(true);
    expect(trail[1]!.supersedesId).toBe(first.id);
    expect(second.id).toBeGreaterThan(first.id);
  });

  it("records a retraction as an empty new row, never a delete", async () => {
    const c = await submittedSite();
    const first = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "shared", body: "Please remove the tracker.",
    });
    await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "shared", body: "   ", supersedesId: first.id,
    });
    const trail = await reviewerTrail(c.share.id);
    expect(trail).toHaveLength(2);
    expect(trail[0]!.body).toBe("Please remove the tracker.");
    expect(trail[1]!.retracted).toBe(true);
    // The candidate stops seeing a withdrawn message, but the record keeps it.
    expect(await candidateTrail(c.share.id)).toEqual([]);
    const { rows } = await db.query("SELECT count(*) AS n FROM moderation_comments WHERE share_id = $1", [c.share.id]);
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it("refuses an empty comment that replaces nothing", async () => {
    const c = await submittedSite();
    await expect(
      addComment(db, { shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "  " }),
    ).rejects.toThrow(/something in it/);
  });

  it("refuses to fork the chain: a row can be replaced at most once", async () => {
    const c = await submittedSite();
    const first = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "one",
    });
    await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "two", supersedesId: first.id,
    });
    await expect(
      addComment(db, {
        shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "three", supersedesId: first.id,
      }),
    ).rejects.toThrow();
  });

  it("lets only the author replace their own words", async () => {
    const c = await submittedSite();
    const mine = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "mine",
    });
    await expect(
      addComment(db, {
        shareId: c.share.id, author: OTHER_REVIEWER, role: "reviewer", visibility: "internal", body: "not yours", supersedesId: mine.id,
      }),
    ).rejects.toThrow(/only the author/);
  });

  it("refuses a supersedes id from another case", async () => {
    const a = await submittedSite();
    const b = await submittedSite();
    const note = await addComment(db, {
      shareId: a.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "a",
    });
    await expect(
      addComment(db, {
        shareId: b.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "b", supersedesId: note.id,
      }),
    ).rejects.toThrow(/no such comment/);
  });

  it("inherits visibility on an edit — a shared message cannot become internal", async () => {
    const c = await submittedSite();
    const shared = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "shared", body: "Remove the tracker, please.",
    });
    const edited = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal",
      body: "Remove the tracker in the footer, please.", supersedesId: shared.id,
    });
    expect(edited.visibility).toBe("shared");
    // ...and the other way round: an internal note cannot be republished.
    const internal = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "Third strike for this one.",
    });
    const reedited = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "shared", body: "Third strike.", supersedesId: internal.id,
    });
    expect(reedited.visibility).toBe("internal");
    expect((await candidateTrail(c.share.id)).map((k) => k.body)).toEqual([
      "Remove the tracker in the footer, please.",
    ]);
  });

  it("caps a very long body instead of storing a document", async () => {
    const c = await submittedSite();
    const note = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "x".repeat(COMMENT_BODY_MAX + 500),
    });
    expect(note.body).toHaveLength(COMMENT_BODY_MAX);
    expect(normalizeCommentBody(null)).toBe("");
    expect(normalizeCommentBody(42)).toBe("");
  });

  it("never UPDATEs or DELETEs the trail (source rule, not just behaviour)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../src/moderation.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/UPDATE\s+moderation_comments/i);
    expect(source).not.toMatch(/DELETE\s+FROM\s+moderation_comments/i);
  });
});

describe("what the candidate can see", () => {
  it("shows a shared message and NEVER an internal note (exact serialized object)", async () => {
    const c = await refused();
    await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal",
      body: "Third submission from this participant; watch it.",
    });
    const reply = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "shared",
      body: "Remove the tracker and share again.",
    });
    const thread = (await candidateThread(db, c.attemptId, c.participantId))!;
    expect(thread).toEqual({
      status: "rejected",
      rejectReason: "The site embeds a third-party tracker.",
      canReply: true,
      comments: [
        { id: reply.id, role: "reviewer", body: "Remove the tracker and share again.", at: reply.at },
      ],
    });
    const serialized = JSON.stringify(thread);
    for (const forbidden of [REVIEWER, "reviewer-1", "internal", "author", "watch it", "Third submission"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps the reviewer's identity out of the candidate's own share record too", async () => {
    const c = await refused();
    const result = await handleGetShare(ctx, as(c.user), c.attemptId);
    expect(result.status).toBe(200);
    const serialized = JSON.stringify(result.body);
    expect(serialized).toContain("The site embeds a third-party tracker.");
    for (const forbidden of [REVIEWER, "rejectedBy", "approvedBy"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("reaches only its OWN case: another participant's attempt is a 404", async () => {
    const mine = await refused();
    const theirs = await refused();
    expect((await handleCandidateThread(ctx, as(mine.user), theirs.attemptId)).status).toBe(404);
    expect((await handleCandidateReply(ctx, as(mine.user), theirs.attemptId, { body: "let me in" })).status).toBe(404);
    expect(await candidateTrail(theirs.share.id)).toEqual([]);
    expect((await handleCandidateThread(ctx, {}, mine.attemptId)).status).toBe(401);
    expect((await handleCandidateReply(ctx, {}, mine.attemptId, { body: "hi" })).status).toBe(401);
  });

  it("cannot write an internal note, however the request is shaped", async () => {
    const c = await refused();
    const posted = await handleCandidateReply(ctx, as(c.user), c.attemptId, {
      body: "It is my own analytics.",
      visibility: "internal",
      role: "reviewer",
      author: REVIEWER,
    });
    expect(posted.status).toBe(201);
    const trail = await reviewerTrail(c.share.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.visibility).toBe("shared");
    expect(trail[0]!.role).toBe("candidate");
    expect(trail[0]!.author).toBe(`participant:${c.participantId}`);
    // Their own message comes back without an author field either.
    expect(Object.keys(posted.body.comment as object).sort()).toEqual(["at", "body", "id", "role"]);
  });

  it("refuses a reply before there is any decision to respond to", async () => {
    const c = await submittedSite();
    const refusedReply = await handleCandidateReply(ctx, as(c.user), c.attemptId, { body: "hurry up" });
    expect(refusedReply.status).toBe(400);
    expect(await reviewerTrail(c.share.id)).toEqual([]);
  });

  it("takes turns: one response, then it is the moderator's move", async () => {
    const c = await refused();
    expect((await handleCandidateReply(ctx, as(c.user), c.attemptId, { body: "It is my own analytics." })).status).toBe(201);
    const second = await handleCandidateReply(ctx, as(c.user), c.attemptId, { body: "hello?" });
    expect(second.status).toBe(400);
    expect((await candidateThread(db, c.attemptId, c.participantId))!.canReply).toBe(false);
    // A moderator answers; the candidate may speak again.
    await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "shared", body: "It loads a third-party script.",
    });
    expect((await candidateThread(db, c.attemptId, c.participantId))!.canReply).toBe(true);
  });

  it("lets a candidate correct their own response without erasing the first try", async () => {
    const c = await refused();
    const first = await handleCandidateReply(ctx, as(c.user), c.attemptId, { body: "its my own anlytics" });
    const id = (first.body.comment as { id: number }).id;
    const fixed = await handleCandidateReply(ctx, as(c.user), c.attemptId, { body: "It is my own analytics.", supersedesId: id });
    expect(fixed.status).toBe(201);
    const trail = await reviewerTrail(c.share.id);
    expect(trail.map((k) => k.body)).toEqual(["its my own anlytics", "It is my own analytics."]);
    expect((await candidateTrail(c.share.id)).map((k) => k.body)).toEqual(["It is my own analytics."]);
  });

  it("cannot edit the moderator's message", async () => {
    const c = await refused();
    const theirs = await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "shared", body: "Remove the tracker.",
    });
    const attempt = await handleCandidateReply(ctx, as(c.user), c.attemptId, {
      body: "Actually it is fine.", supersedesId: theirs.id,
    });
    expect(attempt.status).toBe(400);
    expect((await candidateTrail(c.share.id)).map((k) => k.body)).toEqual(["Remove the tracker."]);
  });

  it("has no thread once the candidate revokes their own link", async () => {
    const c = await refused();
    await revokeShare(db, c.attemptId, c.participantId);
    expect((await handleCandidateThread(ctx, as(c.user), c.attemptId)).status).toBe(404);
  });
});

describe("the appeal path", () => {
  it("moves the CASE into the appeals lane and leaves the row refused", async () => {
    const c = await refused();
    await handleCandidateReply(ctx, as(c.user), c.attemptId, { body: "The script is my own, self-hosted." });
    const appeals = await listCases(db, parseCaseQuery({ lane: "appeals" }));
    expect(appeals.cases.map((k) => k.entry.id)).toEqual([c.share.id]);
    expect(appeals.cases[0]!.appealOpen).toBe(true);
    expect(appeals.cases[0]!.status).toBe("rejected");
    const { rows } = await db.query(
      "SELECT rejected_at, rejected_by, approved_at FROM share_links WHERE id = $1",
      [c.share.id],
    );
    expect(rows[0]!.rejected_at).not.toBeNull();
    expect(rows[0]!.approved_at).toBeNull();
  });

  it("closes the appeal when a moderator answers, without re-opening the decision", async () => {
    const c = await refused();
    await handleCandidateReply(ctx, as(c.user), c.attemptId, { body: "It is self-hosted." });
    await handleModerationComment(ctx, as("reviewer-2"), c.share.id, { body: "Checked: it is not.", visibility: "shared" }, ENV);
    const appeals = await listCases(db, parseCaseQuery({ lane: "appeals" }));
    expect(appeals.cases).toEqual([]);
    expect((await getCase(db, c.share.id))!.appealOpen).toBe(false);
  });

  it("an internal note does NOT close an appeal — the candidate was not answered", async () => {
    const c = await refused();
    await handleCandidateReply(ctx, as(c.user), c.attemptId, { body: "It is self-hosted." });
    await handleModerationComment(ctx, as("reviewer-2"), c.share.id, { body: "Second opinion?" }, ENV);
    expect((await listCases(db, parseCaseQuery({ lane: "appeals" }))).cases).toHaveLength(1);
  });

  it("keeps a refusal terminal: an appeal never makes the share approvable again", async () => {
    const c = await refused();
    await handleCandidateReply(ctx, as(c.user), c.attemptId, { body: "Please look again." });
    expect(await approveShare(db, c.share.id, OTHER_REVIEWER)).toEqual({ approved: false });
    const decision = await handleReviewDecision(ctx, as("reviewer-2"), { shareId: c.share.id, decision: "approve" }, ENV);
    expect(decision.status).toBe(404);
    expect((await getCase(db, c.share.id))!.status).toBe("rejected");
  });
});

describe("the case a moderator opens", () => {
  it("carries the submission, the decision, and the WHOLE trail", async () => {
    const c = await refused("The site embeds a third-party tracker.");
    await addComment(db, {
      shareId: c.share.id, author: REVIEWER, role: "reviewer", visibility: "internal", body: "Second opinion wanted.",
    });
    await handleCandidateReply(ctx, as(c.user), c.attemptId, { body: "It is self-hosted." });
    const result = await handleModerationCase(ctx, as("reviewer-2"), c.share.id, ENV);
    expect(result.status).toBe(200);
    const detail = result.body.case as Awaited<ReturnType<typeof getCase>>;
    expect(detail!.entry.payload.site).toMatch(/^\/api\/site\/sha256:/);
    expect(detail!.decidedBy).toBe(REVIEWER);
    expect(detail!.rejectReason).toBe("The site embeds a third-party tracker.");
    expect(detail!.trail.map((k) => [k.role, k.visibility, k.body])).toEqual([
      ["reviewer", "internal", "Second opinion wanted."],
      ["candidate", "shared", "It is self-hosted."],
    ]);
    expect(detail!.comments).toBe(2);
    expect(detail!.appealOpen).toBe(true);
  });

  it("defaults a moderator comment to INTERNAL — the safe default is unpublished", async () => {
    const c = await refused();
    const posted = await handleModerationComment(ctx, as("reviewer-1"), c.share.id, { body: "Borderline." }, ENV);
    expect(posted.status).toBe(201);
    expect((posted.body.comment as ModerationComment).visibility).toBe("internal");
    expect(await candidateTrail(c.share.id)).toEqual([]);
  });

  it("stamps the VERIFIED caller as the author, never a body field", async () => {
    const c = await refused();
    await handleModerationComment(
      ctx,
      as("reviewer-2"),
      c.share.id,
      { body: "Mine.", author: "dev:someone-else", authorRef: "dev:someone-else", role: "candidate" },
      ENV,
    );
    const trail = await reviewerTrail(c.share.id);
    expect(trail[0]!.author).toBe(OTHER_REVIEWER);
    expect(trail[0]!.role).toBe("reviewer");
  });

  it("refuses an empty moderator comment with 400, and writes nothing", async () => {
    const c = await refused();
    const posted = await handleModerationComment(ctx, as("reviewer-1"), c.share.id, { body: "   " }, ENV);
    expect(posted.status).toBe(400);
    expect(await reviewerTrail(c.share.id)).toEqual([]);
  });

  it("comments on a case with no decision yet — a note is not a decision", async () => {
    const c = await submittedSite();
    expect((await handleModerationComment(ctx, as("reviewer-1"), c.share.id, { body: "Opened it; slow." }, ENV)).status).toBe(201);
    expect((await getCase(db, c.share.id))!.status).toBe("submitted");
  });
});
