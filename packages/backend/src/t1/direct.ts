/**
 * Client-direct T1 upload — the handshake that gets a 25 MB candidate
 * site past a ~4.5 MB serverless request cap (docs/DEPLOY.md §5), by
 * letting the browser PUT the ZIP straight into the object store and
 * then asking us to accept it.
 *
 * THE THREAT MODEL, in one place (the prose version is DEPLOY.md §5.1):
 *
 *  - Bytes we did not stream are bytes we do not trust. Nothing here
 *    validates client-side. The finalize step READS the staged object
 *    back and runs the same `snapshotFromZip` a direct POST runs, so
 *    every hostile archive (zip bomb, zip slip, symlink, disallowed
 *    type, oversize) is refused by the same code as before.
 *  - The client never names a digest. It is computed from the bytes we
 *    read, so a client cannot register a snapshot it did not upload,
 *    nor point a `responses` row at somebody else's content.
 *  - The client never names its own key either. The server mints
 *    `uploads/<attemptId>/<uploadId>.zip` and scopes the upload
 *    credential to exactly that key, that content type and
 *    `T1_LIMITS.maxTotalBytes` — so a stolen or replayed grant can
 *    write to ONE scratch key inside the uploader's own attempt, never
 *    over a content-addressed blob, a manifest, or another attempt.
 *  - Staged keys are never servable: `handleServeSite` serves only
 *    `manifests/` + `blobs/` entries, and only for a digest a
 *    `responses` row still points at. Bytes that fail validation are
 *    discarded and were unreachable even before that.
 *  - Ownership is checked before a grant is minted and again at
 *    finalize; the one-submission-per-attempt index and the
 *    record-before-store ordering are untouched, because finalize goes
 *    through the same `recordSiteSubmission`.
 */

import { randomBytes } from "node:crypto";
import type { ApiResult } from "../handlers.js";
import type { HeaderMap } from "../auth.js";
import { T1_LIMITS } from "./snapshot.js";
import { recordSiteSubmission, withOwnedAttempt, type T1ApiContext } from "./handlers.js";
import type { SnapshotUploadStaging } from "./storage.js";

/** Key namespace for staged, unvalidated client uploads — never served. */
export const STAGED_UPLOAD_PREFIX = "uploads";

/** The only content type a client-direct site upload may carry. */
export const SITE_ZIP_CONTENT_TYPE = "application/zip";

/** How long a client may take to finish one direct upload. */
export const UPLOAD_GRANT_TTL_MS = 15 * 60 * 1000;

const UPLOAD_ID_RE = /^[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The staging key for one upload, or null when either id is not exactly
 * what we mint. Pure, and the ONLY place a staging key is spelled: the
 * attempt id is in the path, so a key is meaningless outside the attempt
 * whose owner asked for it, and neither id can carry a `/`, `..` or any
 * other character that could aim the write somewhere else.
 */
export function stagedUploadKey(attemptId: string, uploadId: string): string | null {
  if (!UUID_RE.test(attemptId) || !UPLOAD_ID_RE.test(uploadId)) return null;
  return `${STAGED_UPLOAD_PREFIX}/${attemptId.toLowerCase()}/${uploadId}.zip`;
}

/** A fresh, unguessable upload id (128 bits, hex — see UPLOAD_ID_RE). */
export function newUploadId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Upload context: the T1 context plus the staging half of the store.
 * `null` staging means this deployment has no client-direct target
 * (the filesystem store, i.e. local dev), and the endpoint says so
 * instead of pretending — the client then just POSTs the ZIP.
 */
export interface T1DirectContext extends T1ApiContext {
  staging: SnapshotUploadStaging | null;
}

const DIRECT_UNAVAILABLE: ApiResult = {
  status: 501,
  body: {
    error: {
      code: "direct_upload_unavailable",
      message: "this deployment has no client-direct upload target — POST the ZIP instead",
    },
  },
};

/**
 * POST /api/attempts/:id/site/upload-ticket — mint ONE scoped upload
 * grant for the attempt's owner. Nothing is recorded and nothing is
 * reserved: a ticket is permission to write one scratch key, and an
 * unused one simply expires.
 */
export async function handleCreateSiteUpload(
  ctx: T1DirectContext,
  headers: HeaderMap,
  attemptId: string,
): Promise<ApiResult> {
  return withOwnedAttempt(ctx, headers, attemptId, async () => {
    const staging = ctx.staging;
    if (staging === null) return DIRECT_UNAVAILABLE;
    const uploadId = newUploadId();
    const key = stagedUploadKey(attemptId, uploadId);
    // Unreachable via the route (ownership already matched a real
    // attempt id), but the key builder is the security boundary, so it
    // is never assumed to have succeeded.
    if (key === null) {
      return { status: 400, body: { error: { code: "bad_request", message: "invalid attempt id" } } };
    }
    const grant = await staging.authorize({
      key,
      maxBytes: T1_LIMITS.maxTotalBytes,
      contentType: SITE_ZIP_CONTENT_TYPE,
    });
    return {
      status: 201,
      body: {
        upload: {
          uploadId,
          pathname: key,
          token: grant.token,
          contentType: SITE_ZIP_CONTENT_TYPE,
          maxBytes: T1_LIMITS.maxTotalBytes,
          expiresAt: grant.expiresAt,
        },
      },
    };
  });
}

export interface FinalizeSiteUploadInput {
  /** The id from the ticket — NOT a key, and never a digest. */
  uploadId: unknown;
  seq: number;
  clientTs: string | number;
}

/**
 * POST /api/attempts/:id/site/finalize — accept a staged upload.
 * Reads the bytes the browser wrote, validates them exactly as a direct
 * POST would, records the submission, stores the content-addressed
 * snapshot, and drops the staged object either way.
 */
export async function handleFinalizeSiteUpload(
  ctx: T1DirectContext,
  headers: HeaderMap,
  attemptId: string,
  input: FinalizeSiteUploadInput,
): Promise<ApiResult> {
  return withOwnedAttempt(ctx, headers, attemptId, async (participantId) => {
    const staging = ctx.staging;
    if (staging === null) return DIRECT_UNAVAILABLE;
    const key = typeof input.uploadId === "string" ? stagedUploadKey(attemptId, input.uploadId) : null;
    if (key === null) {
      return { status: 400, body: { error: { code: "bad_request", message: "invalid uploadId" } } };
    }

    const staged = await staging.read(key, T1_LIMITS.maxTotalBytes);
    if (staged.kind === "missing") {
      // Never uploaded, expired, or already finalized and cleaned up.
      return {
        status: 404,
        body: { error: { code: "upload_not_found", message: "no staged upload for this attempt" } },
      };
    }
    if (staged.kind === "too_large") {
      // Defence in depth: the grant caps this at the store, and the
      // validator would reject it again from its declared sizes.
      await discard(staging, key);
      return {
        status: 413,
        body: {
          error: {
            code: "total_too_large",
            message: `staged upload is ${staged.bytes} bytes (limit ${T1_LIMITS.maxTotalBytes})`,
          },
        },
      };
    }

    try {
      return await recordSiteSubmission(ctx, attemptId, participantId, {
        zip: staged.data,
        seq: input.seq,
        clientTs: input.clientTs,
      });
    } finally {
      // Accepted or refused, the scratch copy goes: an accepted
      // snapshot lives under its content address, and a refused one
      // must not linger anywhere at all.
      await discard(staging, key);
    }
  });
}

/** Cleanup is best-effort — a stuck scratch object must not fail a good upload. */
async function discard(staging: SnapshotUploadStaging, key: string): Promise<void> {
  try {
    await staging.discard(key);
  } catch {
    // Unreferenced, unservable, and expiring: nothing to report.
  }
}
