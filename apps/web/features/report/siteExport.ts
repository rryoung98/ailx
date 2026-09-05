/**
 * T1 artifact export — the client side of "take your site with you".
 *
 * The ladder, in order of certainty (docs/FUTURE-TRACKS.md: when a candidate
 * wants to go further, OFFBOARD them — AILX is not a site builder):
 *
 *  1. DOWNLOAD. Always available in server mode, needs no third party, and is
 *     the exact bytes that were scored. Everything else degrades to it.
 *  2. GITHUB. The candidate authorizes AILX on GitHub (device flow,
 *     `public_repo` only) and the server creates ONE public repository with
 *     their site in it. Unavailable deployments answer 501 and the UI says so.
 *  3. VERCEL. A "Deploy with Vercel" link off the repository from step 2 —
 *     Vercel's documented clone contract, which can only clone a public git
 *     repository and therefore cannot exist before step 2.
 *
 * There is deliberately no "Open in v0" button: see V0_NOTE below.
 */
import { apiPath, DEFAULT_REPO_NAME } from "@ailx/contract";
import type { StorageLike } from "@ailx/session";
import { serviceHeaders } from "../../lib/data/traceparent";
import { isServerMode } from "../../lib/mode";
import {
  browserApiOptions,
  getServerAttemptId,
  type ApiPersistenceOptions,
} from "../../lib/data/persistence";

/**
 * Why there is no v0 button.
 *
 * v0 (v0.app) has no supported programmatic import for a multi-file PLAIN
 * static site belonging to someone else's account. Its Platform API is keyed
 * by an API key — ours, not the candidate's, which would put their site in
 * OUR v0 account and bill us for it. The shadcn "Open in v0" URL takes a
 * registry item, a React/shadcn component format that says nothing about
 * plain HTML. What v0 DOES document is uploading a ZIP in its own UI, which
 * is exactly what step 1 produces. So we say that, instead of shipping a
 * button that half works.
 */
export const V0_NOTE =
  "v0 has no supported way to import a site from another app. Download the ZIP above, then upload it in v0.";

export const V0_URL = "https://v0.app";

/**
 * Default repository name, re-exported from the server's own constant so the
 * field the candidate sees is pre-filled with the name the server would pick.
 */
export const DEFAULT_EXPORT_REPO_NAME = DEFAULT_REPO_NAME;

/** Every way an export attempt can end, for one UI vocabulary. */
export type ExportFailure =
  /** This deployment has no GitHub export (or no backend at all). */
  | "unsupported"
  /** Nothing to export — no site submission is recorded for this attempt. */
  | "no_submission"
  /** The candidate has not approved on GitHub yet. Keep polling. */
  | "pending"
  /** The device authorization expired or was declined. Start again. */
  | "authorization_failed"
  /** GitHub refused the repository name. */
  | "name_taken"
  /** Network, backend or GitHub failure — retryable. */
  | "unavailable";

export interface ExportError {
  kind: ExportFailure;
  message: string;
  /** Seconds to wait before the next poll, when the server said. */
  retryAfterSeconds?: number;
}

export type ExportResult<T> = { ok: true; value: T } | { ok: false } & ExportError;

/** The export routes, which all take the attempt id and nothing else. */
type ExportRoute = "exportSite" | "startGithubExport" | "finishGithubExport";

/** The exam-service URL for one of this attempt's export routes. */
function exportUrl(opts: ApiPersistenceOptions, serverAttemptId: string, route: ExportRoute): string {
  return `${opts.baseUrl}${apiPath(route, { id: serverAttemptId })}`;
}

/**
 * Did this response fail? `res.ok` is not the whole answer: the GitHub export
 * answers 202 while the candidate is still approving, which `fetch` calls a
 * success and the UI must treat as "keep waiting".
 */
function failed(res: Response): boolean {
  return !res.ok || res.status === 202;
}

/** Map one failed response onto the vocabulary above. */
async function failureFrom(res: Response): Promise<ExportError> {
  let code = "";
  let message = `Export failed (HTTP ${res.status}).`;
  let retryAfterSeconds: number | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; retryAfterSeconds?: number };
    };
    code = body.error?.code ?? "";
    if (typeof body.error?.message === "string") message = body.error.message;
    if (typeof body.error?.retryAfterSeconds === "number") {
      retryAfterSeconds = body.error.retryAfterSeconds;
    }
  } catch {
    // Non-JSON body — keep the status-based message.
  }
  const kind: ExportFailure =
    code === "github_not_configured" || res.status === 501
      ? "unsupported"
      : code === "authorization_pending"
        ? "pending"
        : code === "authorization_failed"
          ? "authorization_failed"
          : code === "repo_name_unavailable"
            ? "name_taken"
            : res.status === 404
              ? "no_submission"
              : "unavailable";
  return { kind, message, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
}

const OFFLINE: ExportError = {
  kind: "unavailable",
  message: "The backend could not be reached — try again.",
};

const NOT_MIRRORED: ExportError = {
  kind: "unsupported",
  message: "This run is not saved on the Foray backend, so there is nothing to export.",
};

/** The server attempt id, or null when this run was never mirrored. */
function serverAttempt(storage: StorageLike, clientAttemptId: string): string | null {
  if (!isServerMode()) return null;
  const id = getServerAttemptId(storage, clientAttemptId);
  return id === undefined || id === "" ? null : id;
}

// ---------------------------------------------------------------------------
// 1. Download
// ---------------------------------------------------------------------------

/**
 * Save `blob` under `filename`. Kept here rather than in a component so the
 * two download paths in this app agree on one mechanism.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** `filename` out of a Content-Disposition header, or a sane fallback. */
export function exportFilename(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "ailx-site.zip";
}

/**
 * Fetch the site ZIP and save it. Not a plain `<a href>`: the route is
 * authenticated, and identity travels in a HEADER (see ./authHeaders) which a
 * navigation cannot carry — cross-origin the cookie is not sent either.
 */
export async function downloadSiteZip(
  storage: StorageLike,
  clientAttemptId: string,
  opts: ApiPersistenceOptions = browserApiOptions(),
): Promise<ExportResult<{ filename: string; bytes: number }>> {
  const serverAttemptId = serverAttempt(storage, clientAttemptId);
  if (serverAttemptId === null) return { ok: false, ...NOT_MIRRORED };
  let res: Response;
  try {
    res = await opts.fetchFn(exportUrl(opts, serverAttemptId, "exportSite"), {
      headers: await serviceHeaders(storage),
    });
  } catch {
    return { ok: false, ...OFFLINE };
  }
  if (failed(res)) return { ok: false, ...(await failureFrom(res)) };
  const blob = await res.blob();
  const filename = exportFilename(res.headers.get("content-disposition"));
  downloadBlob(filename, blob);
  return { ok: true, value: { filename, bytes: blob.size } };
}

// ---------------------------------------------------------------------------
// 2. GitHub
// ---------------------------------------------------------------------------

export interface GithubAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
  /** The scope GitHub recorded — shown verbatim, never hard-coded in the UI. */
  scope: string;
}

/** Ask the server to begin GitHub's device flow. */
export async function startGithubExport(
  storage: StorageLike,
  clientAttemptId: string,
  opts: ApiPersistenceOptions = browserApiOptions(),
): Promise<ExportResult<GithubAuthorization>> {
  const serverAttemptId = serverAttempt(storage, clientAttemptId);
  if (serverAttemptId === null) return { ok: false, ...NOT_MIRRORED };
  let res: Response;
  try {
    res = await opts.fetchFn(exportUrl(opts, serverAttemptId, "startGithubExport"), {
      method: "POST",
      headers: await serviceHeaders(storage),
    });
  } catch {
    return { ok: false, ...OFFLINE };
  }
  if (failed(res)) return { ok: false, ...(await failureFrom(res)) };
  const body = (await res.json()) as { authorization?: Partial<GithubAuthorization> };
  const a = body.authorization;
  if (
    typeof a?.deviceCode !== "string" ||
    typeof a.userCode !== "string" ||
    typeof a.verificationUri !== "string"
  ) {
    return { ok: false, kind: "unavailable", message: "The server returned an unexpected response." };
  }
  return {
    ok: true,
    value: {
      deviceCode: a.deviceCode,
      userCode: a.userCode,
      verificationUri: a.verificationUri,
      intervalSeconds: typeof a.intervalSeconds === "number" ? a.intervalSeconds : 5,
      expiresInSeconds: typeof a.expiresInSeconds === "number" ? a.expiresInSeconds : 900,
      scope: typeof a.scope === "string" ? a.scope : "public_repo",
    },
  };
}

export interface ExportedRepo {
  owner: string;
  name: string;
  htmlUrl: string;
  defaultBranch: string;
  /** Vercel's documented clone URL for this repository. */
  deployUrl: string;
}

/**
 * One poll: redeem the device code and, once approved, export. `pending` is
 * the normal answer until the candidate finishes on GitHub.
 */
export async function pollGithubExport(
  storage: StorageLike,
  clientAttemptId: string,
  input: { deviceCode: string; repoName: string },
  opts: ApiPersistenceOptions = browserApiOptions(),
): Promise<ExportResult<ExportedRepo>> {
  const serverAttemptId = serverAttempt(storage, clientAttemptId);
  if (serverAttemptId === null) return { ok: false, ...NOT_MIRRORED };
  let res: Response;
  try {
    res = await opts.fetchFn(exportUrl(opts, serverAttemptId, "finishGithubExport"), {
      method: "POST",
      headers: { "content-type": "application/json", ...(await serviceHeaders(storage)) },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, ...OFFLINE };
  }
  if (failed(res)) return { ok: false, ...(await failureFrom(res)) };
  const body = (await res.json()) as {
    repo?: Partial<ExportedRepo>;
    deployUrl?: unknown;
  };
  const repo = body.repo;
  if (typeof repo?.htmlUrl !== "string" || typeof repo.name !== "string") {
    return { ok: false, kind: "unavailable", message: "The server returned an unexpected response." };
  }
  return {
    ok: true,
    value: {
      owner: typeof repo.owner === "string" ? repo.owner : "",
      name: repo.name,
      htmlUrl: repo.htmlUrl,
      defaultBranch: typeof repo.defaultBranch === "string" ? repo.defaultBranch : "main",
      deployUrl: typeof body.deployUrl === "string" ? body.deployUrl : "",
    },
  };
}
