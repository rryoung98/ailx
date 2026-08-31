/**
 * GitHub export — device flow, the single-commit push, and the two handlers.
 *
 * Every GitHub call goes through an injected fetch: these tests assert the
 * EXACT requests AILX makes on a candidate's account, which is the part that
 * has to be trustworthy.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import {
  handleGithubExport,
  handleGithubExportStart,
  type GithubExportContext,
} from "../src/t1/export.js";
import {
  DEFAULT_REPO_NAME,
  GITHUB_ACCESS_TOKEN_URL,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_DEVICE_GRANT_TYPE,
  GITHUB_EXPORT_SCOPE,
  GithubExportError,
  README_FALLBACK_PATH,
  README_PATH,
  exportReadme,
  exportToGithub,
  githubClientId,
  redeemDeviceCode,
  requestDeviceCode,
  sanitizeRepoName,
  vercelDeployUrl,
  type GithubRepo,
} from "../src/t1/github.js";
import { handleUploadSite, type T1ApiContext } from "../src/t1/handlers.js";
import { snapshotFromZip } from "../src/t1/snapshot.js";
import { MemorySnapshotStore } from "../src/t1/storage.js";
import { freshDb, openAttempt } from "./helpers.js";
import { siteZip } from "./t1-fixtures.js";

let db: Awaited<ReturnType<typeof freshDb>>;

beforeAll(async () => {
  db = await freshDb();
});

// ---------------------------------------------------------------------------
// A scripted GitHub
// ---------------------------------------------------------------------------

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

type Route = (req: Recorded) => { status?: number; body: unknown } | undefined;

/** A fetch stub that records every request and answers from `routes`. */
function fakeGithub(routes: Route[]): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    const call: Recorded = {
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    for (const route of routes) {
      const answer = route(call);
      if (answer !== undefined) {
        return new Response(JSON.stringify(answer.body), {
          status: answer.status ?? 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    throw new Error(`unrouted request: ${call.method} ${call.url}`);
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, calls };
}

const on = (method: string, match: string, answer: { status?: number; body: unknown }): Route =>
  (req) => (req.method === method && req.url.includes(match) ? answer : undefined);

const DEVICE_ROUTE = on("POST", "/login/device/code", {
  body: {
    device_code: "device-123",
    user_code: "WXYZ-1234",
    verification_uri: "https://github.com/login/device",
    interval: 5,
    expires_in: 900,
    scope: GITHUB_EXPORT_SCOPE,
  },
});
const TOKEN_ROUTE = on("POST", "/login/oauth/access_token", { body: { access_token: "gho_secret" } });

/** The repo/blobs/tree/commit/ref happy path. */
function pushRoutes(name = DEFAULT_REPO_NAME): Route[] {
  let blob = 0;
  return [
    on("POST", "/user/repos", {
      status: 201,
      body: {
        name,
        owner: { login: "candidate" },
        html_url: `https://github.com/candidate/${name}`,
        clone_url: `https://github.com/candidate/${name}.git`,
        default_branch: "main",
      },
    }),
    on("GET", "/git/ref/heads/main", { body: { object: { sha: "head-sha" } } }),
    (req) =>
      req.method === "POST" && req.url.endsWith("/git/blobs")
        ? { status: 201, body: { sha: `blob-${++blob}` } }
        : undefined,
    on("POST", "/git/trees", { status: 201, body: { sha: "tree-sha" } }),
    on("POST", "/git/commits", { status: 201, body: { sha: "commit-sha" } }),
    on("PATCH", "/git/refs/heads/main", { body: { object: { sha: "commit-sha" } } }),
  ];
}

const REPO: GithubRepo = {
  owner: "candidate",
  name: "my-ailx-site",
  htmlUrl: "https://github.com/candidate/my-ailx-site",
  cloneUrl: "https://github.com/candidate/my-ailx-site.git",
  defaultBranch: "main",
};

// ---------------------------------------------------------------------------

describe("githubClientId", () => {
  it("is null when unset or blank — the deployment simply has no GitHub export", () => {
    expect(githubClientId({})).toBeNull();
    expect(githubClientId({ AILX_GITHUB_CLIENT_ID: "   " })).toBeNull();
  });

  it("trims a configured id", () => {
    expect(githubClientId({ AILX_GITHUB_CLIENT_ID: " Iv1.abc " })).toBe("Iv1.abc");
  });
});

describe("sanitizeRepoName", () => {
  it("keeps what GitHub keeps", () => {
    expect(sanitizeRepoName("my-site_v2.0")).toBe("my-site_v2.0");
  });

  it("rewrites what GitHub would rewrite, so the UI can show the truth", () => {
    expect(sanitizeRepoName("My Site!")).toBe("My-Site");
    expect(sanitizeRepoName("a/b\\c")).toBe("a-b-c");
  });

  it("trims leading and trailing separators", () => {
    expect(sanitizeRepoName("  ---hello--- ")).toBe("hello");
    expect(sanitizeRepoName("...site...")).toBe("site");
  });

  it("caps the length at GitHub's 100 characters", () => {
    expect(sanitizeRepoName("x".repeat(200))).toHaveLength(100);
  });

  it("is null when nothing usable survives", () => {
    expect(sanitizeRepoName("   ")).toBeNull();
    expect(sanitizeRepoName("!!!")).toBeNull();
    expect(sanitizeRepoName("..")).toBeNull();
  });
});

describe("exportReadme", () => {
  const base = {
    repoName: "my-ailx-site",
    submittedAt: "2026-08-29T11:22:33.000Z",
    digest: `sha256:${"a".repeat(64)}`,
    fileCount: 2,
    totalBytes: 1234,
    liveUrl: "https://exam.ailx.test/api/site/sha256:aaa/index.html",
    deployUrl: "https://vercel.com/new/clone?repository-url=x",
  };

  it("states what the sitting was, with the date and the content address", () => {
    const md = exportReadme(base);
    expect(md).toContain("# my-ailx-site");
    expect(md).toContain("2026-08-29");
    expect(md).toContain(base.digest);
    expect(md).toContain(base.liveUrl);
    expect(md).toContain(base.deployUrl);
  });

  it("claims no score and carries no marking material", () => {
    const md = exportReadme(base).toLowerCase();
    // The repository is the candidate's work, not AILX's verdict on it.
    expect(md).not.toMatch(/score|band|composite|percentile|grade/);
    // And nothing secret: the rubric and judge prompts are named only as
    // things that are ABSENT, in one sentence that says so.
    expect(md.match(/rubric/g)).toHaveLength(1);
    expect(md).toContain("no rubric, no judge prompt and no exam item");
  });

  it("omits the live link and the deploy link when there are none", () => {
    const md = exportReadme({ ...base, liveUrl: null, deployUrl: null });
    expect(md).not.toContain("Snapshot hosted by AILX");
    expect(md).not.toContain("Deploy with Vercel");
    expect(md).toContain("# my-ailx-site");
  });
});

describe("vercelDeployUrl", () => {
  it("uses Vercel's documented clone contract", () => {
    const url = new URL(vercelDeployUrl(REPO));
    expect(`${url.origin}${url.pathname}`).toBe("https://vercel.com/new/clone");
    expect(url.searchParams.get("repository-url")).toBe(REPO.htmlUrl);
    expect(url.searchParams.get("project-name")).toBe(REPO.name);
    expect(url.searchParams.get("repository-name")).toBe(REPO.name);
  });
});

describe("requestDeviceCode", () => {
  it("asks for public_repo and nothing else", async () => {
    const { fetch, calls } = fakeGithub([DEVICE_ROUTE]);
    const grant = await requestDeviceCode(fetch, "Iv1.client");
    expect(calls[0]!.url).toBe(GITHUB_DEVICE_CODE_URL);
    expect(calls[0]!.body).toEqual({ client_id: "Iv1.client", scope: "public_repo" });
    expect(grant.userCode).toBe("WXYZ-1234");
    expect(grant.intervalSeconds).toBe(5);
  });

  it("never sends a client secret — the device flow does not take one", async () => {
    const { fetch, calls } = fakeGithub([DEVICE_ROUTE]);
    await requestDeviceCode(fetch, "Iv1.client");
    expect(JSON.stringify(calls)).not.toContain("client_secret");
  });

  it("defaults the interval when GitHub omits it", async () => {
    const { fetch } = fakeGithub([
      on("POST", "/login/device/code", {
        body: { device_code: "d", user_code: "u", verification_uri: "https://github.com/login/device" },
      }),
    ]);
    expect((await requestDeviceCode(fetch, "id")).intervalSeconds).toBe(5);
  });

  it("fails cleanly on an unintelligible answer", async () => {
    const { fetch } = fakeGithub([on("POST", "/login/device/code", { body: { nope: true } })]);
    await expect(requestDeviceCode(fetch, "id")).rejects.toMatchObject({ code: "github_unavailable" });
  });

  it("fails cleanly when GitHub cannot be reached", async () => {
    const fetchFn = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(requestDeviceCode(fetchFn, "id")).rejects.toBeInstanceOf(GithubExportError);
  });
});

describe("redeemDeviceCode", () => {
  it("sends exactly client_id, device_code and grant_type", async () => {
    const { fetch, calls } = fakeGithub([TOKEN_ROUTE]);
    expect(await redeemDeviceCode(fetch, "Iv1.client", "device-123")).toBe("gho_secret");
    expect(calls[0]!.url).toBe(GITHUB_ACCESS_TOKEN_URL);
    expect(calls[0]!.body).toEqual({
      client_id: "Iv1.client",
      device_code: "device-123",
      grant_type: GITHUB_DEVICE_GRANT_TYPE,
    });
  });

  it("reports authorization_pending while the candidate has not approved", async () => {
    const { fetch } = fakeGithub([on("POST", "/login/oauth/access_token", { body: { error: "authorization_pending" } })]);
    await expect(redeemDeviceCode(fetch, "id", "d")).rejects.toMatchObject({ code: "authorization_pending" });
  });

  it("passes GitHub's slow_down interval back to the poller", async () => {
    const { fetch } = fakeGithub([
      on("POST", "/login/oauth/access_token", { body: { error: "slow_down", interval: 12 } }),
    ]);
    await expect(redeemDeviceCode(fetch, "id", "d")).rejects.toMatchObject({
      code: "authorization_pending",
      retryAfterSeconds: 12,
    });
  });

  it.each(["expired_token", "access_denied", "incorrect_device_code"])("treats %s as a restart", async (error) => {
    const { fetch } = fakeGithub([on("POST", "/login/oauth/access_token", { body: { error } })]);
    await expect(redeemDeviceCode(fetch, "id", "d")).rejects.toMatchObject({ code: "authorization_failed" });
  });
});

describe("exportToGithub", () => {
  const files = snapshotFromZip(siteZip({ "app.js": "console.log(1)" })).files;
  const input = {
    repoName: DEFAULT_REPO_NAME,
    files,
    digest: `sha256:${"c".repeat(64)}`,
    submittedAt: "2026-08-29T00:00:00.000Z",
    publicOrigin: "https://exam.ailx.test",
  };

  it("creates a PUBLIC, auto-initialised repository", async () => {
    const { fetch, calls } = fakeGithub(pushRoutes());
    const repo = await exportToGithub(fetch, "gho_secret", input);
    const create = calls.find((c) => c.url.endsWith("/user/repos"))!;
    expect(create.body).toMatchObject({ name: DEFAULT_REPO_NAME, private: false, auto_init: true });
    expect(create.headers.authorization).toBe("Bearer gho_secret");
    expect(repo.owner).toBe("candidate");
  });

  it("pushes every file plus a README in ONE commit onto the existing head", async () => {
    const { fetch, calls } = fakeGithub(pushRoutes());
    await exportToGithub(fetch, "gho_secret", input);

    const blobs = calls.filter((c) => c.url.endsWith("/git/blobs"));
    expect(blobs).toHaveLength(files.length + 1);
    for (const blob of blobs) expect(blob.body).toMatchObject({ encoding: "base64" });

    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    const paths = (tree.body!.tree as { path: string; mode: string; type: string }[]).map((t) => t.path);
    expect(paths.sort()).toEqual([README_PATH, "app.js", "index.html"].sort());
    // No base_tree: the pushed tree IS the site, so auto_init's README is gone.
    expect(tree.body!.base_tree).toBeUndefined();

    const commits = calls.filter((c) => c.url.endsWith("/git/commits"));
    expect(commits).toHaveLength(1);
    expect(commits[0]!.body).toMatchObject({ tree: "tree-sha", parents: ["head-sha"] });

    const ref = calls.find((c) => c.method === "PATCH")!;
    expect(ref.body).toEqual({ sha: "commit-sha", force: false });
  });

  it("round-trips file bytes through base64", async () => {
    const { fetch, calls } = fakeGithub(pushRoutes());
    await exportToGithub(fetch, "gho_secret", input);
    const contents = calls
      .filter((c) => c.url.endsWith("/git/blobs"))
      .map((c) => Buffer.from(c.body!.content as string, "base64").toString("utf8"));
    expect(contents).toContain("console.log(1)");
    expect(contents.some((c) => c.startsWith("# my-ailx-site"))).toBe(true);
  });

  it("puts the live URL and a deploy link in the README", async () => {
    const { fetch, calls } = fakeGithub(pushRoutes());
    await exportToGithub(fetch, "gho_secret", input);
    const readme = calls
      .filter((c) => c.url.endsWith("/git/blobs"))
      .map((c) => Buffer.from(c.body!.content as string, "base64").toString("utf8"))
      .find((c) => c.startsWith("#"))!;
    expect(readme).toContain(`https://exam.ailx.test/api/site/${input.digest}/index.html`);
    expect(readme).toContain("https://vercel.com/new/clone");
  });

  it("omits the live URL when no public origin is known", async () => {
    const { fetch, calls } = fakeGithub(pushRoutes());
    await exportToGithub(fetch, "gho_secret", { ...input, publicOrigin: null });
    const readme = calls
      .filter((c) => c.url.endsWith("/git/blobs"))
      .map((c) => Buffer.from(c.body!.content as string, "base64").toString("utf8"))
      .find((c) => c.startsWith("#"))!;
    expect(readme).not.toContain("Snapshot hosted by AILX");
  });

  it("never overwrites a candidate's own README.md", async () => {
    const withReadme = snapshotFromZip(siteZip({ "README.md": "# mine" })).files;
    const { fetch, calls } = fakeGithub(pushRoutes());
    await exportToGithub(fetch, "gho_secret", { ...input, files: withReadme });
    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    const paths = (tree.body!.tree as { path: string }[]).map((t) => t.path);
    expect(paths.sort()).toEqual([README_FALLBACK_PATH, README_PATH, "index.html"].sort());
    const blobs = calls
      .filter((c) => c.url.endsWith("/git/blobs"))
      .map((c) => Buffer.from(c.body!.content as string, "base64").toString("utf8"));
    expect(blobs).toContain("# mine");
  });

  it("maps a name collision onto repo_name_unavailable", async () => {
    const { fetch } = fakeGithub([
      on("POST", "/user/repos", { status: 422, body: { message: "name already exists on this account" } }),
    ]);
    await expect(exportToGithub(fetch, "gho_secret", input)).rejects.toMatchObject({
      code: "repo_name_unavailable",
    });
  });

  it("maps a revoked token onto authorization_failed", async () => {
    const { fetch } = fakeGithub([on("POST", "/user/repos", { status: 401, body: { message: "Bad credentials" } })]);
    await expect(exportToGithub(fetch, "gho_secret", input)).rejects.toMatchObject({
      code: "authorization_failed",
    });
  });
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function ownedAttempt(): Promise<{ headers: Record<string, string>; attemptId: string }> {
  const { attempt } = await openAttempt(db);
  const { rows } = await db.query("SELECT auth_ref FROM participants WHERE id = $1", [attempt.participantId]);
  return { headers: { [DEV_USER_HEADER]: (rows[0]!.auth_ref as string).slice("dev:".length) }, attemptId: attempt.id };
}

async function submittedCtx(http: typeof fetch, clientId: string | null = "Iv1.client") {
  const snapshots = new MemorySnapshotStore();
  const base: T1ApiContext = { db, auth: new DevAuthProvider(), snapshots };
  const { headers, attemptId } = await ownedAttempt();
  await handleUploadSite(base, headers, attemptId, {
    zip: siteZip({ "app.js": "1" }),
    seq: 0,
    clientTs: "2026-08-29T00:00:00Z",
  });
  const ctx: GithubExportContext = { ...base, githubClientId: clientId, http };
  return { ctx, headers, attemptId, snapshots };
}

describe("handleGithubExportStart", () => {
  it("401s without authentication", async () => {
    const { fetch } = fakeGithub([DEVICE_ROUTE]);
    const { ctx, attemptId } = await submittedCtx(fetch);
    expect((await handleGithubExportStart(ctx, {}, attemptId)).status).toBe(401);
  });

  it("404s for a stranger, without touching GitHub", async () => {
    const { fetch, calls } = fakeGithub([DEVICE_ROUTE]);
    const { ctx, attemptId } = await submittedCtx(fetch);
    expect((await handleGithubExportStart(ctx, { [DEV_USER_HEADER]: "intruder" }, attemptId)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("501s when the deployment configures no client id", async () => {
    const { fetch } = fakeGithub([DEVICE_ROUTE]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch, null);
    const result = await handleGithubExportStart(ctx, headers, attemptId);
    expect(result.status).toBe(501);
    expect((result.body.error as { code: string }).code).toBe("github_not_configured");
  });

  it("404s when there is nothing to export, before asking the candidate to authorize", async () => {
    const { fetch, calls } = fakeGithub([DEVICE_ROUTE]);
    const snapshots = new MemorySnapshotStore();
    const { headers, attemptId } = await ownedAttempt();
    const ctx: GithubExportContext = {
      db,
      auth: new DevAuthProvider(),
      snapshots,
      githubClientId: "Iv1.client",
      http: fetch,
    };
    expect((await handleGithubExportStart(ctx, headers, attemptId)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("returns the code the candidate types, and the scope GitHub recorded", async () => {
    const { fetch } = fakeGithub([DEVICE_ROUTE]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    const result = await handleGithubExportStart(ctx, headers, attemptId);
    expect(result.status).toBe(200);
    expect(result.body.authorization).toMatchObject({
      deviceCode: "device-123",
      userCode: "WXYZ-1234",
      verificationUri: "https://github.com/login/device",
      intervalSeconds: 5,
      scope: "public_repo",
    });
  });
});

describe("handleGithubExport", () => {
  const body = (over: Record<string, unknown> = {}) => ({ deviceCode: "device-123", ...over });

  it("404s for a stranger even with a valid device code", async () => {
    const { fetch, calls } = fakeGithub([TOKEN_ROUTE, ...pushRoutes()]);
    const { ctx, attemptId } = await submittedCtx(fetch);
    const result = await handleGithubExport(ctx, { [DEV_USER_HEADER]: "intruder" }, attemptId, body());
    expect(result.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("400s without a device code", async () => {
    const { fetch } = fakeGithub([]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    const result = await handleGithubExport(ctx, headers, attemptId, {});
    expect(result.status).toBe(400);
  });

  it("400s on a repository name with nothing usable in it", async () => {
    const { fetch } = fakeGithub([]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    const result = await handleGithubExport(ctx, headers, attemptId, body({ repoName: "!!!" }));
    expect(result.status).toBe(400);
  });

  it("202s — not an error — while the candidate is still approving", async () => {
    const { fetch } = fakeGithub([
      on("POST", "/login/oauth/access_token", { body: { error: "authorization_pending" } }),
    ]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    const result = await handleGithubExport(ctx, headers, attemptId, body());
    expect(result.status).toBe(202);
    expect((result.body.error as { code: string }).code).toBe("authorization_pending");
  });

  it("401s when the authorization expired", async () => {
    const { fetch } = fakeGithub([on("POST", "/login/oauth/access_token", { body: { error: "expired_token" } })]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    expect((await handleGithubExport(ctx, headers, attemptId, body())).status).toBe(401);
  });

  it("409s when the repository name is taken", async () => {
    const { fetch } = fakeGithub([
      TOKEN_ROUTE,
      on("POST", "/user/repos", { status: 422, body: { message: "name already exists on this account" } }),
    ]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    const result = await handleGithubExport(ctx, headers, attemptId, body({ repoName: "taken" }));
    expect(result.status).toBe(409);
  });

  it("creates the repository and answers with it plus the Vercel deploy link", async () => {
    const { fetch } = fakeGithub([TOKEN_ROUTE, ...pushRoutes("my-site")]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    const result = await handleGithubExport(ctx, headers, attemptId, body({ repoName: "my site" }));
    expect(result.status).toBe(201);
    expect(result.body.repo).toEqual({
      owner: "candidate",
      name: "my-site",
      htmlUrl: "https://github.com/candidate/my-site",
      defaultBranch: "main",
    });
    expect(String(result.body.deployUrl)).toContain("https://vercel.com/new/clone?repository-url=");
  });

  it("never returns the access token to the caller", async () => {
    const { fetch } = fakeGithub([TOKEN_ROUTE, ...pushRoutes()]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    const result = await handleGithubExport(ctx, headers, attemptId, body());
    expect(JSON.stringify(result.body)).not.toContain("gho_secret");
  });

  it("exports the candidate's own files and nothing about the marking", async () => {
    const { fetch, calls } = fakeGithub([TOKEN_ROUTE, ...pushRoutes()]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    await handleGithubExport(ctx, headers, attemptId, body());
    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    expect((tree.body!.tree as { path: string }[]).map((t) => t.path).sort()).toEqual(
      [README_PATH, "app.js", "index.html"].sort(),
    );
  });

  it("drops a public origin that is not a bare http(s) origin", async () => {
    const { fetch, calls } = fakeGithub([TOKEN_ROUTE, ...pushRoutes()]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    await handleGithubExport(ctx, headers, attemptId, body({ publicOrigin: "javascript:alert(1)" }));
    const readme = calls
      .filter((c) => c.url.endsWith("/git/blobs"))
      .map((c) => Buffer.from(c.body!.content as string, "base64").toString("utf8"))
      .find((c) => c.startsWith("#"))!;
    expect(readme).not.toContain("javascript:");
    expect(readme).not.toContain("Snapshot hosted by AILX");
  });

  it("keeps a bare origin, and only the origin", async () => {
    const { fetch, calls } = fakeGithub([TOKEN_ROUTE, ...pushRoutes()]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    await handleGithubExport(ctx, headers, attemptId, body({ publicOrigin: "https://exam.ailx.test" }));
    const readme = calls
      .filter((c) => c.url.endsWith("/git/blobs"))
      .map((c) => Buffer.from(c.body!.content as string, "base64").toString("utf8"))
      .find((c) => c.startsWith("#"))!;
    expect(readme).toContain("https://exam.ailx.test/api/site/");
  });

  it("does not redeem the authorization when the bytes cannot be read", async () => {
    const { fetch, calls } = fakeGithub([TOKEN_ROUTE, ...pushRoutes()]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    const empty: GithubExportContext = { ...ctx, snapshots: new MemorySnapshotStore() };
    const result = await handleGithubExport(empty, headers, attemptId, body());
    expect(result.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("mutates neither the responses row nor the stored snapshot", async () => {
    const { fetch } = fakeGithub([TOKEN_ROUTE, ...pushRoutes()]);
    const { ctx, headers, attemptId } = await submittedCtx(fetch);
    const before = await db.query("SELECT id, payload, server_ts FROM responses WHERE attempt_id = $1", [attemptId]);
    await handleGithubExport(ctx, headers, attemptId, body());
    const after = await db.query("SELECT id, payload, server_ts FROM responses WHERE attempt_id = $1", [attemptId]);
    expect(after.rows).toEqual(before.rows);
  });
});
