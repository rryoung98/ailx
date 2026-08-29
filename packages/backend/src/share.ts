/**
 * Share links — the growth-loop primitive (docs/SHARING.md).
 *
 * Four properties this module exists to guarantee:
 *
 *  1. PRIVATE BY DEFAULT. A share row only exists after an explicit
 *     candidate action on an attempt they own.
 *  2. REVOCABLE FOR REAL. Revocation stamps `revoked_at`; every read path
 *     filters on it, so a revoked token 404s — the same answer a never-issued
 *     token gets, so revocation is not observable as "this existed".
 *  3. AN ALLOWLIST, NOT A REDACTION. What is shared is built ONCE by the pure
 *     `buildSharePayload` (@ailx/report) from the stored log and frozen into
 *     the row, and only for the SECTIONS the candidate switched on. Section
 *     selection is applied HERE, server-side, so hiding a checkbox is never
 *     what keeps a section out. Nothing else is ever serialized: no item ids,
 *     no per-item responses, no event log, no attempt id, no participant ref.
 *  4. RECOVERABLE BY ITS OWNER, AND ONLY BY ITS OWNER. The token is stored,
 *     so the owner can re-copy their own link and a published gallery card
 *     can link to its own share view. Every owner read goes through
 *     `getAttempt(db, attemptId, participantId)` first, so a stranger asking
 *     for someone else's attempt gets 404, never a token.
 */

import { project, type SequencedEntry } from "@ailx/session";
import {
  DEFAULT_SHARE_SECTIONS,
  buildSharePayload,
  parseShareNote,
  parseShareSections,
  parseSharePayload,
  type SharePayload,
  type ShareSections,
} from "@ailx/report";
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

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface ShareRecord {
  id: string;
  status: ShareStatus;
  /**
   * The capability token. Returned to the OWNER (so they can re-copy their
   * link) and carried on PUBLISHED gallery entries (which their owner chose
   * to make public); never on the anonymous `/api/share/:token` read.
   */
  token: string;
  /** Who approved publication: "auto:card", a human approver ref, or null. */
  approvedBy: string | null;
  /** True when a HUMAN must approve before this may be publicly listed. */
  needsHumanApproval: boolean;
  createdAt: string;
  revokedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  /** The named human who refused publication, or null. */
  rejectedBy: string | null;
  rejectedAt: string | null;
  /** Why it was refused, shown verbatim to the candidate. */
  rejectReason: string | null;
  /** Anonymous view count (day-granular rows; no visitor identity exists). */
  views: number;
  payload: SharePayload;
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string | Date).toISOString());

/** Monotone derivation — the row's stamps ARE the state machine. */
export function shareStatus(row: {
  revokedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  submittedAt: string | null;
}): ShareStatus {
  if (row.revokedAt !== null) return "revoked";
  if (row.rejectedAt !== null) return "rejected";
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
    rejectedAt: iso(row.rejected_at),
    submittedAt: iso(row.submitted_at),
  };
  return {
    id: row.id as string,
    status: shareStatus(stamps),
    token: row.token as string,
    approvedBy: (row.approved_by as string | null) ?? null,
    needsHumanApproval: needsHumanApproval(payload),
    createdAt: iso(row.created_at)!,
    ...stamps,
    rejectedBy: (row.rejected_by as string | null) ?? null,
    rejectReason: (row.reject_reason as string | null) ?? null,
    views: Number(row.views ?? 0),
    payload,
  };
}

/**
 * THE public-serving predicate, defined once: not revoked by its owner, and
 * not refused by a reviewer. The gallery's own listing predicate adds
 * "approved" on top of this (packages/backend/src/gallery.ts).
 */
export const PUBLICLY_SERVED = "s.revoked_at IS NULL AND s.rejected_at IS NULL";

const SELECT_SHARE = `SELECT s.id, s.token, s.payload, s.created_at, s.submitted_at, s.approved_at, s.approved_by,
        s.rejected_at, s.rejected_by, s.reject_reason, s.revoked_at,
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
  /**
   * Which parts of the run may be serialized. Normalized through
   * `parseShareSections`, so an unknown or non-boolean key cannot turn a
   * section on. THIS is the enforcement point — the checkbox is only a hint.
   */
  sections?: ShareSections;
  /** Candidate-authored "what I built" note; kept only if `sections.note`. */
  note?: string | null;
}

/**
 * Create (or return) the attempt's live share link. Idempotent while a link
 * is live: a second call returns the SAME record, `created: false`, with the
 * same token — the token is stored, so recovering it is the point. A caller
 * that wants a DIFFERENT selection of sections revokes and creates again,
 * because an issued payload is frozen.
 */
export async function createShare(
  db: Queryable,
  attemptId: string,
  participantId: string,
  options: CreateShareOptions = {},
): Promise<{ share: ShareRecord; created: boolean }> {
  const attempt = await getAttempt(db, attemptId, participantId);
  if (attempt === null) throw new StoreError("not_found", "attempt not found");

  const existing = await getShareForAttempt(db, attemptId, participantId);
  if (existing !== null) return { share: existing, created: false };

  const sections = parseShareSections(options.sections ?? DEFAULT_SHARE_SECTIONS);
  const note = sections.note ? parseShareNote(options.note) : null;
  // The site opt-in can only reference the attempt's OWN recorded snapshot.
  const site = sections.site ? await attemptSiteDigest(db, attemptId) : null;
  const state = await projectAttempt(db, attemptId);
  const payload = buildSharePayload(state, {
    sections,
    note,
    site: site === null ? null : siteUrlPath(site),
  });
  if (payload === null) {
    throw new StoreError("bad_request", "nothing to share yet — finish and score every track first");
  }

  const token = newShareToken();
  const { rows } = await db.query(
    `INSERT INTO share_links (attempt_id, token, payload, site_digest)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id, token, payload, created_at, submitted_at, approved_at, approved_by,
               rejected_at, rejected_by, reject_reason, revoked_at, 0 AS views`,
    [attemptId, token, JSON.stringify(payload), site],
  );
  const record = shareFromRow(rows[0]!);
  if (record === null) throw new StoreError("bad_request", "share payload failed to round-trip");
  return { share: record, created: true };
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
 * authorization. Revoked links, REFUSED links, malformed tokens and unknown
 * tokens are all indistinguishable (null), so neither a revocation nor a
 * moderation refusal can be confirmed from outside.
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
  const { rows } = await db.query(
    `${SELECT_SHARE} WHERE s.token = $1 AND ${PUBLICLY_SERVED}`,
    [token],
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
// Publication policy (hybrid — see db/schema.sql)
// ---------------------------------------------------------------------------

/** Recorded approver for an auto-published derived card. */
export const AUTO_APPROVER = "auto:card";

/**
 * Does entering the PUBLIC gallery need a human?
 *
 * Derived from the STORED payload — never from a request field, so no client
 * can talk its way past the gate:
 *  - a player-type card is a derived figure over four aggregate numbers, with
 *    no candidate-authored bytes in it: auto-publish;
 *  - a share carrying the candidate's built SITE hosts arbitrary user HTML on
 *    our origin, which is exactly what spec §12's approval-required gallery
 *    rule exists for: a human approves it or it stays unpublished;
 *  - a share carrying the candidate's own NOTE puts authored text on a public
 *    wall. It is escaped and length-capped, so it is not an XSS question — it
 *    is a moderation question, and the same human answers it.
 */
export function needsHumanApproval(payload: { site: string | null; note?: string | null }): boolean {
  return payload.site !== null || (payload.note ?? null) !== null;
}

export interface PublishResult {
  status: ShareStatus;
  /** True when the caller must now wait for a human approver. */
  awaitingApproval: boolean;
}

/**
 * Candidate action: put this share into the public gallery queue. A card is
 * published in the same statement it is submitted; a share with a site stops
 * at `submitted` and no candidate-reachable path can move it further.
 */
export async function publishShare(
  db: Queryable,
  attemptId: string,
  participantId: string,
): Promise<PublishResult> {
  const share = await getShareForAttempt(db, attemptId, participantId);
  if (share === null) throw new StoreError("not_found", "no live share link");
  if (share.status === "published") return { status: "published", awaitingApproval: false };
  // A refusal is terminal for THIS row: re-submitting it would let a candidate
  // grind a reviewer down. Revoke and create a new share instead.
  if (share.status === "rejected") {
    throw new StoreError("bad_request", "this share was refused — revoke it and create a new one");
  }
  const auto = !share.needsHumanApproval;
  await db.query(
    `UPDATE share_links
        SET submitted_at = coalesce(submitted_at, now()),
            approved_at  = CASE WHEN $2 THEN coalesce(approved_at, now()) ELSE approved_at END,
            approved_by  = CASE WHEN $2 THEN coalesce(approved_by, $3) ELSE approved_by END
      WHERE id = $1 AND revoked_at IS NULL AND rejected_at IS NULL`,
    [share.id, auto, AUTO_APPROVER],
  );
  return auto
    ? { status: "published", awaitingApproval: false }
    : { status: "submitted", awaitingApproval: true };
}

/**
 * REVIEWER action, deliberately not reachable from any candidate route: a
 * named human stamps approval on a submitted, site-carrying share. Refuses
 * anything not submitted, and anything already revoked.
 */
export async function approveShare(
  db: Queryable,
  shareId: string,
  approver: string,
): Promise<{ approved: boolean }> {
  if (approver === "" || approver === AUTO_APPROVER) {
    throw new StoreError("bad_request", "a human approver reference is required");
  }
  const { rows } = await db.query(
    `UPDATE share_links SET approved_at = now(), approved_by = $2
      WHERE id = $1 AND revoked_at IS NULL AND rejected_at IS NULL
        AND submitted_at IS NOT NULL AND approved_at IS NULL
      RETURNING id`,
    [shareId, approver],
  );
  return { approved: rows.length > 0 };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/attempts/:id/share — body: { sections?: Record<string, boolean>,
 * note?: string }.
 *
 * The body says which SECTIONS to include and supplies the candidate's own
 * note. It cannot supply a payload, a site path or a status: everything
 * serialized is rebuilt server-side from the stored log, and the selection is
 * re-normalized by `parseShareSections` — a request naming a section that does
 * not exist changes nothing.
 */
export async function handleCreateShare(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
  body: unknown,
): Promise<ApiResult> {
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const sections = parseShareSections(raw.sections);
  const note = parseShareNote(raw.note);
  return withParticipant(ctx, headers, async (participantId) => {
    const { share, created } = await createShare(ctx.db, attemptId, participantId, {
      sections,
      note,
    });
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
