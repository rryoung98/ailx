/**
 * The moderation trail — the conversation around a gallery decision
 * (docs/SHARING.md §7.6).
 *
 * `gallery.ts` decides. This module records what was SAID, by whom, to whom,
 * and keeps that record impossible to rewrite. Four properties it exists to
 * guarantee:
 *
 *  1. APPEND-ONLY. Every write is an INSERT. An edit inserts a row pointing
 *     at the row it replaces (`supersedes_id`); a retraction inserts an empty
 *     row the same way. Nothing here ever runs UPDATE or DELETE, and a unique
 *     index makes the chain a chain rather than a fork.
 *  2. INTERNAL NOTES STAY INTERNAL. `visibility = 'internal'` is filtered in
 *     SQL, in ONE predicate, on the audience — not hidden by a renderer, and
 *     not filtered after being loaded next to candidate data. A candidate can
 *     never write one either (schema CHECK, re-asserted here).
 *  3. THE REVIEWER'S IDENTITY NEVER REACHES THE CANDIDATE. Same posture as a
 *     refusal, whose reason is shown verbatim and whose reviewer is not: the
 *     candidate-audience shape has no field that could carry `author_ref`, so
 *     leaking it would take a new field, not a forgotten redaction.
 *  4. A REFUSAL STAYS TERMINAL. The appeal path moves a CASE back into a
 *     moderator's lane; it never moves the ROW's state. `rejected_at` is
 *     never cleared and an approval after a refusal is impossible (schema
 *     CHECK `share_links_one_decision`).
 */

import type { Queryable, QueryResultRow } from "./db.js";
import type { HeaderMap } from "./auth.js";
import { withParticipant, type ApiContext, type ApiResult } from "./handlers.js";
import { StoreError } from "./store.js";
import { getShareForAttempt, shareStatus, type ShareRecord } from "./share.js";
import type { ShareStatus } from "./share-url.js";
import {
  PENDING_SUBMISSION,
  galleryEntryFrom,
  withReviewer,
  type GalleryEntry,
} from "./gallery.js";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export const COMMENT_ROLES = ["reviewer", "candidate"] as const;
export type CommentRole = (typeof COMMENT_ROLES)[number];

export const COMMENT_VISIBILITIES = ["internal", "shared"] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

/** Who a serialized trail is being built for. Decides the SQL, not the CSS. */
export type CommentAudience = "reviewer" | "candidate";

/** Longest comment body stored. A note, a reply — not a document. */
export const COMMENT_BODY_MAX = 2000;

/**
 * One comment, as a MODERATOR sees it: the whole trail, superseded rows
 * included, each naming its author.
 */
export interface ModerationComment {
  id: number;
  role: CommentRole;
  visibility: CommentVisibility;
  /** The verified author reference. Reviewer audience only — see below. */
  author: string;
  body: string;
  at: string;
  /** The row this one replaces, or null. */
  supersedesId: number | null;
  /** False once a later row replaced this one: the trail keeps both. */
  current: boolean;
  /** A current row with an empty body: withdrawn, on the record. */
  retracted: boolean;
}

/**
 * One comment as the CANDIDATE sees it. A separate shape, deliberately: there
 * is no `author` and no `visibility` field to forget to strip, so the
 * reviewer's identity cannot leak by omission — only by someone adding a
 * field, which the tests would catch.
 */
export interface CandidateComment {
  id: number;
  /** "reviewer" (an unnamed AILX reviewer) or "candidate" (their own words). */
  role: CommentRole;
  body: string;
  at: string;
}

/** A moderation case: one share row, its decision, and its trail. */
export interface ModerationCase {
  entry: GalleryEntry;
  status: ShareStatus;
  submittedAt: string | null;
  decidedAt: string | null;
  /** The human (or "auto:card") behind the decision. Moderator-visible. */
  decidedBy: string | null;
  rejectReason: string | null;
  /** True while the candidate has spoken last on a refused case. */
  appealOpen: boolean;
  comments: number;
}

export interface ModerationCaseDetail extends ModerationCase {
  trail: ModerationComment[];
}

export const CASE_LANES = ["pending", "appeals", "decided"] as const;
export type CaseLane = (typeof CASE_LANES)[number];

export const CASE_PAGE_SIZE = 25;
export const CASE_MAX_PAGE_SIZE = 100;

export interface CaseQuery {
  lane: CaseLane;
  /** Include the auto-published cards in the history (off: human decisions). */
  includeAuto: boolean;
  limit: number;
  offset: number;
}

export interface CaseListing {
  cases: ModerationCase[];
  total: number;
  query: CaseQuery;
  /** Lane sizes, so the dashboard shows what is waiting without a click. */
  counts: Record<CaseLane, number>;
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

/** Normalize untrusted query input once — page and JSON caller share it. */
export function parseCaseQuery(raw: Record<string, string | undefined> = {}): CaseQuery {
  return {
    lane: (CASE_LANES as readonly string[]).includes(raw.lane ?? "")
      ? (raw.lane as CaseLane)
      : "pending",
    includeAuto: raw.auto === "1",
    limit: clampInt(raw.limit, 1, CASE_MAX_PAGE_SIZE, CASE_PAGE_SIZE),
    offset: clampInt(raw.offset, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/**
 * Normalize a body the same way everywhere: CRLF flattened, trailing space
 * dropped, runs of blank lines collapsed, length capped. An empty result is
 * a RETRACTION when it replaces a row and a refused write when it does not.
 */
export function normalizeCommentBody(body: unknown): string {
  if (typeof body !== "string") return "";
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, COMMENT_BODY_MAX);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * THE audience predicate. A candidate-audience read never loads an internal
 * row at all, so no serializer is trusted to drop it.
 */
const VISIBLE_TO: Record<CommentAudience, string> = {
  reviewer: "TRUE",
  candidate: "c.visibility = 'shared'",
};

/** A row nothing later replaced: the CURRENT state of one comment chain. */
const CURRENT = "NOT EXISTS (SELECT 1 FROM moderation_comments n WHERE n.supersedes_id = c.id)";

function commentFrom(row: QueryResultRow): ModerationComment {
  const body = (row.body as string) ?? "";
  const current = row.current === true;
  return {
    id: Number(row.id),
    role: row.author_role as CommentRole,
    visibility: row.visibility as CommentVisibility,
    author: row.author_ref as string,
    body,
    at: new Date(row.created_at as string | Date).toISOString(),
    supersedesId: row.supersedes_id === null || row.supersedes_id === undefined ? null : Number(row.supersedes_id),
    current,
    retracted: current && body === "",
  };
}

/**
 * The trail for one case.
 *
 * A MODERATOR gets everything, superseded rows included — that is the audit.
 * A CANDIDATE gets the current state of the SHARED rows only: internal notes
 * are excluded in SQL, a retracted message is gone rather than shown as a
 * gap, and the returned objects have no author field at all.
 */
export async function listComments(
  db: Queryable,
  shareId: string,
  audience: CommentAudience,
): Promise<ModerationComment[] | CandidateComment[]> {
  const { rows } = await db.query(
    `SELECT c.id, c.author_ref, c.author_role, c.visibility, c.body, c.supersedes_id,
            c.created_at, ${CURRENT} AS current
       FROM moderation_comments c
      WHERE c.share_id = $1 AND ${VISIBLE_TO[audience]}
      ORDER BY c.id`,
    [shareId],
  );
  const all = rows.map(commentFrom);
  if (audience === "reviewer") return all;
  return all
    .filter((c) => c.current && c.body !== "")
    .map(({ id, role, body, at }) => ({ id, role, body, at }));
}

const CASE_COLUMNS = `s.id, s.token, s.payload, s.submitted_at, s.approved_at, s.approved_by,
       s.rejected_at, s.rejected_by, s.reject_reason, s.revoked_at,
       (SELECT count(*) FROM moderation_comments c WHERE c.share_id = s.id) AS comments,
       (SELECT max(c.id) FROM moderation_comments c
         WHERE c.share_id = s.id AND c.author_role = 'candidate') AS last_candidate,
       (SELECT max(c.id) FROM moderation_comments c
         WHERE c.share_id = s.id AND c.author_role = 'reviewer'
           AND c.visibility = 'shared') AS last_reply`;

/**
 * A candidate has spoken last: the case is waiting on a moderator. On a
 * REFUSED case that is exactly the appeal (docs/SHARING.md §7.6) — the row
 * stays refused, but the case comes back into a lane somebody works.
 */
const AWAITING_REPLY = `(SELECT max(c.id) FROM moderation_comments c
     WHERE c.share_id = s.id AND c.author_role = 'candidate')
   > coalesce((SELECT max(c.id) FROM moderation_comments c
     WHERE c.share_id = s.id AND c.author_role = 'reviewer' AND c.visibility = 'shared'), 0)`;

const APPEAL = `s.rejected_at IS NOT NULL AND ${AWAITING_REPLY}`;

/** Human decisions only, unless the caller asks for the auto-published flood. */
const DECIDED = "(s.approved_at IS NOT NULL OR s.rejected_at IS NOT NULL)";
const HUMAN = "coalesce(s.approved_by, '') <> 'auto:card'";

function laneFilter(lane: CaseLane, includeAuto: boolean): string {
  if (lane === "pending") return `${PENDING_SUBMISSION} AND s.site_digest IS NOT NULL`;
  if (lane === "appeals") return APPEAL;
  return includeAuto ? DECIDED : `${DECIDED} AND ${HUMAN}`;
}

/** Newest first for history; oldest first for work queues (fair ordering). */
const LANE_ORDER: Record<CaseLane, string> = {
  pending: "s.submitted_at ASC, s.id",
  appeals: "s.rejected_at ASC, s.id",
  decided: "coalesce(s.approved_at, s.rejected_at) DESC, s.id",
};

function caseFrom(row: QueryResultRow): ModerationCase | null {
  const stamps = {
    revokedAt: row.revoked_at === null || row.revoked_at === undefined ? null : String(row.revoked_at),
    approvedAt: row.approved_at === null || row.approved_at === undefined ? null : String(row.approved_at),
    rejectedAt: row.rejected_at === null || row.rejected_at === undefined ? null : String(row.rejected_at),
    submittedAt: row.submitted_at === null || row.submitted_at === undefined ? null : String(row.submitted_at),
  };
  const decidedAt = row.approved_at ?? row.rejected_at ?? null;
  const entry = galleryEntryFrom(row, row.submitted_at ?? row.approved_at ?? row.rejected_at);
  if (entry === null) return null;
  const lastCandidate = row.last_candidate === null || row.last_candidate === undefined ? 0 : Number(row.last_candidate);
  const lastReply = row.last_reply === null || row.last_reply === undefined ? 0 : Number(row.last_reply);
  return {
    entry,
    status: shareStatus(stamps),
    submittedAt: stamps.submittedAt === null ? null : new Date(stamps.submittedAt).toISOString(),
    decidedAt: decidedAt === null ? null : new Date(decidedAt as string | Date).toISOString(),
    decidedBy: (row.approved_by as string | null) ?? (row.rejected_by as string | null) ?? null,
    rejectReason: (row.reject_reason as string | null) ?? null,
    appealOpen: stamps.rejectedAt !== null && lastCandidate > lastReply,
    comments: Number(row.comments ?? 0),
  };
}

/** One lane of the dashboard, plus every lane's size. Moderator-only data. */
export async function listCases(
  db: Queryable,
  query: CaseQuery = parseCaseQuery(),
): Promise<CaseListing> {
  const filter = laneFilter(query.lane, query.includeAuto);
  const { rows } = await db.query(
    `SELECT ${CASE_COLUMNS} FROM share_links s
      WHERE ${filter} ORDER BY ${LANE_ORDER[query.lane]} LIMIT $1 OFFSET $2`,
    [query.limit, query.offset],
  );
  const counted = await db.query(
    `SELECT count(*) FILTER (WHERE ${laneFilter("pending", false)}) AS pending,
            count(*) FILTER (WHERE ${laneFilter("appeals", false)}) AS appeals,
            count(*) FILTER (WHERE ${laneFilter("decided", query.includeAuto)}) AS decided
       FROM share_links s`,
  );
  const counts = counted.rows[0] ?? {};
  return {
    cases: rows.map(caseFrom).filter((c): c is ModerationCase => c !== null),
    total: Number(counts[query.lane] ?? 0),
    query,
    counts: {
      pending: Number(counts.pending ?? 0),
      appeals: Number(counts.appeals ?? 0),
      decided: Number(counts.decided ?? 0),
    },
  };
}

/** Does this share row exist at all? (A comment must not FK-fail into a 500.) */
export async function caseExists(db: Queryable, shareId: string): Promise<boolean> {
  if (!UUID_RE.test(shareId)) return false;
  const { rows } = await db.query("SELECT 1 FROM share_links WHERE id = $1", [shareId]);
  return rows.length > 0;
}

/** One case with its whole trail. Moderator audience — never a candidate's. */
export async function getCase(db: Queryable, shareId: string): Promise<ModerationCaseDetail | null> {
  if (!UUID_RE.test(shareId)) return null;
  const { rows } = await db.query(`SELECT ${CASE_COLUMNS} FROM share_links s WHERE s.id = $1`, [shareId]);
  if (rows.length === 0) return null;
  const base = caseFrom(rows[0]!);
  if (base === null) return null;
  const trail = (await listComments(db, shareId, "reviewer")) as ModerationComment[];
  return { ...base, trail };
}

// ---------------------------------------------------------------------------
// Writes — inserts, always
// ---------------------------------------------------------------------------

export interface CommentInput {
  shareId: string;
  /** The VERIFIED caller. Never a request field. */
  author: string;
  role: CommentRole;
  visibility: CommentVisibility;
  body: string;
  /** The comment this one replaces (same author, same case), or null. */
  supersedesId?: number | null;
}

interface PriorRow {
  id: number;
  author: string;
  shareId: string;
  visibility: CommentVisibility;
}

async function priorComment(db: Queryable, id: number): Promise<PriorRow | null> {
  const { rows } = await db.query(
    "SELECT id, author_ref, share_id, visibility FROM moderation_comments WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: Number(row.id),
    author: row.author_ref as string,
    shareId: row.share_id as string,
    visibility: row.visibility as CommentVisibility,
  };
}

/**
 * Append one comment.
 *
 * Everything about "who" is a fact about the session, never a claim in the
 * request. Editing and retracting are INSERTS that name the row they replace;
 * the replaced row is left exactly as written, and its VISIBILITY is
 * inherited rather than re-supplied — a message the candidate has already
 * read cannot be edited into an internal note (nor an internal note quietly
 * republished to them).
 */
export async function addComment(db: Queryable, input: CommentInput): Promise<ModerationComment> {
  const author = input.author.trim();
  if (author === "") throw new StoreError("bad_request", "a verified author reference is required");
  if (!UUID_RE.test(input.shareId)) throw new StoreError("not_found", "no such moderation case");
  if (!COMMENT_ROLES.includes(input.role)) throw new StoreError("bad_request", "unknown author role");
  if (input.role === "candidate" && input.visibility !== "shared") {
    throw new StoreError("bad_request", "a candidate cannot write an internal note");
  }

  const body = normalizeCommentBody(input.body);
  const supersedesId = input.supersedesId ?? null;
  let visibility = input.visibility;

  if (supersedesId !== null) {
    const prior = await priorComment(db, supersedesId);
    if (prior === null || prior.shareId !== input.shareId) {
      throw new StoreError("not_found", "no such comment on this case");
    }
    // Only the author may replace their own words — a moderator cannot edit a
    // candidate's message, and vice versa.
    if (prior.author !== author) {
      throw new StoreError("bad_request", "only the author of a comment can replace it");
    }
    visibility = prior.visibility;
  } else if (body === "") {
    throw new StoreError("bad_request", "a comment needs something in it");
  }

  const { rows } = await db.query(
    `INSERT INTO moderation_comments (share_id, author_ref, author_role, visibility, body, supersedes_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, author_ref, author_role, visibility, body, supersedes_id, created_at, TRUE AS current`,
    [input.shareId, author, input.role, visibility, body, supersedesId],
  );
  return commentFrom(rows[0]!);
}

// ---------------------------------------------------------------------------
// Candidate side — their own case only
// ---------------------------------------------------------------------------

/**
 * The candidate's view of the decision on their own share, resolved from the
 * ATTEMPT they own: `getShareForAttempt` re-checks ownership, so there is no
 * id a stranger could pass to reach somebody else's case.
 */
export interface CandidateThread {
  status: ShareStatus;
  rejectReason: string | null;
  /** True when they may write now (see `candidateMayReply`). */
  canReply: boolean;
  comments: CandidateComment[];
}

/**
 * May the candidate write?
 *
 * Only about a DECIDED case (there is nothing to respond to before), and only
 * when a moderator has answered their last message. Turn-taking is the same
 * principle that makes a refusal terminal: a candidate may put their case,
 * once, and may not grind a reviewer down by repetition.
 */
export function candidateMayReply(
  status: ShareStatus,
  comments: readonly CandidateComment[],
): boolean {
  if (status !== "rejected" && status !== "published") return false;
  const last = comments[comments.length - 1];
  return last === undefined || last.role === "reviewer";
}

/** The candidate-audience thread for a share already proven to be theirs. */
async function threadFor(db: Queryable, share: ShareRecord): Promise<CandidateThread> {
  const comments = (await listComments(db, share.id, "candidate")) as CandidateComment[];
  return {
    status: share.status,
    rejectReason: share.rejectReason,
    canReply: candidateMayReply(share.status, comments),
    comments,
  };
}

export async function candidateThread(
  db: Queryable,
  attemptId: string,
  participantId: string,
): Promise<CandidateThread | null> {
  const share = await getShareForAttempt(db, attemptId, participantId);
  return share === null ? null : threadFor(db, share);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const badRequest = (message: string): ApiResult => ({
  status: 400,
  body: { error: { code: "bad_request", message } },
});

const notFound = (message: string): ApiResult => ({
  status: 404,
  body: { error: { code: "not_found", message } },
});

/** Map a StoreError onto a status once, for every handler in this module. */
async function guarded(fn: () => Promise<ApiResult>): Promise<ApiResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StoreError) {
      return err.code === "not_found" ? notFound(err.message) : badRequest(err.message);
    }
    throw err;
  }
}

/** MODERATOR: the dashboard lanes. */
export async function handleModerationCases(
  ctx: ApiContext,
  headers: HeaderMap,
  raw: Record<string, string | undefined> = {},
  env?: Readonly<Record<string, string | undefined>>,
): Promise<ApiResult> {
  return withReviewer(ctx, headers, env, async () => ({
    status: 200,
    body: { listing: await listCases(ctx.db, parseCaseQuery(raw)) },
  }));
}

/** MODERATOR: one case and its whole trail. */
export async function handleModerationCase(
  ctx: ApiContext,
  headers: HeaderMap,
  shareId: string,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<ApiResult> {
  return withReviewer(ctx, headers, env, async () => {
    const detail = await getCase(ctx.db, shareId);
    if (detail === null) return notFound("no such moderation case");
    return { status: 200, body: { case: detail } };
  });
}

/**
 * MODERATOR: leave a note or answer the candidate — body:
 * { body, visibility?: "internal" | "shared", supersedesId?: number }.
 * `visibility` defaults to `internal`: the safe default is the one that does
 * not publish a half-written thought to the person being judged.
 */
export async function handleModerationComment(
  ctx: ApiContext,
  headers: HeaderMap,
  shareId: string,
  body: unknown,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<ApiResult> {
  return withReviewer(ctx, headers, env, async (reviewer) =>
    guarded(async () => {
      const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
      const visibility = b.visibility === "shared" ? "shared" : "internal";
      const supersedesId =
        typeof b.supersedesId === "number" && Number.isSafeInteger(b.supersedesId)
          ? b.supersedesId
          : null;
      if (!(await caseExists(ctx.db, shareId))) return notFound("no such moderation case");
      const comment = await addComment(ctx.db, {
        shareId,
        author: reviewer,
        role: "reviewer",
        visibility,
        body: typeof b.body === "string" ? b.body : "",
        supersedesId,
      });
      return { status: 201, body: { comment } };
    }),
  );
}

/** CANDIDATE: read the decision on their own attempt's share, and the thread. */
export async function handleCandidateThread(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => {
    const thread = await candidateThread(ctx.db, attemptId, participantId);
    if (thread === null) return notFound("no live share link");
    return { status: 200, body: { thread } };
  });
}

/**
 * CANDIDATE: respond to the decision on their OWN submission — body:
 * { body, supersedesId? }.
 *
 * On a refused case this is the APPEAL: the row stays refused (a refusal is
 * terminal, docs/SHARING.md §7.3), and what moves is the CASE, into the
 * moderators' appeals lane.
 */
export async function handleCandidateReply(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
  body: unknown,
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) =>
    guarded(async () => {
      const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
      const share = await getShareForAttempt(ctx.db, attemptId, participantId);
      if (share === null) return notFound("no live share link");
      const thread = await threadFor(ctx.db, share);
      const supersedesId =
        typeof b.supersedesId === "number" && Number.isSafeInteger(b.supersedesId)
          ? b.supersedesId
          : null;
      // An edit of their own message is always allowed; a NEW message obeys
      // turn-taking, which is what stops a refusal being ground down.
      if (supersedesId === null && !thread.canReply) {
        return badRequest(
          thread.status === "rejected" || thread.status === "published"
            ? "you have already responded — a moderator will read it"
            : "there is no decision on this share to respond to yet",
        );
      }
      const comment = await addComment(ctx.db, {
        shareId: share.id,
        author: `participant:${participantId}`,
        role: "candidate",
        visibility: "shared",
        body: typeof b.body === "string" ? b.body : "",
        supersedesId,
      });
      // Serialized to the candidate's own audience shape: even their own
      // message goes back without an author field.
      const { id, role, body: text, at } = comment;
      return { status: 201, body: { comment: { id, role, body: text, at } } };
    }),
  );
}
