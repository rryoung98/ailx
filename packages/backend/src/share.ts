/**
 * Share links — the growth-loop primitive (docs/SHARING.md).
 *
 * Three properties this module exists to guarantee:
 *
 *  1. PRIVATE BY DEFAULT. A share row only exists after an explicit
 *     candidate action on an attempt they own.
 *  2. REVOCABLE FOR REAL. Revocation stamps `revoked_at`; every read path
 *     filters on it, so a revoked token 404s — the same answer a never-issued
 *     token gets, so revocation is not observable as "this existed".
 *  3. AN ALLOWLIST, NOT A REDACTION. What is shared is built ONCE by the pure
 *     `buildSharePayload` (@ailx/report) from the stored log and frozen into
 *     the row. Nothing else is ever serialized: no item ids, no per-item
 *     responses, no event log, no attempt id, no participant reference.
 *
 * Only the token's sha256 is stored, so the database never holds a working
 * capability. Lookup is by digest, which is also why the token needs no
 * database-side index on a secret.
 */

import { project, type SequencedEntry } from "@ailx/session";
import { buildSharePayload, parseSharePayload, type SharePayload } from "@ailx/report";
import type { Queryable, QueryResultRow } from "./db.js";
import type { HeaderMap } from "./auth.js";
import { withParticipant, type ApiContext, type ApiResult } from "./handlers.js";
import { StoreError, getAttempt } from "./store.js";
import { T1_SITE_RESPONSE_KIND, siteUrlPath } from "./site-url.js";
import { SHARE_TOKEN_BYTES, SHARE_TOKEN_RE, type ShareStatus } from "./share-url.js";

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/** base64url of `bytes`, unpadded — URL-safe with no encoding surprises. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A fresh capability token: 256 bits from the platform CSPRNG (Web Crypto,
 * present in Node 20+ and the browser — no node: import, so this module stays
 * loadable from the client-safe barrel).
 */
export function newShareToken(): string {
  const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** sha256 hex of a token — what the row stores, and what lookup keys on. */
export async function hashShareToken(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface ShareRecord {
  id: string;
  status: ShareStatus;
  createdAt: string;
  revokedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  /** Anonymous view count (day-granular rows; no visitor identity exists). */
  views: number;
  payload: SharePayload;
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string | Date).toISOString());

/** Monotone derivation — the row's stamps ARE the state machine. */
export function shareStatus(row: {
  revokedAt: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
}): ShareStatus {
  if (row.revokedAt !== null) return "revoked";
  if (row.approvedAt !== null) return "published";
  if (row.submittedAt !== null) return "submitted";
  return "unlisted";
}

function shareFromRow(row: QueryResultRow): ShareRecord | null {
  const payload = parseSharePayload(
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
  );
  if (payload === null) return null;
  const stamps = {
    revokedAt: iso(row.revoked_at),
    approvedAt: iso(row.approved_at),
    submittedAt: iso(row.submitted_at),
  };
  return {
    id: row.id as string,
    status: shareStatus(stamps),
    createdAt: iso(row.created_at)!,
    ...stamps,
    views: Number(row.views ?? 0),
    payload,
  };
}

const SELECT_SHARE = `SELECT s.id, s.payload, s.created_at, s.submitted_at, s.approved_at, s.revoked_at,
        (SELECT count(*) FROM share_views v WHERE v.share_id = s.id) AS views
   FROM share_links s`;

// ---------------------------------------------------------------------------
// Derivation of what may be shared
// ---------------------------------------------------------------------------

/**
 * Replay an attempt's mirrored session log. The mirror stores whole session
 * entries as `responses.payload` (one row per LOG entry, not per exam item),
 * so the projection — not `responses.item_id` — is the truth here.
 * Non-session rows (the T1 snapshot record) are skipped.
 */
async function projectAttempt(db: Queryable, attemptId: string) {
  const { rows } = await db.query(
    "SELECT payload FROM responses WHERE attempt_id = $1 ORDER BY seq",
    [attemptId],
  );
  const log: SequencedEntry[] = [];
  for (const r of rows) {
    const p = (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as
      | Partial<SequencedEntry>
      | null;
    if (p && typeof p.type === "string" && typeof p.seq === "number") log.push(p as SequencedEntry);
  }
  return project(log);
}

/** The attempt's published T1 snapshot digest, or null (nothing to opt into). */
export async function attemptSiteDigest(db: Queryable, attemptId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT payload->>'digest' AS digest FROM responses
      WHERE attempt_id = $1 AND payload->>'kind' = $2 ORDER BY seq LIMIT 1`,
    [attemptId, T1_SITE_RESPONSE_KIND],
  );
  return (rows[0]?.digest as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export interface CreateShareOptions {
  /** Separate, explicit opt-in: the candidate's OWN built site. */
  includeSite?: boolean;
}

export interface CreatedShare extends ShareRecord {
  /** The only moment the plaintext token exists outside the sharer's clipboard. */
  token: string;
}

/**
 * Create (or return) the attempt's live share link. Idempotent while a link
 * is live: a second call returns the SAME record — but never the token again,
 * because the token was only ever held in the first response. A caller that
 * wants a fresh token revokes first.
 */
export async function createShare(
  db: Queryable,
  attemptId: string,
  participantId: string,
  options: CreateShareOptions = {},
): Promise<CreatedShare | ShareRecord> {
  const attempt = await getAttempt(db, attemptId, participantId);
  if (attempt === null) throw new StoreError("not_found", "attempt not found");

  const existing = await getShareForAttempt(db, attemptId, participantId);
  if (existing !== null) return existing;

  const site = options.includeSite === true ? await attemptSiteDigest(db, attemptId) : null;
  const state = await projectAttempt(db, attemptId);
  const payload = buildSharePayload(state, { site: site === null ? null : siteUrlPath(site) });
  if (payload === null) {
    throw new StoreError("bad_request", "nothing to share yet — finish and score every track first");
  }

  const token = newShareToken();
  const tokenSha = await hashShareToken(token);
  const { rows } = await db.query(
    `INSERT INTO share_links (attempt_id, token_sha256, payload, site_digest)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id, payload, created_at, submitted_at, approved_at, revoked_at, 0 AS views`,
    [attemptId, tokenSha, JSON.stringify(payload), site],
  );
  const record = shareFromRow(rows[0]!);
  if (record === null) throw new StoreError("bad_request", "share payload failed to round-trip");
  return { ...record, token };
}

/** The attempt's live (non-revoked) share, or null. Ownership enforced. */
export async function getShareForAttempt(
  db: Queryable,
  attemptId: string,
  participantId: string,
): Promise<ShareRecord | null> {
  const attempt = await getAttempt(db, attemptId, participantId);
  if (attempt === null) return null;
  const { rows } = await db.query(
    `${SELECT_SHARE} WHERE s.attempt_id = $1 AND s.revoked_at IS NULL`,
    [attemptId],
  );
  return rows.length === 0 ? null : shareFromRow(rows[0]!);
}

/**
 * Revoke the attempt's live link. A one-way stamp (never cleared, never
 * deleted) — the row stays as the audit trail, exactly like
 * attempts.finalized_at. Idempotent: revoking with nothing live is a no-op.
 */
export async function revokeShare(
  db: Queryable,
  attemptId: string,
  participantId: string,
): Promise<{ revoked: boolean }> {
  const attempt = await getAttempt(db, attemptId, participantId);
  if (attempt === null) throw new StoreError("not_found", "attempt not found");
  const { rows } = await db.query(
    `UPDATE share_links SET revoked_at = now()
      WHERE attempt_id = $1 AND revoked_at IS NULL RETURNING id`,
    [attemptId],
  );
  return { revoked: rows.length > 0 };
}

/**
 * Public read by capability token. No auth: possession of the token IS the
 * authorization. Revoked links, malformed tokens and unknown tokens are all
 * indistinguishable (null), so a revoked link cannot be confirmed to exist.
 *
 * `countView` appends ONE anonymous view row (see db/schema.sql) — the whole
 * of our analytics.
 */
export async function resolveShare(
  db: Queryable,
  token: string,
  countView = false,
): Promise<ShareRecord | null> {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const tokenSha = await hashShareToken(token);
  const { rows } = await db.query(
    `${SELECT_SHARE} WHERE s.token_sha256 = $1 AND s.revoked_at IS NULL`,
    [tokenSha],
  );
  if (rows.length === 0) return null;
  const record = shareFromRow(rows[0]!);
  if (record === null) return null;
  if (countView) {
    await db.query("INSERT INTO share_views (share_id) VALUES ($1)", [record.id]);
  }
  return record;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** POST /api/attempts/:id/share — body: { includeSite?: boolean } */
export async function handleCreateShare(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
  body: unknown,
): Promise<ApiResult> {
  const includeSite = (body as { includeSite?: unknown } | null)?.includeSite === true;
  return withParticipant(ctx, headers, async (participantId) => {
    const share = await createShare(ctx.db, attemptId, participantId, { includeSite });
    const created = "token" in share;
    return { status: created ? 201 : 200, body: { share } };
  });
}

/** GET /api/attempts/:id/share — the owner's view of their own link. */
export async function handleGetShare(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => {
    const share = await getShareForAttempt(ctx.db, attemptId, participantId);
    if (share === null) {
      return { status: 404, body: { error: { code: "not_found", message: "no live share link" } } };
    }
    return { status: 200, body: { share } };
  });
}

/** DELETE /api/attempts/:id/share */
export async function handleRevokeShare(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => {
    const result = await revokeShare(ctx.db, attemptId, participantId);
    return { status: 200, body: result };
  });
}

/**
 * GET /api/share/:token — unauthenticated capability read. Returns ONLY the
 * frozen payload plus the link's own state; never the attempt id, never the
 * owner, never the token digest.
 */
export async function handleViewShare(
  ctx: ApiContext,
  token: string,
  countView = false,
): Promise<ApiResult> {
  const share = await resolveShare(ctx.db, token, countView);
  if (share === null) {
    return { status: 404, body: { error: { code: "not_found", message: "share not found" } } };
  }
  return {
    status: 200,
    body: {
      share: {
        status: share.status,
        createdAt: share.createdAt,
        views: share.views,
        payload: share.payload,
      },
    },
  };
}
