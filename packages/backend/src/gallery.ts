/**
 * The public gallery — the listed half of the share primitive (docs/SHARING.md).
 *
 * An unlisted share link is a capability. A GALLERY ENTRY is different in
 * kind: it is publicly listed, so spec §12's approval-required governance
 * applies. This module is the read side of that, plus the reviewer surface
 * that performs the approval.
 *
 * Three properties it exists to guarantee:
 *
 *  1. ONLY APPROVED, NON-REVOKED ROWS ARE LISTED. One SQL predicate,
 *     `approved_at IS NOT NULL AND revoked_at IS NULL`, defined once here and
 *     used by every read path. `submitted` is not listed; `revoked` is not
 *     listed, ever again.
 *  2. A SITE-CARRYING SHARE CANNOT REACH THE GALLERY WITHOUT A HUMAN. That is
 *     enforced upstream by `publishShare`, which reads the STORED
 *     `site_digest` column, never a request field. Nothing here can stamp an
 *     approval; only `approveShare` can, and only a reviewer reaches it.
 *  3. NO TOKEN IS RECOVERABLE. The database holds only sha256(token), so a
 *     gallery card cannot link back to /s/<token> even in principle. Each
 *     card is self-contained: the frozen payload, and the candidate's own
 *     site path when they opted in. That is a security property, not a gap.
 */

import { parseSharePayload, type SharePayload } from "@ailx/report";
import type { Queryable, QueryResultRow } from "./db.js";
import type { HeaderMap } from "./auth.js";
import { UNAUTHORIZED_RESULT, type ApiContext, type ApiResult } from "./handlers.js";
import { StoreError } from "./store.js";
import { approveShare } from "./share.js";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * One card. `id` is the share row's uuid: an opaque handle with NO capability
 * attached (reads key on the token digest, and the reviewer routes check the
 * caller, not the id), needed so the reviewer queue and the browse grid share
 * one shape.
 */
export interface GalleryEntry {
  id: string;
  /** ISO stamp the entry was listed at (approval), or submitted at (queue). */
  at: string;
  instrument: string;
  playerType: SharePayload["playerType"];
  band: SharePayload["band"];
  tracks: SharePayload["tracks"];
  /** The candidate's own T1 site path, or null. Same-origin by construction. */
  site: string | null;
  /** Who listed it: "auto:card" for a derived card, a human ref otherwise. */
  approvedBy: string | null;
}

/** Player-type facet, so the filter UI shows real counts and never a dead option. */
export interface GalleryFacet {
  code: string;
  name: string;
  count: number;
}

export interface GalleryQuery {
  /** Player-type code filter, e.g. "MSVD". */
  type: string | null;
  sort: GallerySort;
  /** Only entries that carry a built site. */
  withSite: boolean;
  limit: number;
  offset: number;
}

export const GALLERY_SORTS = ["recent", "oldest", "type"] as const;
export type GallerySort = (typeof GALLERY_SORTS)[number];

export interface GalleryListing {
  entries: GalleryEntry[];
  total: number;
  facets: GalleryFacet[];
  query: GalleryQuery;
}

/** Player-type codes are four letters, one per axis (@ailx/report AXES). */
export const PLAYER_TYPE_CODE_RE = /^[MP][ST][VA][DE]$/;

export const GALLERY_PAGE_SIZE = 24;
export const GALLERY_MAX_PAGE_SIZE = 48;

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

/**
 * Normalize untrusted query input ONCE — the page and any JSON caller share
 * this, so a hostile `limit=1e9`, a negative offset or an injected sort key
 * cannot exist past this function.
 */
export function parseGalleryQuery(raw: Record<string, string | undefined> = {}): GalleryQuery {
  const type = raw.type !== undefined && PLAYER_TYPE_CODE_RE.test(raw.type) ? raw.type : null;
  const sort = (GALLERY_SORTS as readonly string[]).includes(raw.sort ?? "")
    ? (raw.sort as GallerySort)
    : "recent";
  return {
    type,
    sort,
    withSite: raw.site === "1",
    limit: clampInt(raw.limit, 1, GALLERY_MAX_PAGE_SIZE, GALLERY_PAGE_SIZE),
    offset: clampInt(raw.offset, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** THE listing predicate. Approved, and not revoked. Defined once. */
const LISTED = "s.approved_at IS NOT NULL AND s.revoked_at IS NULL";

/** Pending human review: submitted, not yet approved, not revoked. */
const PENDING = "s.submitted_at IS NOT NULL AND s.approved_at IS NULL AND s.revoked_at IS NULL";

/**
 * ORDER BY fragments, keyed by a validated union — never interpolated from a
 * request string. `type` sorts by code then recency so the grid reads as
 * groups rather than as noise.
 */
const ORDER: Record<GallerySort, string> = {
  recent: "s.approved_at DESC, s.id",
  oldest: "s.approved_at ASC, s.id",
  type: "s.payload->'playerType'->>'code' ASC, s.approved_at DESC, s.id",
};

function entryFrom(row: QueryResultRow, at: unknown): GalleryEntry | null {
  const payload = parseSharePayload(
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
  );
  if (payload === null) return null;
  return {
    id: row.id as string,
    at: new Date(at as string | Date).toISOString(),
    instrument: payload.instrument,
    playerType: payload.playerType,
    band: payload.band,
    tracks: payload.tracks,
    site: payload.site,
    approvedBy: (row.approved_by as string | null) ?? null,
  };
}

/**
 * Browse the gallery. Unauthenticated by design — this is the public wall.
 * Rows whose stored payload no longer parses are dropped rather than served
 * half-read (same rule as the share view).
 */
export async function listGallery(
  db: Queryable,
  query: GalleryQuery = parseGalleryQuery(),
): Promise<GalleryListing> {
  const where = [LISTED];
  const params: unknown[] = [];
  if (query.type !== null) {
    params.push(query.type);
    where.push(`s.payload->'playerType'->>'code' = $${params.length}`);
  }
  if (query.withSite) where.push("s.site_digest IS NOT NULL");
  const filter = where.join(" AND ");

  params.push(query.limit, query.offset);
  const { rows } = await db.query(
    `SELECT s.id, s.payload, s.approved_at, s.approved_by
       FROM share_links s
      WHERE ${filter}
      ORDER BY ${ORDER[query.sort]}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const counted = await db.query(
    `SELECT count(*) AS n FROM share_links s WHERE ${filter}`,
    params.slice(0, params.length - 2),
  );
  const entries = rows
    .map((r) => entryFrom(r, r.approved_at))
    .filter((e): e is GalleryEntry => e !== null);
  return {
    entries,
    total: Number(counted.rows[0]?.n ?? 0),
    facets: await galleryFacets(db),
    query,
  };
}

/**
 * Player-type counts over the WHOLE listed gallery (not the current page), so
 * a filter chip shows how much is behind it. Public aggregate over publicly
 * listed entries — nothing here is derived from an unlisted share.
 */
export async function galleryFacets(db: Queryable): Promise<GalleryFacet[]> {
  const { rows } = await db.query(
    `SELECT s.payload->'playerType'->>'code' AS code,
            min(s.payload->'playerType'->>'name') AS name,
            count(*) AS n
       FROM share_links s
      WHERE ${LISTED}
      GROUP BY 1
      ORDER BY 3 DESC, 1 ASC`,
  );
  return rows
    .filter((r) => typeof r.code === "string" && PLAYER_TYPE_CODE_RE.test(r.code as string))
    .map((r) => ({ code: r.code as string, name: (r.name as string) ?? "", count: Number(r.n) }));
}

/**
 * The review queue: site-carrying shares waiting on a human. By construction
 * every row here has `site_digest IS NOT NULL` (a card auto-publishes in the
 * same statement it is submitted), and the filter is asserted anyway so a
 * card can never appear as if it needed review.
 */
export async function listSubmissions(db: Queryable, limit = GALLERY_MAX_PAGE_SIZE): Promise<GalleryEntry[]> {
  const { rows } = await db.query(
    `SELECT s.id, s.payload, s.submitted_at, s.approved_by
       FROM share_links s
      WHERE ${PENDING} AND s.site_digest IS NOT NULL
      ORDER BY s.submitted_at ASC, s.id
      LIMIT $1`,
    [clampInt(limit, 1, GALLERY_MAX_PAGE_SIZE, GALLERY_MAX_PAGE_SIZE)],
  );
  return rows
    .map((r) => entryFrom(r, r.submitted_at))
    .filter((e): e is GalleryEntry => e !== null);
}

/**
 * REVIEWER action: refuse a submission. The schema has no "rejected" stamp
 * and this module does not add one — the only reason to refuse a
 * site-carrying share is the hosted content itself, and in that case we must
 * stop serving it at all, so refusal revokes. The row is never deleted (it is
 * the audit trail), and the candidate can create a new share without the site.
 */
export async function rejectSubmission(db: Queryable, shareId: string): Promise<{ rejected: boolean }> {
  const { rows } = await db.query(
    `UPDATE share_links s SET revoked_at = now()
      WHERE s.id = $1 AND ${PENDING} RETURNING s.id`,
    [shareId],
  );
  return { rejected: rows.length > 0 };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** GET /gallery data — public, unauthenticated, no per-person field in it. */
export async function handleListGallery(
  ctx: ApiContext,
  raw: Record<string, string | undefined> = {},
): Promise<ApiResult> {
  const listing = await listGallery(ctx.db, parseGalleryQuery(raw));
  return { status: 200, body: { gallery: listing } };
}

/** Reviewer-only: the pending queue. */
export async function handleReviewQueue(
  ctx: ApiContext,
  headers: HeaderMap,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<ApiResult> {
  return withReviewer(ctx, headers, env, async () => ({
    status: 200,
    body: { submissions: await listSubmissions(ctx.db) },
  }));
}

export const REVIEW_DECISIONS = ["approve", "reject"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * Reviewer-only: decide one submission. The approver reference is the
 * VERIFIED caller identity, never a body field — "who approved this" has to
 * be a fact about the session, not a claim in the request.
 */
export async function handleReviewDecision(
  ctx: ApiContext,
  headers: HeaderMap,
  body: unknown,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<ApiResult> {
  return withReviewer(ctx, headers, env, async (reviewer) => {
    const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const shareId = typeof b.shareId === "string" ? b.shareId : "";
    const decision = b.decision;
    if (!UUID_RE.test(shareId) || typeof decision !== "string" || !(REVIEW_DECISIONS as readonly string[]).includes(decision)) {
      return {
        status: 400,
        body: { error: { code: "bad_request", message: "shareId (uuid) and decision (approve|reject) are required" } },
      };
    }
    try {
      const result =
        decision === "approve"
          ? await approveShare(ctx.db, shareId, reviewer)
          : await rejectSubmission(ctx.db, shareId);
      const done = "approved" in result ? result.approved : result.rejected;
      if (!done) {
        return {
          status: 404,
          body: { error: { code: "not_found", message: "no submission is waiting on that id" } },
        };
      }
      return { status: 200, body: { decision, shareId, reviewer } };
    } catch (err) {
      if (err instanceof StoreError) {
        return { status: 400, body: { error: { code: err.code, message: err.message } } };
      }
      throw err;
    }
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Reviewer access
// ---------------------------------------------------------------------------

/**
 * Reviewer allowlist. There is deliberately NO staff/roles table: this repo
 * has one privileged action (stamp a human approval on a hosted site), and a
 * database-backed RBAC system for one verb is exactly the speculative
 * complexity AGENTS.md forbids. `AILX_REVIEWERS` is a comma/whitespace list
 * of AuthProvider refs — the same `clerk:<sub>` / `dev:<id>` strings stored in
 * participants.auth_ref — so a reviewer is named in deployment configuration
 * and revoked by a redeploy.
 *
 * Fail closed: unset or empty means NOBODY is a reviewer, and no wildcard is
 * accepted at any position. If reviewing ever needs delegation, rotation or an
 * audit of who held the role when, replace this with a real table — the seam
 * is `isReviewer`.
 */
export const REVIEWERS_ENV = "AILX_REVIEWERS";

export function reviewerRefs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReadonlySet<string> {
  return new Set(
    (env[REVIEWERS_ENV] ?? "")
      .split(/[\s,]+/)
      .map((ref) => ref.trim())
      // A wildcard would silently turn the allowlist into "everyone".
      .filter((ref) => ref.length > 0 && ref !== "*"),
  );
}

export function isReviewer(
  authRef: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (typeof authRef !== "string" || authRef === "") return false;
  return reviewerRefs(env).has(authRef);
}

export const FORBIDDEN_RESULT: ApiResult = {
  status: 403,
  body: { error: { code: "forbidden", message: "reviewer access required" } },
};

/**
 * Auth + allowlist, server-side, for every reviewer surface. Note the order:
 * an anonymous caller gets 401 and a signed-in non-reviewer gets 403 — the
 * queue's existence is not a secret, its contents are.
 */
export async function withReviewer(
  ctx: ApiContext,
  headers: HeaderMap,
  env: Readonly<Record<string, string | undefined>> | undefined,
  fn: (reviewer: string) => Promise<ApiResult>,
): Promise<ApiResult> {
  const identity = await ctx.auth.verify(headers);
  if (identity === null) return UNAUTHORIZED_RESULT;
  if (!isReviewer(identity.authRef, env ?? process.env)) return FORBIDDEN_RESULT;
  return fn(identity.authRef);
}
