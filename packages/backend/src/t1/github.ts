/**
 * GitHub export — "take your T1 site with you", step 2 of the offboarding
 * ladder in ./export.ts (Download → GitHub → Vercel).
 *
 * WHY DEVICE FLOW, not the OAuth web flow. Both are supported by GitHub; the
 * device flow is the one that fits this deployment shape.
 *
 *  - It needs NO client secret. GitHub's device token exchange takes
 *    client_id + device_code + grant_type and nothing else, so this feature
 *    adds no secret to any environment — the one credential (`client_id`) is
 *    public by design, exactly as it is for a CLI.
 *  - It needs NO registered redirect URI. The frontend can be served from
 *    GitHub Pages, a Vercel preview or the exam service's own origin
 *    (NEXT_PUBLIC_AILX_API_BASE), and a web-flow callback would have to land
 *    on ONE of those and bounce to the others.
 *  - The access token never reaches the browser, a URL or a log. It is
 *    redeemed inside the request that uses it, held in one local variable,
 *    and dropped when that request ends. Nothing persists it.
 *
 * SCOPE: `public_repo`, and nothing else. GitHub's own "create a repository
 * for the authenticated user" doc says public_repo is sufficient to create a
 * PUBLIC repository and write its contents; `repo` would additionally grant
 * read/write over every PRIVATE repository the candidate can see, which this
 * feature has no business holding. The consequence is stated plainly in the
 * UI: AILX can create public repositories, and can see nothing private.
 *
 * WHAT IS EXPORTED: the candidate's own stored snapshot, plus a README this
 * module generates. No rubric, no judge prompt, no item, no score — the site
 * is the candidate's, the marking is not.
 */

import { DEFAULT_REPO_NAME, siteUrlPath } from "@ailx/contract";
import type { SnapshotFile } from "./snapshot.js";

/** The single OAuth scope this feature asks for. See the module note. */
export const GITHUB_EXPORT_SCOPE = "public_repo";

export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API_ROOT = "https://api.github.com";
export const GITHUB_DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/** Branch every export commits to — GitHub's default for a new repository. */
export const GITHUB_DEFAULT_BRANCH = "main";

/** Regular file, non-executable: the only tree mode a static site needs. */
const BLOB_MODE = "100644";

/**
 * How many blob uploads are in flight at once. One request per file, so a
 * 500-file submission (T1_LIMITS.maxFiles) is 500 round trips; sequential
 * that outlives a serverless invocation, and unbounded it invites secondary
 * rate limiting. Modest concurrency is the honest middle.
 */
const BLOB_CONCURRENCY = 8;

/** Injected so tests need no network. Satisfied by the global `fetch`. */
export type HttpFetch = typeof fetch;

export const GITHUB_ERROR_CODES = [
  /** No AILX_GITHUB_CLIENT_ID — this deployment offers no GitHub export. */
  "github_not_configured",
  /** The candidate has not finished authorizing yet. Not a failure: poll on. */
  "authorization_pending",
  /** The device code expired, or the candidate refused. Start again. */
  "authorization_failed",
  /** GitHub refused the repository name (taken, reserved, malformed). */
  "repo_name_unavailable",
  /** Anything else GitHub said no to, or said nothing intelligible to. */
  "github_unavailable",
] as const;

export type GithubErrorCode = (typeof GITHUB_ERROR_CODES)[number];

export class GithubExportError extends Error {
  constructor(
    public readonly code: GithubErrorCode,
    message: string,
    /** Seconds the caller should wait before polling again, when GitHub said. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GithubExportError";
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const GITHUB_CLIENT_ID_ENV = "AILX_GITHUB_CLIENT_ID";

/**
 * The client id, or null when this deployment has no GitHub export. Null is a
 * first-class answer: the route answers 501 and the UI shows Download alone,
 * which is the whole point of ordering the ladder by certainty.
 */
export function githubClientId(env: Readonly<Record<string, string | undefined>>): string | null {
  const id = env[GITHUB_CLIENT_ID_ENV];
  return id === undefined || id.trim() === "" ? null : id.trim();
}

// ---------------------------------------------------------------------------
// Repository naming
// ---------------------------------------------------------------------------

// What a candidate gets if they do not type a name — defined in the
// client-safe barrel so the browser can pre-fill the same value.
export { DEFAULT_REPO_NAME };

const REPO_NAME_MAX = 100;

/**
 * GitHub accepts `[A-Za-z0-9._-]` in a repository name and silently rewrites
 * anything else, so we rewrite it HERE instead: a candidate who typed
 * "My Site!" must be shown the name that will actually exist. Returns null
 * when nothing usable survives, rather than inventing a name they did not ask
 * for.
 */
export function sanitizeRepoName(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "")
    .slice(0, REPO_NAME_MAX)
    .replace(/[-.]+$/, "");
  // "." and ".." are directory names, not repository names.
  return cleaned === "" || cleaned === "." || cleaned === ".." ? null : cleaned;
}

// ---------------------------------------------------------------------------
// README — the only file AILX adds
// ---------------------------------------------------------------------------

export interface ExportReadmeInput {
  repoName: string;
  /** ISO-8601 submission time, from the server's own stamp. */
  submittedAt: string;
  /** `sha256:<hex>` content address of the snapshot. */
  digest: string;
  fileCount: number;
  totalBytes: number;
  /** Absolute URL of the hosted snapshot, or null when unknown. */
  liveUrl: string | null;
  /** "Deploy with Vercel" target, or null before the repo exists. */
  deployUrl: string | null;
}

/**
 * The README that ships with the exported repository.
 *
 * Deliberately says what the sitting WAS and never what it SCORED: a score is
 * a claim AILX makes through a credential (docs/CREDENTIAL.md), not a line a
 * candidate can edit in their own repository. It also states, in the file
 * itself, that nothing about the marking travels with the code — so a reader
 * of the repo knows the item bank did not leak into it.
 */
export function exportReadme(input: ExportReadmeInput): string {
  const built = input.submittedAt.slice(0, 10);
  const lines = [
    `# ${input.repoName}`,
    "",
    "A static site built during an AILX Track 1 (Creative Build) sitting, and exported by its author.",
    "",
    `- Built: ${built}`,
    `- Files: ${input.fileCount} (${input.totalBytes} bytes)`,
    `- AILX content address: \`${input.digest}\``,
  ];
  if (input.liveUrl !== null) lines.push(`- Snapshot hosted by AILX: ${input.liveUrl}`);
  lines.push(
    "",
    "## Run it",
    "",
    "These are plain static files — no build step. Open `index.html`, or serve the folder:",
    "",
    "```sh",
    "npx serve .",
    "```",
    "",
  );
  if (input.deployUrl !== null) {
    lines.push("## Deploy it", "", `[Deploy with Vercel](${input.deployUrl})`, "");
  }
  lines.push(
    "## What is, and is not, in here",
    "",
    "Everything here is the author's own submitted work. Nothing about the",
    "marking travels with it: no rubric, no judge prompt and no exam item is in",
    "this repository, and it makes no claim about how the sitting was marked.",
    "AILX hosted the snapshot above as a read-only, sandboxed copy; this",
    "repository is the author's to change, deploy and take anywhere.",
    "",
  );
  return lines.join("\n");
}

/** README path in the exported repository — GitHub renders this name. */
export const README_PATH = "README.md";

/**
 * Where the provenance note goes when the candidate's own site already has a
 * README.md. Their file is theirs; ours is additive and never overwrites it.
 */
export const README_FALLBACK_PATH = "AILX-EXPORT.md";

// ---------------------------------------------------------------------------
// Device flow
// ---------------------------------------------------------------------------

export interface DeviceCodeGrant {
  /** Opaque code the SERVER polls with. Safe to hand the browser: alone it
   *  proves nothing, and only the user's own approval turns it into a token. */
  deviceCode: string;
  /** The short code the candidate types into GitHub. */
  userCode: string;
  verificationUri: string;
  /** Minimum seconds between polls, as GitHub set it. */
  intervalSeconds: number;
  expiresInSeconds: number;
  scope: string;
}

async function githubJson(
  http: HttpFetch,
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await http(url, init);
  } catch {
    throw new GithubExportError("github_unavailable", "GitHub could not be reached");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return {
    status: res.status,
    body: typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {},
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Step 1: ask GitHub for a code the candidate can type in. */
export async function requestDeviceCode(http: HttpFetch, clientId: string): Promise<DeviceCodeGrant> {
  const { body } = await githubJson(http, GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: GITHUB_EXPORT_SCOPE }),
  });
  const deviceCode = str(body.device_code);
  const userCode = str(body.user_code);
  const verificationUri = str(body.verification_uri);
  if (deviceCode === null || userCode === null || verificationUri === null) {
    throw new GithubExportError("github_unavailable", "GitHub did not return a device code");
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    intervalSeconds: num(body.interval, 5),
    expiresInSeconds: num(body.expires_in, 900),
    // Echo what GitHub recorded, not what we asked for: the UI must be able
    // to show the grant that actually exists.
    scope: str(body.scope) ?? GITHUB_EXPORT_SCOPE,
  };
}

/**
 * Step 2: redeem the device code, ONCE. Throws `authorization_pending` while
 * the candidate has not finished — the caller polls; it does not sleep here,
 * because a serverless invocation that sleeps for 15 minutes is a bill, not a
 * design.
 */
export async function redeemDeviceCode(
  http: HttpFetch,
  clientId: string,
  deviceCode: string,
): Promise<string> {
  const { body } = await githubJson(http, GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: GITHUB_DEVICE_GRANT_TYPE,
    }),
  });
  const token = str(body.access_token);
  if (token !== null) return token;
  const error = str(body.error);
  if (error === "authorization_pending") {
    throw new GithubExportError("authorization_pending", "waiting for you to approve on GitHub");
  }
  if (error === "slow_down") {
    throw new GithubExportError(
      "authorization_pending",
      "waiting for you to approve on GitHub",
      num(body.interval, 10),
    );
  }
  if (error === "expired_token" || error === "access_denied" || error === "incorrect_device_code") {
    throw new GithubExportError(
      "authorization_failed",
      "the GitHub authorization expired or was declined — start the export again",
    );
  }
  throw new GithubExportError("github_unavailable", "GitHub refused the authorization");
}

// ---------------------------------------------------------------------------
// Repository creation and the single push
// ---------------------------------------------------------------------------

export interface GithubRepo {
  owner: string;
  name: string;
  htmlUrl: string;
  /** `https://github.com/<owner>/<name>.git` — what a deploy button clones. */
  cloneUrl: string;
  defaultBranch: string;
}

function apiHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "ailx-t1-export",
  };
}

async function api(
  http: HttpFetch,
  token: string,
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { status, body: json } = await githubJson(http, `${GITHUB_API_ROOT}${path}`, {
    method,
    headers: apiHeaders(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (status >= 200 && status < 300) return json;
  const message = str(json.message) ?? `GitHub returned HTTP ${status}`;
  if (status === 401 || status === 403) {
    throw new GithubExportError("authorization_failed", "GitHub rejected the authorization");
  }
  if (status === 422) {
    throw new GithubExportError("repo_name_unavailable", message);
  }
  throw new GithubExportError("github_unavailable", message);
}

/** Create the repository in the AUTHENTICATED user's account. */
async function createRepo(
  http: HttpFetch,
  token: string,
  name: string,
  description: string,
): Promise<GithubRepo> {
  const json = await api(http, token, "/user/repos", "POST", {
    name,
    description,
    // Public: `public_repo` cannot create a private one, and asking for a
    // scope that could would be a worse trade than this default.
    private: false,
    // An initial commit exists, so the branch exists, so the ref below is a
    // PATCH of something real rather than a "cannot create a reference for an
    // empty repository" error. The commit we push replaces its tree wholesale.
    auto_init: true,
  });
  const owner = str((json.owner as Record<string, unknown> | undefined)?.login);
  const repoName = str(json.name);
  const htmlUrl = str(json.html_url);
  const cloneUrl = str(json.clone_url);
  if (owner === null || repoName === null || htmlUrl === null || cloneUrl === null) {
    throw new GithubExportError("github_unavailable", "GitHub did not describe the new repository");
  }
  return {
    owner,
    name: repoName,
    htmlUrl,
    cloneUrl,
    defaultBranch: str(json.default_branch) ?? GITHUB_DEFAULT_BRANCH,
  };
}

/** Run `task` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await task(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Base64 without pulling a polyfill: Buffer is already required by pg. */
const base64 = (data: Uint8Array): string =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");

/**
 * Push every file as ONE commit: a blob per file, one tree, one commit,
 * one ref update. The Contents API would be one commit PER file and would
 * need the wider `repo` scope, so it is not used.
 */
async function pushFiles(
  http: HttpFetch,
  token: string,
  repo: GithubRepo,
  files: readonly { path: string; data: Uint8Array }[],
  message: string,
): Promise<void> {
  const base = `/repos/${repo.owner}/${repo.name}`;
  const head = await api(http, token, `${base}/git/ref/heads/${repo.defaultBranch}`, "GET");
  const parent = str((head.object as Record<string, unknown> | undefined)?.sha);
  if (parent === null) {
    throw new GithubExportError("github_unavailable", "GitHub did not report the new repository's head");
  }

  const shas = await mapLimit(files, BLOB_CONCURRENCY, async (file) => {
    // base64 for EVERY file, text included: a static site legitimately holds
    // images and fonts, and one encoding cannot corrupt what another would.
    const blob = await api(http, token, `${base}/git/blobs`, "POST", {
      content: base64(file.data),
      encoding: "base64",
    });
    const sha = str(blob.sha);
    if (sha === null) throw new GithubExportError("github_unavailable", `GitHub did not store ${file.path}`);
    return sha;
  });

  // No base_tree: the tree IS the exported site plus its README, so the
  // auto_init README is replaced rather than left beside ours.
  const tree = await api(http, token, `${base}/git/trees`, "POST", {
    tree: files.map((file, i) => ({
      path: file.path,
      mode: BLOB_MODE,
      type: "blob",
      sha: shas[i],
    })),
  });
  const treeSha = str(tree.sha);
  if (treeSha === null) throw new GithubExportError("github_unavailable", "GitHub did not store the file tree");

  const commit = await api(http, token, `${base}/git/commits`, "POST", {
    message,
    tree: treeSha,
    parents: [parent],
  });
  const commitSha = str(commit.sha);
  if (commitSha === null) throw new GithubExportError("github_unavailable", "GitHub did not store the commit");

  await api(http, token, `${base}/git/refs/heads/${repo.defaultBranch}`, "PATCH", {
    sha: commitSha,
    // The parent IS the head we read, so a fast-forward is the honest update:
    // force would overwrite a concurrent push we did not look at.
    force: false,
  });
}

export interface GithubExportInput {
  repoName: string;
  files: readonly SnapshotFile[];
  digest: string;
  submittedAt: string;
  /** Absolute origin serving the hosted snapshot, or null when unknown. */
  publicOrigin: string | null;
}

/** Commit subject for the one commit an export makes. */
export const EXPORT_COMMIT_MESSAGE = "Export site from AILX Track 1";

const REPO_DESCRIPTION = "Static site built in an AILX Track 1 (Creative Build) sitting.";

/**
 * Create the repository and push the site into it. Everything the candidate's
 * token is used for happens inside this call; the caller drops it afterwards.
 */
export async function exportToGithub(
  http: HttpFetch,
  token: string,
  input: GithubExportInput,
): Promise<GithubRepo> {
  const repo = await createRepo(http, token, input.repoName, REPO_DESCRIPTION);
  const liveUrl =
    input.publicOrigin === null ? null : `${input.publicOrigin}${siteUrlPath(input.digest)}`;
  const readme = exportReadme({
    repoName: repo.name,
    submittedAt: input.submittedAt,
    digest: input.digest,
    fileCount: input.files.length,
    totalBytes: input.files.reduce((sum, f) => sum + f.bytes, 0),
    liveUrl,
    deployUrl: vercelDeployUrl(repo),
  });
  // The candidate's files are never rewritten: if their site already ships a
  // README.md, the provenance note moves aside instead of replacing it. Two
  // entries for one path would also be rejected by the tree API.
  const collides = input.files.some((f) => f.path === README_PATH);
  await pushFiles(
    http,
    token,
    repo,
    [
      ...input.files.map((f) => ({ path: f.path, data: f.data })),
      {
        path: collides ? README_FALLBACK_PATH : README_PATH,
        data: new TextEncoder().encode(readme),
      },
    ],
    EXPORT_COMMIT_MESSAGE,
  );
  return repo;
}

// ---------------------------------------------------------------------------
// Vercel
// ---------------------------------------------------------------------------

export const VERCEL_CLONE_URL = "https://vercel.com/new/clone";

/**
 * The "Deploy with Vercel" target — Vercel's documented clone contract
 * (`repository-url` plus optional `project-name` / `repository-name`).
 *
 * It CLONES a public Git repository, which is why it is step 3 and not step
 * 1: it cannot upload bytes we hold, so it only becomes possible once the
 * GitHub export in this module has made the site a public repository.
 */
export function vercelDeployUrl(repo: GithubRepo): string {
  const params = new URLSearchParams({
    "repository-url": repo.htmlUrl,
    "project-name": repo.name,
    "repository-name": repo.name,
  });
  return `${VERCEL_CLONE_URL}?${params.toString()}`;
}
