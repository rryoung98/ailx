/**
 * T1 site submission — the client side of POST /api/attempts/:id/site.
 *
 * In server mode the submitted T1 artifact (a single self-contained HTML
 * document) is packaged as a store-only ZIP and uploaded, yielding a live,
 * sandboxed, content-addressed URL (see siteUrlPath in @ailx/backend). The ZIP writer is
 * deliberately deterministic (store method, zeroed timestamps): the same
 * document always produces the same bytes, so the same digest — which makes
 * accidental resubmits idempotent replays server-side instead of 409s.
 *
 * The upload is strictly additive to the local flow: the artifact lives in
 * the event log (and is scored) whether or not the upload ever succeeds.
 */
import { writeStoredZip, type ZipFile } from "@ailx/core";
import { isServerMode } from "./mode";
import type { StorageLike } from "@ailx/session";
import { canonicalSitePath, siteUrlPath } from "@ailx/backend";
import { authHeaders } from "./authHeaders";
import {
  browserApiOptions,
  getAttemptPersistence,
  getServerAttemptId,
  type ApiPersistenceOptions,
} from "./persistence";

// ---------------------------------------------------------------------------
// Store-only ZIP writer — @ailx/core owns it, because the EXPORT path
// (packages/backend/src/t1/export.ts) repacks a stored snapshot with the same
// writer. One writer, one set of bytes: a site downloaded from an export
// re-uploads to the content address it was scored under.
// ---------------------------------------------------------------------------

export type SiteFile = ZipFile;

/** The T1 spelling of `writeStoredZip`, re-exported so call sites keep one import. */
export const buildSiteZip = writeStoredZip;

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Reserved response seq for the (single) site submission. The log mirror
 * owns the small contiguous seqs (one per session-log entry); this sits far
 * outside that range so the two can never collide on the append-only
 * (attempt_id, seq) key. Still well inside the server's 32-bit seq bound.
 */
export const T1_SITE_SEQ = 1 << 30;

export type SiteUploadFailureKind =
  /** 409 — the attempt already holds a DIFFERENT site submission. */
  | "conflict"
  /** 400/413 — the ZIP failed server-side validation (message = validator's). */
  | "rejected"
  /** Network failure / backend down / attempt not yet mirrored — retryable. */
  | "unavailable";

export type SiteUploadResult =
  | { ok: true; digest: string; url: string; created: boolean }
  | { ok: false; kind: SiteUploadFailureKind; message: string };

export interface SiteSubmission {
  digest: string;
  url: string;
}

/**
 * A 413 with no JSON error envelope did not come from our validator: a
 * serverless platform caps the request body (Vercel at ~4.5 MB) well below
 * T1_LIMITS.maxTotalBytes, and rejects the upload before the handler runs.
 * Explain that instead of showing a bare status code. See docs/DEPLOY.md §5.
 */
export const PLATFORM_TOO_LARGE_MESSAGE =
  "This site is too large for the hosted upload limit (about 4.5 MB per request). Your work is saved locally and still scored.";

const siteKey = (clientAttemptId: string) => `ailx:site:v1:${clientAttemptId}`;

/** The recorded live-site submission for an attempt, if any (report page). */
export function loadSiteSubmission(storage: StorageLike, clientAttemptId: string): SiteSubmission | null {
  try {
    const raw = storage.getItem(siteKey(clientAttemptId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SiteSubmission>;
    if (typeof parsed.digest === "string" && typeof parsed.url === "string") {
      // Records written before the canonical URL was index.html hold the
      // trailing-slash form, which now redirects; canonicalise on read so an
      // in-flight run's report links straight at the served file.
      return { digest: parsed.digest, url: canonicalSitePath(parsed.url) };
    }
  } catch {
    // Corrupt record — treat as absent; the snapshot itself lives server-side.
  }
  return null;
}

export function clearSiteSubmission(storage: StorageLike, clientAttemptId: string): void {
  storage.removeItem(siteKey(clientAttemptId));
}

/**
 * Turn one submission response — from the plain POST or from
 * /site/finalize, which answer identically — into a typed result,
 * remembering the live URL on success.
 */
async function siteResultFrom(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  clientAttemptId: string,
  res: Response,
): Promise<SiteUploadResult> {
  if (res.ok) {
    const body = (await res.json()) as { submission?: { digest?: string; created?: boolean } };
    const digest = body.submission?.digest;
    if (typeof digest !== "string") {
      return { ok: false, kind: "unavailable", message: "The server returned an unexpected response." };
    }
    const url = siteUrlPath(digest, opts.siteRoot);
    try {
      storage.setItem(siteKey(clientAttemptId), JSON.stringify({ digest, url }));
    } catch {
      // Quota/private mode: the link still shows this session; the snapshot
      // remains recoverable server-side via the responses row.
    }
    return { ok: true, digest, url, created: body.submission?.created === true };
  }

  let message = res.status === 413 ? PLATFORM_TOO_LARGE_MESSAGE : `Upload failed (HTTP ${res.status}).`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (typeof body.error?.message === "string") message = body.error.message;
  } catch {
    // Non-JSON error body — keep the status-based message.
  }
  if (res.status === 409) return { ok: false, kind: "conflict", message };
  if (res.status === 400 || res.status === 413) return { ok: false, kind: "rejected", message };
  return { ok: false, kind: "unavailable", message };
}

/**
 * Above this size the plain POST cannot work on a serverless host
 * (the platform caps a request body at ~4.5 MB and answers 413 before
 * our handler runs), so the client asks for a direct upload instead.
 * Below it the POST is one round trip against no extra service, and
 * stays exactly as it was.
 */
export const DIRECT_UPLOAD_MIN_BYTES = 4 * 1024 * 1024;

interface UploadTicket {
  uploadId: string;
  pathname: string;
  token: string;
  contentType: string;
}

/** The ticket, or null when this deployment offers no direct upload. */
async function requestUploadTicket(
  opts: ApiPersistenceOptions,
  storage: StorageLike,
  serverAttemptId: string,
): Promise<UploadTicket | null> {
  let res: Response;
  try {
    res = await opts.fetchFn(`${opts.baseUrl}/attempts/${serverAttemptId}/site/upload-ticket`, {
      method: "POST",
      headers: await authHeaders(storage),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null; // 501 (fs-mode host), 404, 401 — all mean "POST it".
  try {
    const body = (await res.json()) as { upload?: Partial<UploadTicket> };
    const t = body.upload;
    if (
      typeof t?.uploadId === "string" &&
      typeof t.pathname === "string" &&
      typeof t.token === "string" &&
      typeof t.contentType === "string"
    ) {
      return { uploadId: t.uploadId, pathname: t.pathname, token: t.token, contentType: t.contentType };
    }
  } catch {
    // Unexpected body — treat as no ticket.
  }
  return null;
}

/**
 * Client-direct upload: PUT the ZIP into the object store with the
 * server's scoped token, then ask the server to validate and record
 * it. Returns null when the handshake is unavailable, so the caller
 * can still try the plain POST.
 *
 * The token names one key, one content type and one size cap, all
 * chosen server-side; this function cannot widen any of them, and the
 * bytes are worth nothing until /site/finalize accepts them.
 */
async function uploadSiteZipDirect(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  clientAttemptId: string,
  serverAttemptId: string,
  zip: Uint8Array<ArrayBuffer>,
): Promise<SiteUploadResult | null> {
  const ticket = await requestUploadTicket(opts, storage, serverAttemptId);
  if (ticket === null) return null;

  try {
    const { put } = await import("@vercel/blob/client");
    await put(ticket.pathname, new Blob([zip], { type: ticket.contentType }), {
      access: "private",
      token: ticket.token,
      contentType: ticket.contentType,
      multipart: true, // Resumes part-wise instead of restarting a 25 MB PUT.
    });
  } catch {
    // Refused (cap/scope), offline, or blocked: nothing was recorded,
    // and the staged object — if any — expires unreferenced.
    return {
      ok: false,
      kind: "unavailable",
      message: "The upload could not be completed — your work is saved locally.",
    };
  }

  let res: Response;
  try {
    res = await opts.fetchFn(`${opts.baseUrl}/attempts/${serverAttemptId}/site/finalize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(await authHeaders(storage)),
        "x-ailx-client-ts": new Date().toISOString(),
      },
      body: JSON.stringify({ uploadId: ticket.uploadId, seq: T1_SITE_SEQ }),
    });
  } catch {
    return {
      ok: false,
      kind: "unavailable",
      message: "The backend could not be reached — your work is saved locally.",
    };
  }
  return siteResultFrom(storage, opts, clientAttemptId, res);
}

/**
 * Upload the site ZIP against the mirrored server attempt. Never throws:
 * every failure mode collapses to a typed result the UI can explain.
 *
 * Large sites go through the client-direct path (the platform would
 * reject the request body first); small ones keep the single POST.
 */
export async function uploadSiteZip(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  clientAttemptId: string,
  zip: Uint8Array<ArrayBuffer>,
): Promise<SiteUploadResult> {
  const serverAttemptId = getServerAttemptId(storage, clientAttemptId);
  if (!serverAttemptId) {
    // Offline-start fallback: the mirror creates the server attempt on its
    // next successful pass — a retry then finds it here.
    return {
      ok: false,
      kind: "unavailable",
      message: "This run is not mirrored to the server yet — your work is saved locally.",
    };
  }

  if (zip.length >= DIRECT_UPLOAD_MIN_BYTES) {
    const direct = await uploadSiteZipDirect(storage, opts, clientAttemptId, serverAttemptId, zip);
    // null = no direct target here (local/fs host, or an older
    // deployment): the POST below still works up to the host's cap.
    if (direct !== null) return direct;
  }

  let res: Response;
  try {
    res = await opts.fetchFn(
      `${opts.baseUrl}/attempts/${serverAttemptId}/site?seq=${T1_SITE_SEQ}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/zip",
          ...(await authHeaders(storage)),
          "x-ailx-client-ts": new Date().toISOString(),
        },
        body: zip,
      },
    );
  } catch {
    return {
      ok: false,
      kind: "unavailable",
      message: "The backend could not be reached — your work is saved locally.",
    };
  }
  return siteResultFrom(storage, opts, clientAttemptId, res);
}

/**
 * Browser entry point, called when the T1 track completes. Returns null —
 * and does nothing — outside server mode (static showcase unchanged), during
 * SSR, or when the artifact has no document to serve (empty checkpoint on a
 * timed-out track). Otherwise resolves to a typed upload result.
 */
export function submitT1Site(clientAttemptId: string, artifact: unknown): Promise<SiteUploadResult> | null {
  if (!isServerMode() || typeof window === "undefined") return null;
  const html = (artifact as { html?: unknown } | null | undefined)?.html;
  if (typeof html !== "string" || html.trim() === "") return null;
  const zip = buildSiteZip([{ path: "index.html", data: new TextEncoder().encode(html) }]);
  const storage = window.localStorage;
  const opts = browserApiOptions();
  // Let the log mirror settle first: on the offline-start fallback path the
  // mirror's next pass is what creates the server attempt this upload needs.
  return getAttemptPersistence()
    .flush()
    .then(() => uploadSiteZip(storage, opts, clientAttemptId, zip));
}
