/**
 * T1 artifact export — the offboarding path.
 *
 * AILX is not a site builder and not a hosting platform (docs/FUTURE-TRACKS.md,
 * "Product principle to preserve"): when a candidate wants to take their T1
 * build further, we hand it over and point them at real tools rather than
 * growing an IDE. This module is the hand-over.
 *
 * Three properties hold it together:
 *
 *  1. It READS. Nothing here writes a `responses` row, a snapshot object or a
 *     score. The scored artifact is immutable and export must not be able to
 *     touch it, so the only store methods used are `getManifest`/`getFile`.
 *  2. OWNERSHIP, not capability, authorizes it. `/api/site/<digest>/…` is
 *     unauthenticated by design — the digest is the capability that lets a
 *     share link render a site. That is enough to LOOK at a site and nowhere
 *     near enough to copy one into somebody's GitHub account, so the export
 *     entry point is attempt-scoped and goes through `withOwnedAttempt`.
 *  3. The bytes are the SCORED bytes. The archive is repacked from the stored
 *     blobs with @ailx/core's deterministic writer, in manifest order, with
 *     nothing added — no README, no metadata file. Re-uploading a downloaded
 *     export therefore re-derives the SAME content address it was scored
 *     under, which is the export's own integrity check (see the round-trip
 *     test). Anything we want to say ABOUT the site (`exportReadme` in
 *     ./github.ts) travels with the GitHub export, never inside the archive.
 *
 * Nothing secret can leak here: a snapshot holds only the candidate's own
 * uploaded static assets. No rubric, judge prompt or item ever entered it.
 */

import { createHash } from "node:crypto";
import { writeStoredZip } from "@ailx/core";
import type { ApiResult } from "../handlers.js";
import type { HeaderMap } from "../auth.js";
import { SITE_ZIP_CONTENT_TYPE } from "./direct.js";
import {
  DEFAULT_REPO_NAME,
  GithubExportError,
  exportToGithub,
  redeemDeviceCode,
  requestDeviceCode,
  sanitizeRepoName,
  vercelDeployUrl,
  type GithubErrorCode,
  type HttpFetch,
} from "./github.js";
import {
  recordedSubmission,
  withOwnedAttempt,
  type RecordedSubmission,
  type T1ApiContext,
} from "./handlers.js";
import type { SnapshotFile } from "./snapshot.js";
import type { SnapshotStore } from "./storage.js";

// One spelling of the submission archive's content type, uploads and exports
// alike — the export IS the upload's bytes coming back out.
export { SITE_ZIP_CONTENT_TYPE };

/** How much of the digest names the download — enough to be unambiguous. */
const FILENAME_DIGEST_CHARS = 12;

export interface SiteExportZip {
  /** The repacked archive: exactly the stored files, nothing added. */
  zip: Uint8Array<ArrayBuffer>;
  /** Suggested `Content-Disposition` filename. */
  filename: string;
  /** The content address these bytes re-derive to. */
  digest: string;
  fileCount: number;
  totalBytes: number;
}

/**
 * `ailx-site-<short digest>.zip` — self-describing, collision-free, and
 * traceable back to the sitting without carrying an attempt id (which is
 * not the candidate's to leak into a filename they may share).
 */
export function siteExportFilename(digest: string): string {
  const hex = digest.replace(/^sha256:/, "").slice(0, FILENAME_DIGEST_CHARS);
  return `ailx-site-${hex}.zip`;
}

/**
 * Every file of a stored snapshot, in manifest order, or null when the
 * snapshot is not (or no longer) fully stored.
 *
 * Each blob is re-hashed on the way out. A store that hands back bytes under
 * the wrong hash is corrupt, and exporting a site the candidate was NOT
 * scored on would be worse than exporting nothing.
 */
export async function loadSnapshotFiles(
  store: SnapshotStore,
  digest: string,
): Promise<SnapshotFile[] | null> {
  const manifest = await store.getManifest(digest);
  if (manifest === null) return null;
  const files: SnapshotFile[] = [];
  for (const entry of manifest) {
    const stored = await store.getFile(digest, entry.path);
    if (stored === null) return null;
    if (createHash("sha256").update(stored.data).digest("hex") !== entry.sha256) return null;
    files.push({ ...entry, data: stored.data });
  }
  return files;
}

/** The stored snapshot as a deterministic ZIP, or null when it is unavailable. */
export async function exportSnapshotZip(
  store: SnapshotStore,
  digest: string,
): Promise<SiteExportZip | null> {
  const files = await loadSnapshotFiles(store, digest);
  if (files === null) return null;
  return {
    zip: writeStoredZip(files.map((f) => ({ path: f.path, data: f.data }))),
    filename: siteExportFilename(digest),
    digest,
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
  };
}

const NO_SUBMISSION: ApiResult = {
  status: 404,
  body: {
    error: { code: "not_found", message: "this attempt has no site submission to export" },
  },
};

/**
 * The recorded digest exists but its bytes do not — the documented residue of
 * a crash between the append and the put (see recordSiteSubmission). Not a
 * 404: the submission is real, so telling the candidate their work is gone
 * would be a lie. 503 says "try again", which is exactly right.
 */
const SNAPSHOT_UNAVAILABLE: ApiResult = {
  status: 503,
  body: {
    error: {
      code: "snapshot_unavailable",
      message: "the stored site could not be read — try again shortly",
    },
  },
};

/**
 * GET /api/attempts/:id/site/export — the candidate's own T1 site, as the ZIP
 * it was scored as. Always available in server mode, needs no third party,
 * and is the floor every richer export (GitHub, then Vercel) degrades to.
 */
export async function handleExportSite(
  ctx: T1ApiContext,
  headers: HeaderMap,
  attemptId: string,
): Promise<SiteExportZip | ApiResult> {
  return withOwnedAttempt<SiteExportZip>(ctx, headers, attemptId, async () => {
    const submission = await recordedSubmission(ctx.db, attemptId);
    if (submission === null) return NO_SUBMISSION;
    const exported = await exportSnapshotZip(ctx.snapshots, submission.digest);
    return exported ?? SNAPSHOT_UNAVAILABLE;
  });
}

/** Narrow a `withOwnedAttempt` union without re-testing its shape everywhere. */
export function isSiteExportZip(result: SiteExportZip | ApiResult): result is SiteExportZip {
  return "zip" in result;
}

/**
 * Response headers for an export download — defined once, because both hosts
 * (the Next routes and the standalone service) serve the same bytes and a
 * second spelling would let one of them drift.
 *
 * `private, no-store`: the archive is content-addressed and immutable, but it
 * is also the candidate's own artifact behind an authenticated route, so no
 * shared cache may keep a copy. `nosniff` because a browser must not be
 * talked into rendering an archive as anything else.
 */
export function siteExportHeaders(filename: string): Record<string, string> {
  return {
    "content-type": SITE_ZIP_CONTENT_TYPE,
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
}

// ---------------------------------------------------------------------------
// Step 2 — GitHub. See ./github.ts for the device-flow and scope rationale.
// ---------------------------------------------------------------------------

/** Everything the GitHub handlers need on top of the T1 context. */
export interface GithubExportContext extends T1ApiContext {
  /** null when this deployment sets no AILX_GITHUB_CLIENT_ID. */
  githubClientId: string | null;
  /** Injected so tests need no network; defaults to the global fetch. */
  http?: HttpFetch;
}

const NOT_CONFIGURED: ApiResult = {
  status: 501,
  body: {
    error: {
      code: "github_not_configured",
      message: "this deployment cannot export to GitHub — download the ZIP instead",
    },
  },
};

/** HTTP status for each way a GitHub export can fail. */
const GITHUB_STATUS: Record<GithubErrorCode, number> = {
  github_not_configured: 501,
  // 202: nothing is wrong — the candidate simply has not approved yet, and
  // the client keeps polling. A 4xx here would look like a failure.
  authorization_pending: 202,
  authorization_failed: 401,
  repo_name_unavailable: 409,
  github_unavailable: 502,
};

function githubErrorResult(err: GithubExportError): ApiResult {
  return {
    status: GITHUB_STATUS[err.code],
    body: {
      error: {
        code: err.code,
        message: err.message,
        ...(err.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: err.retryAfterSeconds }),
      },
    },
  };
}

/**
 * The ownership + configuration + submission preamble both GitHub handlers
 * need, and the GithubExportError → ApiResult mapping they both share.
 */
async function withExportableSubmission(
  ctx: GithubExportContext,
  headers: HeaderMap,
  attemptId: string,
  fn: (clientId: string, submission: RecordedSubmission) => Promise<ApiResult>,
): Promise<ApiResult> {
  const result = await withOwnedAttempt(ctx, headers, attemptId, async () => {
    const clientId = ctx.githubClientId;
    if (clientId === null) return NOT_CONFIGURED;
    const submission = await recordedSubmission(ctx.db, attemptId);
    if (submission === null) return NO_SUBMISSION;
    try {
      return await fn(clientId, submission);
    } catch (err) {
      if (err instanceof GithubExportError) return githubErrorResult(err);
      throw err;
    }
  });
  return result;
}

/**
 * POST /api/attempts/:id/site/github/start — begin the device flow.
 *
 * Ownership and the existence of a submission are checked BEFORE GitHub is
 * touched, so nobody can spend our GitHub rate limit on an attempt that is
 * not theirs, and no candidate is asked to authorize an export that would
 * then have nothing to export.
 */
export async function handleGithubExportStart(
  ctx: GithubExportContext,
  headers: HeaderMap,
  attemptId: string,
): Promise<ApiResult> {
  return withExportableSubmission(ctx, headers, attemptId, async (clientId) => {
    const grant = await requestDeviceCode(ctx.http ?? fetch, clientId);
    return {
      status: 200,
      body: {
        authorization: {
          deviceCode: grant.deviceCode,
          userCode: grant.userCode,
          verificationUri: grant.verificationUri,
          intervalSeconds: grant.intervalSeconds,
          expiresInSeconds: grant.expiresInSeconds,
          // Echoed so the UI states the grant it is actually asking for
          // rather than a scope hard-coded in a component.
          scope: grant.scope,
        },
      },
    };
  });
}

export interface GithubExportInputBody {
  deviceCode: string;
  repoName?: string;
  /** Absolute origin of the hosted snapshot, for the README's live link. */
  publicOrigin?: string | null;
}

/**
 * POST /api/attempts/:id/site/github — redeem the device code and, if the
 * candidate has approved, create the repository and push the site.
 *
 * ONE request does redemption and export together, on purpose: the access
 * token then exists only inside this call. It is never returned to the
 * browser, never written to the database, and never logged. While the
 * candidate is still approving, this answers 202 and the client polls.
 */
export async function handleGithubExport(
  ctx: GithubExportContext,
  headers: HeaderMap,
  attemptId: string,
  body: unknown,
): Promise<ApiResult> {
  const input = (typeof body === "object" && body !== null ? body : {}) as Partial<GithubExportInputBody>;
  const deviceCode = typeof input.deviceCode === "string" ? input.deviceCode : "";
  if (deviceCode === "") {
    return {
      status: 400,
      body: { error: { code: "bad_request", message: "deviceCode is required" } },
    };
  }
  const requested = typeof input.repoName === "string" && input.repoName.trim() !== ""
    ? input.repoName
    : DEFAULT_REPO_NAME;
  const repoName = sanitizeRepoName(requested);
  if (repoName === null) {
    return {
      status: 400,
      body: {
        error: {
          code: "bad_request",
          message: "that repository name has no usable characters — letters, digits, . _ - only",
        },
      },
    };
  }

  return withExportableSubmission(ctx, headers, attemptId, async (clientId, submission) => {
    const http = ctx.http ?? fetch;
    const files = await loadSnapshotFiles(ctx.snapshots, submission.digest);
    // Read the bytes BEFORE redeeming: a token we cannot use is a token we
    // should never have asked GitHub for.
    if (files === null) return SNAPSHOT_UNAVAILABLE;
    const token = await redeemDeviceCode(http, clientId, deviceCode);
    const repo = await exportToGithub(http, token, {
      repoName,
      files,
      digest: submission.digest,
      submittedAt: submission.submittedAt,
      publicOrigin: normalizeOrigin(input.publicOrigin),
    });
    return {
      status: 201,
      body: {
        repo: {
          owner: repo.owner,
          name: repo.name,
          htmlUrl: repo.htmlUrl,
          defaultBranch: repo.defaultBranch,
        },
        // Step 3 of the ladder, and the only Vercel path that genuinely
        // exists for a multi-file static site (see ./github.ts).
        deployUrl: vercelDeployUrl(repo),
      },
    };
  });
}

/**
 * The README's live link must be an origin, not an attacker's URL: it is
 * rendered in a file that lands in the candidate's public repository, so a
 * caller-supplied value with a path, a query or a `javascript:` scheme is
 * dropped rather than half-honoured. Same rule as the frontend's apiOrigin.
 */
function normalizeOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  return url.origin;
}
