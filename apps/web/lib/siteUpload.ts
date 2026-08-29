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
import { crc32 } from "@ailx/core";
import { isServerMode } from "./mode";
import type { StorageLike } from "@ailx/session";
import { DEV_USER_HEADER, canonicalSitePath, siteUrlPath } from "@ailx/backend";
import {
  browserApiOptions,
  devUser,
  getAttemptPersistence,
  getServerAttemptId,
  type ApiPersistenceOptions,
} from "./persistence";

// ---------------------------------------------------------------------------
// Store-only ZIP writer — the byte-level mirror of the backend's readZip
// validator (packages/backend/src/t1/zip.ts): store method only, UTF-8
// names, CRC-32 from @ailx/core, no zip64/encryption/extra fields.
// ---------------------------------------------------------------------------

export interface SiteFile {
  path: string;
  data: Uint8Array;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * Build a ZIP archive with every entry stored (method 0) and all timestamps
 * zeroed — deterministic bytes for deterministic content addressing.
 */
export function buildSiteZip(files: readonly SiteFile[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path);
    const crc = crc32(f.data);

    const local = new Uint8Array(30 + name.length + f.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true); // version needed: 2.0
    // flags(6), method(8: store), dos time(10), dos date(12) all stay 0.
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true); // compressed == uncompressed (store)
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    // extra length(28) stays 0.
    local.set(name, 30);
    local.set(f.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 20, true); // version made by: 2.0, host 0 (DOS — no unix attrs)
    cv.setUint16(6, 20, true); // version needed
    // flags/method/time/date (8..14) stay 0.
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    // extra/comment lengths, disk, attributes (30..41) stay 0.
    cv.setUint32(42, offset, true); // local header offset
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }

  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const chunk of [...locals, ...centrals]) {
    out.set(chunk, p);
    p += chunk.length;
  }
  const ev = new DataView(out.buffer, p);
  ev.setUint32(0, SIG_EOCD, true);
  // disk numbers (4, 6) stay 0.
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  // comment length (20) stays 0.
  return out;
}

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
 * Upload the site ZIP against the mirrored server attempt. Never throws:
 * every failure mode collapses to a typed result the UI can explain.
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

  let res: Response;
  try {
    res = await opts.fetchFn(
      `${opts.baseUrl}/attempts/${serverAttemptId}/site?seq=${T1_SITE_SEQ}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/zip",
          [DEV_USER_HEADER]: devUser(storage),
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

  if (res.ok) {
    const body = (await res.json()) as { submission?: { digest?: string; created?: boolean } };
    const digest = body.submission?.digest;
    if (typeof digest !== "string") {
      return { ok: false, kind: "unavailable", message: "The server returned an unexpected response." };
    }
    const url = siteUrlPath(digest, opts.baseUrl);
    try {
      storage.setItem(siteKey(clientAttemptId), JSON.stringify({ digest, url }));
    } catch {
      // Quota/private mode: the link still shows this session; the snapshot
      // remains recoverable server-side via the responses row.
    }
    return { ok: true, digest, url, created: body.submission?.created === true };
  }

  let message = `Upload failed (HTTP ${res.status}).`;
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
