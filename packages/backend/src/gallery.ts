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
 *  3. A LISTED CARD LINKS TO ITS OWN SHARE VIEW. The token is stored
 *     (docs/SHARING.md §2), so an entry carries it and the tile links to
 *     /s/<token>. That is safe precisely because the entry is LISTED: its
 *     owner published it, the view serves the same frozen payload the tile
 *     already shows, and revocation kills both in the same statement. An
 *     unlisted or refused share is never returned by anything here.
 */

import { parseSharePayload, type SharePayload } from "@ailx/report";
import type { Queryable, QueryResultRow } from "./db.js";
import type { HeaderMap } from "./auth.js";
import { UNAUTHORIZED_RESULT, type ApiContext, type ApiResult } from "./handlers.js";
import { StoreError } from "./store.js";
import { PUBLICLY_SERVED, approveShare } from "./share.js";

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
  /** Capability token of the LISTED share, so the tile links to its view. */
  token: string;
  /** ISO stamp the entry was listed at (approval), or submitted at (queue). */
  at: string;
  /**
   * The share's own FROZEN payload, carried whole rather than re-copied field
   * by field. A gallery tile and a share view must show the same thing, and a
   * new opt-in section must not need a second allowlist here to appear.
   */
  payload: SharePayload;
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

/**
 * THE listing predicate: approved, on top of the shared "may be served at all"
 * rule (`PUBLICLY_SERVED` — not revoked by its owner, not refused by a
 * reviewer). Defined once, composed from one source of truth.
 */
const LISTED = `s.approved_at IS NOT NULL AND ${PUBLICLY_SERVED}`;

/**
 * Pending human review: submitted, undecided, and still servable. Exported
 * because the moderation dashboard's "pending" lane IS this queue — one
 * definition, so the two surfaces cannot disagree about what is waiting.
 */
export const PENDING_SUBMISSION = `s.submitted_at IS NOT NULL AND s.approved_at IS NULL AND ${PUBLICLY_SERVED}`;
const PENDING = PENDING_SUBMISSION;

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

/**
 * Row -> entry. Shared with the moderation dashboard (moderation.ts), which
 * shows the same card the reviewer queue and the public wall show — a case
 * and a tile must never render from two different mappings.
 */
export function galleryEntryFrom(row: QueryResultRow, at: unknown): GalleryEntry | null {
  const payload = parseSharePayload(
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
  );
  if (payload === null) return null;
  return {
    id: row.id as string,
    token: row.token as string,
    at: new Date(at as string | Date).toISOString(),
    payload,
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
    `SELECT s.id, s.token, s.payload, s.approved_at, s.approved_by
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
    .map((r) => galleryEntryFrom(r, r.approved_at))
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
    `SELECT s.id, s.token, s.payload, s.submitted_at, s.approved_by
       FROM share_links s
      WHERE ${PENDING} AND s.site_digest IS NOT NULL
      ORDER BY s.submitted_at ASC, s.id
      LIMIT $1`,
    [clampInt(limit, 1, GALLERY_MAX_PAGE_SIZE, GALLERY_MAX_PAGE_SIZE)],
  );
  return rows
    .map((r) => galleryEntryFrom(r, r.submitted_at))
    .filter((e): e is GalleryEntry => e !== null);
}

/** Longest refusal reason stored. Long enough to be useful, not a document. */
export const REJECT_REASON_MAX = 500;

/**
 * REVIEWER action: refuse a submission, ON THE RECORD.
 *
 * Refusal used to revoke, which stopped the serving but recorded nothing: the
 * schema said who APPROVED and never who refused, or why. It now stamps
 * `rejected_at`, `rejected_by` and `reject_reason` together (a schema CHECK
 * enforces all-three-or-none), which is append-only in the same sense as every
 * other stamp here — a new monotone state, never a destructive edit, and the
 * row is never deleted.
 *
 * A refused share stops being served publicly (it fails `PUBLICLY_SERVED`, so
 * the gallery, the share view and the OG image all 404) but stays visible to
 * its OWNER, because the point of recording a reason is that the candidate
 * gets to read it. They can then revoke and share again without the site.
 */
export async function rejectSubmission(
  db: Queryable,
  shareId: string,
  reviewer: string,
  reason: string,
): Promise<{ rejected: boolean }> {
  const who = reviewer.trim();
  const why = reason.replace(/\s+/g, " ").trim().slice(0, REJECT_REASON_MAX);
  if (who === "") throw new StoreError("bad_request", "a human reviewer reference is required");
  if (why === "") throw new StoreError("bad_request", "a refusal must carry a reason");
  const { rows } = await db.query(
    `UPDATE share_links s
        SET rejected_at = now(), rejected_by = $2, reject_reason = $3
      WHERE s.id = $1 AND ${PENDING} RETURNING s.id`,
    [shareId, who, why],
  );
  return { rejected: rows.length > 0 };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /gallery data — public, unauthenticated, no per-person field in it.
 * `approvedBy` names the human who approved the listing, which is a fact for
 * the moderation dashboard and nobody else, so it is dropped here rather than
 * left to a renderer to omit.
 */
export type PublicGalleryEntry = Omit<GalleryEntry, "approvedBy">;

export function publicEntry(entry: GalleryEntry): PublicGalleryEntry {
  const { approvedBy: _approvedBy, ...rest } = entry;
  return rest;
}

export async function handleListGallery(
  ctx: ApiContext,
  raw: Record<string, string | undefined> = {},
): Promise<ApiResult> {
  const listing = await listGallery(ctx.db, parseGalleryQuery(raw));
  return { status: 200, body: { gallery: { ...listing, entries: listing.entries.map(publicEntry) } } };
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
 * Reviewer-only: decide one submission. The reviewer reference is the
 * VERIFIED caller identity, never a body field — "who decided this" has to be
 * a fact about the session, not a claim in the request. A refusal additionally
 * requires a reason, which is the one thing the candidate will read.
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
    const reason = typeof b.reason === "string" ? b.reason : "";
    if (!UUID_RE.test(shareId) || typeof decision !== "string" || !(REVIEW_DECISIONS as readonly string[]).includes(decision)) {
      return {
        status: 400,
        body: { error: { code: "bad_request", message: "shareId (uuid) and decision (approve|reject) are required" } },
      };
    }
    if (decision === "reject" && reason.trim() === "") {
      return {
        status: 400,
        body: { error: { code: "bad_request", message: "a refusal must carry a reason the candidate can read" } },
      };
    }
    try {
      const result =
        decision === "approve"
          ? await approveShare(ctx.db, shareId, reviewer)
          : await rejectSubmission(ctx.db, shareId, reviewer, reason);
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
