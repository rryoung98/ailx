/**
 * The moderation WIRE CONTRACT — the comment, case and lane shapes a browser
 * receives, plus the pure normalization of the query and of a comment body.
 *
 * Pure by construction: no database, no environment, no clock. The SQL
 * audience predicate that keeps an internal note internal, and every write,
 * stay server-side (`@ailx/backend` `moderation.ts`). What lives here is the
 * shape both sides must agree on — including the CANDIDATE shape, which has
 * no `author` field to forget to strip.
 */

import type { GalleryEntry } from "./gallery.js";
import type { ShareStatus } from "./share-url.js";
import { clampInt } from "./clamp.js";

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
