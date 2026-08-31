/**
 * Credentials — issue, revoke, and the public verification read.
 *
 * The contract with a stranger is the whole product here (docs/CREDENTIAL.md):
 *
 *  1. THE VERIFICATION ENDPOINT IS THE SOURCE OF TRUTH, not any image or
 *     screenshot. It reads the row live, so it can never confirm a claim the
 *     store does not hold.
 *  2. REVOCATION IS VISIBLE, NOT SILENT. Unlike a share token — a capability,
 *     where a revoked link must be indistinguishable from an unknown one — a
 *     credential code is PUBLISHED on a CV. So a revoked code still resolves,
 *     with `revoked`, the date and the reason. Only an unknown or malformed
 *     code 404s.
 *  3. THE CLAIM IS AN ALLOWLIST, FROZEN AT ISSUE. It is built once by the pure
 *     `buildCredentialClaim` (@ailx/report) from the stored log, and the
 *     served document is derived from it at read time. Nothing else is ever
 *     serialized: no score, no band, no percentile, no item, no attempt id, no
 *     participant reference.
 *  4. ISSUING IS AN OWNER ACTION. Every write goes through
 *     `getAttempt(db, attemptId, participantId)` first, so a stranger asking
 *     about someone else's attempt gets 404, never a credential.
 */
import { project, type SequencedEntry } from "@ailx/session";
import {
  siteUrlPath,
  type CredentialRecord,
  type OwnerCredential,
} from "@ailx/contract";
import {
  CREDENTIAL_CODE_RE,
  buildCredentialClaim,
  candidateComposite,
  credentialDocument,
  formatCredentialCode,
  linkedInCertification,
  parseCredentialClaim,
  verifyUrlPath,
} from "@ailx/report";
import type { Queryable, QueryResultRow } from "./db.js";
import type { HeaderMap } from "./auth.js";
import { withParticipant, type ApiContext, type ApiResult } from "./handlers.js";
import { StoreError, getAttempt } from "./store.js";
import { attemptSiteDigest } from "./share.js";

/** Bytes drawn per code — one per character of the four four-char groups. */
export const CREDENTIAL_CODE_BYTES = 16;

/** Recorded when a holder revokes their own credential. Shown verbatim. */
export const HOLDER_REVOKED_REASON = "revoked by the holder";

/** Longest reason we will store; a reason is a sentence, not an essay. */
export const REVOKE_REASON_MAX = 200;

/**
 * A fresh credential code: 128 bits from the platform CSPRNG folded into the
 * 80-bit readable alphabet (@ailx/report `formatCredentialCode`). Enough that
 * enumeration buys nothing; the row is not a secret either way.
 */
export function newCredentialCode(instrumentVersion: string): string {
  const bytes = new Uint8Array(CREDENTIAL_CODE_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return formatCredentialCode(instrumentVersion, bytes);
}

const iso = (v: unknown): string | null =>
  v == null ? null : new Date(v as string | Date).toISOString();

function credentialFromRow(row: QueryResultRow): CredentialRecord | null {
  const claim = parseCredentialClaim(
    typeof row.claim === "string" ? JSON.parse(row.claim) : row.claim,
  );
  if (claim === null) return null;
  const revokedAt = iso(row.revoked_at);
  return {
    id: row.id as string,
    code: row.code as string,
    status: revokedAt === null ? "valid" : "revoked",
    issuedAt: iso(row.issued_at)!,
    revokedAt,
    revokeReason: (row.revoke_reason as string | null) ?? null,
    claim,
  };
}

const SELECT_CREDENTIAL = `SELECT id, code, claim, issued_at, revoked_at, revoke_reason
   FROM credentials`;

/** Replay an attempt's mirrored session log — the same projection share uses. */
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

/**
 * Issue (or return) the attempt's live credential. Idempotent while one is
 * live: a second call returns the SAME row and `issued: false`, because a
 * credential code is published and re-issuing would silently orphan it. To
 * change one, revoke it and issue again — the revoked code keeps verifying,
 * and says so.
 *
 * The artifact link is included whenever the attempt HAS a recorded T1
 * snapshot: it is the holder's own work and the credential already points at
 * their sitting, so there is no second opt-in to make here.
 */
export async function issueCredential(
  db: Queryable,
  attemptId: string,
  participantId: string,
): Promise<{ credential: CredentialRecord; issued: boolean }> {
  const attempt = await getAttempt(db, attemptId, participantId);
  if (attempt === null) throw new StoreError("not_found", "attempt not found");

  const existing = await getCredentialForAttempt(db, attemptId, participantId);
  if (existing !== null) return { credential: existing, issued: false };

  const state = await projectAttempt(db, attemptId);
  const summary = candidateComposite(state);
  const digest = await attemptSiteDigest(db, attemptId);
  const claim = buildCredentialClaim(state, summary?.trackRaw ?? null, {
    artifact: digest === null ? null : siteUrlPath(digest),
  });
  if (claim === null) {
    throw new StoreError(
      "bad_request",
      "nothing to certify yet — finish and score every track first",
    );
  }
  const { rows } = await db.query(
    `INSERT INTO credentials (attempt_id, code, claim)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id, code, claim, issued_at, revoked_at, revoke_reason`,
    [attemptId, newCredentialCode(claim.instrumentVersion), JSON.stringify(claim)],
  );
  const record = credentialFromRow(rows[0]!);
  if (record === null) throw new StoreError("bad_request", "credential claim failed to round-trip");
  return { credential: record, issued: true };
}

/** The attempt's live (non-revoked) credential, or null. Ownership enforced. */
export async function getCredentialForAttempt(
  db: Queryable,
  attemptId: string,
  participantId: string,
): Promise<CredentialRecord | null> {
  const attempt = await getAttempt(db, attemptId, participantId);
  if (attempt === null) return null;
  const { rows } = await db.query(
    `${SELECT_CREDENTIAL} WHERE attempt_id = $1 AND revoked_at IS NULL`,
    [attemptId],
  );
  return rows.length === 0 ? null : credentialFromRow(rows[0]!);
}

/** Trim a reason to one storable line; an empty one falls back, never null. */
export function normalizeRevokeReason(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point — a revoke reason is stored and re-rendered
  const flat = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat === "" ? fallback : flat.slice(0, REVOKE_REASON_MAX).trim();
}

/**
 * Revoke the attempt's live credential. A one-way stamp with a reason, never
 * a delete: the code stays resolvable so anyone who already saw it gets the
 * truth rather than a dead link. Idempotent.
 */
export async function revokeCredential(
  db: Queryable,
  attemptId: string,
  participantId: string,
  reason?: unknown,
): Promise<{ revoked: boolean }> {
  const attempt = await getAttempt(db, attemptId, participantId);
  if (attempt === null) throw new StoreError("not_found", "attempt not found");
  const { rows } = await db.query(
    `UPDATE credentials SET revoked_at = now(), revoke_reason = $2
      WHERE attempt_id = $1 AND revoked_at IS NULL RETURNING id`,
    [attemptId, normalizeRevokeReason(reason, HOLDER_REVOKED_REASON)],
  );
  return { revoked: rows.length > 0 };
}

/**
 * Public read by code. No auth: a credential is a public claim. A revoked
 * credential RESOLVES (that is the point); only an unknown or malformed code
 * is null, and the caller turns that into a 404 that says "we cannot confirm
 * this", which is exactly the anti-forgery answer.
 */
export async function resolveCredential(
  db: Queryable,
  code: string,
): Promise<CredentialRecord | null> {
  if (typeof code !== "string" || !CREDENTIAL_CODE_RE.test(code)) return null;
  const { rows } = await db.query(`${SELECT_CREDENTIAL} WHERE code = $1`, [code]);
  if (rows.length === 0) return null;
  return credentialFromRow(rows[0]!);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * The owner's view. `origin` is the public origin the app resolved; the
 * LinkedIn fields need absolute URLs, and guessing them from a Host header is
 * exactly the mistake AILX_PUBLIC_ORIGIN exists to prevent.
 */
export function ownerCredentialView(
  credential: CredentialRecord,
  origin: string,
): OwnerCredential {
  return {
    ...credential,
    verifyPath: verifyUrlPath(credential.code),
    linkedIn: linkedInCertification(credential.claim, credential, origin),
  };
}

/** POST /api/attempts/:id/credential — issue, or return the live one. */
export async function handleIssueCredential(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
  origin: string,
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => {
    const { credential, issued } = await issueCredential(ctx.db, attemptId, participantId);
    return {
      status: issued ? 201 : 200,
      body: { credential: ownerCredentialView(credential, origin) },
    };
  });
}

/** GET /api/attempts/:id/credential — the owner's own live credential. */
export async function handleGetCredential(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
  origin: string,
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => {
    const credential = await getCredentialForAttempt(ctx.db, attemptId, participantId);
    if (credential === null) {
      return { status: 404, body: { error: { code: "not_found", message: "no live credential" } } };
    }
    return { status: 200, body: { credential: ownerCredentialView(credential, origin) } };
  });
}

/** DELETE /api/attempts/:id/credential — body: { reason?: string }. */
export async function handleRevokeCredential(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
  body: unknown,
): Promise<ApiResult> {
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return withParticipant(ctx, headers, async (participantId) => ({
    status: 200,
    body: await revokeCredential(ctx.db, attemptId, participantId, raw.reason),
  }));
}

/**
 * GET /api/credentials/:code — the public, unauthenticated verification read.
 * Returns the derived Open Badges document; 404 only when the code is unknown
 * or malformed. A revoked credential answers 200 and says it is revoked.
 */
export async function handleVerifyCredential(
  ctx: ApiContext,
  code: string,
  origin: string,
): Promise<ApiResult> {
  const credential = await resolveCredential(ctx.db, code);
  if (credential === null) {
    return {
      status: 404,
      body: {
        error: {
          code: "not_found",
          message: "no AILX credential with that id — this cannot be confirmed",
        },
      },
    };
  }
  return { status: 200, body: credentialDocument(credential.claim, credential, origin) };
}
