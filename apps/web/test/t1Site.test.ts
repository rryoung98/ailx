/**
 * T1 site routes — server-mode wiring. The serve route is exercised for real
 * (filesystem store via AILX_SNAPSHOT_DIR); the upload route needs Postgres,
 * so its wiring is checked at the source level like nextConfig.test.ts does.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SITE_INDEX, siteUrlPath } from "@ailx/contract";
import { BlobSnapshotStore, FsSnapshotStore, snapshotFromZip } from "@ailx/backend/t1";
import { buildSiteZip } from "../lib/siteUpload";
import {
  BLOB_TOKEN_ENV,
  makeSnapshotStore,
  makeUploadStaging,
  snapshotBlobPrefix,
  snapshotDir,
  snapshotStoreMode,
} from "../lib/server/site";

/**
 * Serving is reachability-gated: bytes are served only while a `responses`
 * row records their digest (P1-1 — a rejected upload must publish nothing).
 * The route takes its DB session from withApiContext; the SQL itself is
 * covered against real Postgres in @ailx/backend's PGlite suite, so here the
 * session is a stub over the set of recorded digests.
 */
const recorded = vi.hoisted(() => new Set<string>());

vi.mock("../lib/server/api", () => ({
  withApiContext: async (fn: (ctx: { db: unknown; auth: unknown }) => unknown) =>
    fn({
      db: {
        query: async (_text: string, params?: unknown[]) => ({
          rows: recorded.has(String(params?.[1])) ? [{ ok: 1 }] : [],
        }),
      },
      auth: {},
    }),
}));

/** The Blob SDK is a network client: mocked, never reached. */
const clientToken = vi.hoisted(() => vi.fn(async (_opts: unknown) => "vercel_blob_client_test"));
vi.mock("@vercel/blob/client", () => ({ generateClientTokenFromReadWriteToken: clientToken }));

const routePath = (rel: string) => new URL(`../app/api/${rel}/route.api.ts`, import.meta.url);
const routeSource = (rel: string) => readFileSync(routePath(rel), "utf8");

describe("route registration", () => {
  it("uses route.api.ts naming so the static export stays API-free", () => {
    // Reading the files at these exact paths IS the assertion.
    expect(routeSource("attempts/[id]/site")).toContain("handleUploadSite");
    expect(routeSource("site/[digest]/[[...path]]")).toContain("handleServeSite");
    expect(routeSource("attempts/[id]/site/upload-ticket")).toContain("handleCreateSiteUpload");
    expect(routeSource("attempts/[id]/site/finalize")).toContain("handleFinalizeSiteUpload");
  });

  /**
   * The direct path must not become a second, weaker submission
   * API: both routes wire the SAME staging seam and the same
   * store, and neither reads a storage env var itself.
   */
  it("direct-upload routes take staging from the one wiring point", () => {
    for (const rel of ["attempts/[id]/site/upload-ticket", "attempts/[id]/site/finalize"]) {
      const src = routeSource(rel);
      expect(src).toContain("getUploadStaging()");
      expect(src).toContain("getSnapshotStore()");
      expect(src).not.toMatch(/process\.env/);
    }
    // Finalize takes an uploadId, never a digest or a path.
    const finalize = routeSource("attempts/[id]/site/finalize");
    expect(finalize).toContain("uploadId");
    expect(finalize).not.toContain("digest");
  });

  it("upload route passes raw ZIP bytes, seq and client timestamp", () => {
    const src = routeSource("attempts/[id]/site");
    expect(src).toContain("rawBody: true");
    expect(src).toContain('searchParams.get("seq")');
    expect(src).toContain("x-ailx-client-ts");
    expect(src).toContain("getSnapshotStore()");
  });

  /**
   * The export routes are the offboarding ramp (docs/FUTURE-TRACKS.md). They
   * must go through `apiRoute` like every other authenticated route: it
   * authenticates BEFORE anything else happens, so a stranger cannot make the
   * server read a snapshot or spend our GitHub rate limit. The export route
   * answers with bytes, which is why `apiRoute` accepts a raw Response.
   */
  it("export routes authenticate through apiRoute and take one storage seam", () => {
    for (const rel of [
      "attempts/[id]/site/export",
      "attempts/[id]/site/github",
      "attempts/[id]/site/github/start",
    ]) {
      const src = routeSource(rel);
      expect(src, rel).toContain("apiRoute(");
      expect(src, rel).toContain("getSnapshotStore()");
      expect(src, rel).not.toContain("withApiContext");
    }
    const exportSrc = routeSource("attempts/[id]/site/export");
    expect(exportSrc).toContain("handleExportSite");
    // Headers are the backend's, so both hosts serve the download identically.
    expect(exportSrc).toContain("siteExportHeaders");
  });

  /**
   * The README's live link names THIS deployment. A caller-supplied origin
   * would end up in a file pushed to the candidate's public repository.
   */
  it("github route resolves the public origin server-side", () => {
    const src = routeSource("attempts/[id]/site/github");
    expect(src).toContain("handleGithubExport");
    expect(src).toContain("requestOrigin(req)");
    // Spread FIRST, override after: a `publicOrigin` in the body cannot win.
    expect(src.indexOf("...(typeof body")).toBeLessThan(src.lastIndexOf("publicOrigin"));
    expect(routeSource("attempts/[id]/site/github/start")).toContain("handleGithubExportStart");
  });

  /** The one GitHub credential is read where every other env var is read. */
  it("github routes take the client id from githubClientId(process.env)", () => {
    for (const rel of ["attempts/[id]/site/github", "attempts/[id]/site/github/start"]) {
      expect(routeSource(rel), rel).toContain("githubClientId(process.env)");
    }
  });
});

describe("snapshotDir", () => {
  it("prefers AILX_SNAPSHOT_DIR and falls back to cwd/.ailx-snapshots", () => {
    expect(snapshotDir({ AILX_SNAPSHOT_DIR: "/data/snaps" }, "/srv")).toBe("/data/snaps");
    expect(snapshotDir({}, "/srv")).toBe(join("/srv", ".ailx-snapshots"));
  });
});

/**
 * Store selection is the serverless-correctness decision: on a per-invocation
 * filesystem, an uploaded site written by one request is gone by the next.
 * It lives in exactly one file, so these are the only env reads to check.
 */
describe("snapshot store selection", () => {
  const TOKEN = { [BLOB_TOKEN_ENV]: "vercel_blob_rw_test" };

  it("defaults to the filesystem, and takes fs explicitly", () => {
    expect(snapshotStoreMode({})).toBe("fs");
    expect(snapshotStoreMode({ AILX_SNAPSHOT_STORE: "" })).toBe("fs");
    expect(snapshotStoreMode({ AILX_SNAPSHOT_STORE: "fs" })).toBe("fs");
    // A blob token alone must NOT redirect a dev server into a shared bucket.
    expect(snapshotStoreMode(TOKEN)).toBe("fs");
    expect(makeSnapshotStore(TOKEN, "/srv")).toBeInstanceOf(FsSnapshotStore);
  });

  it("selects the blob store when asked, with the token", () => {
    const env = { AILX_SNAPSHOT_STORE: "blob", ...TOKEN };
    expect(snapshotStoreMode(env)).toBe("blob");
    expect(makeSnapshotStore(env, "/srv")).toBeInstanceOf(BlobSnapshotStore);
  });

  it("refuses blob mode without a token instead of silently writing to disk", () => {
    expect(() => makeSnapshotStore({ AILX_SNAPSHOT_STORE: "blob" }, "/srv")).toThrow(
      new RegExp(BLOB_TOKEN_ENV),
    );
  });

  it("rejects an unknown mode rather than guessing", () => {
    for (const mode of ["gcs", "s3", "FS", "blob "]) {
      expect(() => snapshotStoreMode({ AILX_SNAPSHOT_STORE: mode })).toThrow(/must be "fs" or "blob"/);
    }
  });

  it("namespaces blob keys, defaulting to t1", () => {
    expect(snapshotBlobPrefix({})).toBe("t1");
    expect(snapshotBlobPrefix({ AILX_SNAPSHOT_BLOB_PREFIX: "staging" })).toBe("staging");
  });

  /**
   * Client-direct upload (DEPLOY.md §5.1) needs a target a browser can
   * PUT to. The filesystem store is not one, so `fs` mode has no
   * staging at all and the endpoint says so instead of pretending.
   */
  it("offers client-direct staging only in blob mode", () => {
    expect(makeUploadStaging({})).toBeNull();
    expect(makeUploadStaging(TOKEN)).toBeNull();
    expect(makeUploadStaging({ AILX_SNAPSHOT_STORE: "fs", ...TOKEN })).toBeNull();
    expect(makeUploadStaging({ AILX_SNAPSHOT_STORE: "blob", ...TOKEN })).toMatchObject({
      authorize: expect.any(Function),
      read: expect.any(Function),
      discard: expect.any(Function),
    });
  });

  it("refuses blob staging without a token, with the same one message", () => {
    expect(() => makeUploadStaging({ AILX_SNAPSHOT_STORE: "blob" })).toThrow(
      new RegExp(BLOB_TOKEN_ENV),
    );
  });
  /**
   * The grant is scoped to a STRING, so the pathname we hand the
   * browser and the pathname the token was minted for must be the
   * same one — including the bucket namespace. They diverged once
   * (the client wrote to the bare key and the store refused it),
   * so this pins them together.
   */
  it("scopes the grant to the namespaced key it hands back", async () => {
    const staging = makeUploadStaging({
      AILX_SNAPSHOT_STORE: "blob",
      AILX_SNAPSHOT_BLOB_PREFIX: "staging",
      ...TOKEN,
    })!;
    const grant = await staging.authorize({
      key: "uploads/att/up.zip",
      maxBytes: 1024,
      contentType: "application/zip",
    });
    expect(grant.pathname).toBe("staging/uploads/att/up.zip");
    expect(clientToken.mock.calls[0][0]).toMatchObject({
      pathname: grant.pathname,
      allowedContentTypes: ["application/zip"],
      maximumSizeInBytes: 1024,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    expect(grant.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("GET /api/site/[digest]/[[...path]]", () => {
  let dir: string;
  let digest: string;
  let GET: (req: Request, ctx: { params: Promise<{ digest: string; path?: string[] }> }) => Promise<Response>;

  const INDEX = '<h1>served</h1><link rel="stylesheet" href="style.css"><script src="app.js"></script>';
  const APP_JS = 'document.title = "hi";';
  const STYLE = "h1 { color: red }";
  const LOGO = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const bytes = (s: string) => new TextEncoder().encode(s);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ailx-t1-web-"));
    process.env.AILX_SNAPSHOT_DIR = dir;
    // A real multi-file submission: the digest is the production one, so the
    // manifest/serve path under test is the shipped code path end to end.
    const snapshot = snapshotFromZip(
      buildSiteZip([
        { path: "index.html", data: bytes(INDEX) },
        { path: "app.js", data: bytes(APP_JS) },
        { path: "style.css", data: bytes(STYLE) },
        { path: "assets/logo.svg", data: bytes(LOGO) },
      ]),
    );
    digest = snapshot.digest;
    await new FsSnapshotStore(dir).put(snapshot);
    recorded.add(digest);
    ({ GET } = await import("../app/api/site/[digest]/[[...path]]/route.api"));
  });

  afterAll(async () => {
    delete process.env.AILX_SNAPSHOT_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  const ORIGIN = "https://sandbox.example";
  const request = (path: string) => new Request(`${ORIGIN}${path}`);
  const params = (d: string, path?: string[]) => ({ params: Promise.resolve({ digest: d, path }) });

  /**
   * Dispatch a URL the way the deployed stack does, so a redirect LOOP fails
   * the test instead of passing it (the staging P0: the route 308'd the bare
   * digest to the trailing-slash form and Next 308'd it straight back).
   * `trailingSlash: false` — Next's default — is modelled explicitly.
   */
  async function fetchLikeNext(pathname: string, maxHops = 10) {
    const chain: string[] = [pathname];
    for (let hop = 0; hop < maxHops; hop++) {
      const current = chain[chain.length - 1]!;
      if (current.length > 1 && current.endsWith("/")) {
        chain.push(current.replace(/\/+$/, "")); // Next's trailingSlash 308
        continue;
      }
      const [d, ...rest] = current.slice("/api/site/".length).split("/");
      const res = await GET(request(current), params(d!, rest.length ? rest : undefined));
      if (res.status !== 308) return { res, hops: chain.length - 1, chain };
      chain.push(new URL(res.headers.get("location")!).pathname);
    }
    throw new Error(`redirect loop: ${chain.join(" -> ")}`);
  }

  describe("canonical URL termination (staging P0 regression)", () => {
    it("takes the bare-digest URL to a 200 in one hop", async () => {
      const { res, hops, chain } = await fetchLikeNext(`/api/site/${digest}`);
      expect(res.status).toBe(200);
      expect(hops).toBe(1);
      expect(chain[chain.length - 1]).toBe(siteUrlPath(digest));
      expect(await res.text()).toBe(INDEX);
    });

    it("takes the legacy trailing-slash URL to a 200 (Next strips, we redirect once)", async () => {
      const { res, hops, chain } = await fetchLikeNext(`/api/site/${digest}/`);
      expect(res.status).toBe(200);
      expect(hops).toBe(2);
      expect(chain[chain.length - 1]).toBe(siteUrlPath(digest));
    });

    it("does not redirect the canonical URL at all", async () => {
      const { res, hops } = await fetchLikeNext(siteUrlPath(digest));
      expect(res.status).toBe(200);
      expect(hops).toBe(0);
    });

    it("terminates on a subdirectory URL instead of looping", async () => {
      // Next strips the slash, leaving a path that is not a manifest file:
      // an honest 404, and — the point — a terminating chain.
      const { res, chain } = await fetchLikeNext(`/api/site/${digest}/assets/`);
      expect(res.status).toBe(404);
      expect(chain[chain.length - 1]).toBe(`/api/site/${digest}/assets`);
    });

    it("redirects a trailing-slash request reaching the route directly", async () => {
      // Non-Next callers (curl against a proxy that keeps the slash) still get
      // one hop to a real file rather than a slash-form ping-pong.
      const res = await GET(request(`/api/site/${digest}/assets/`), params(digest, ["assets"]));
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe(`${ORIGIN}/api/site/${digest}/assets/${SITE_INDEX}`);
    });

    it("308s the bare digest exactly once, to the canonical file URL", async () => {
      const res = await GET(request(`/api/site/${digest}`), params(digest));
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe(`${ORIGIN}${siteUrlPath(digest)}`);
    });
  });

  it("serves the canonical index with sandbox headers", async () => {
    const res = await GET(request(siteUrlPath(digest)), params(digest, [SITE_INDEX]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(INDEX);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("script-src 'self' https://sandbox.example");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves relative subresources the page asks for, with their content types", async () => {
    // Exactly what a browser resolves against .../<digest>/index.html.
    const cases = [
      { path: ["app.js"], body: APP_JS, type: "text/javascript; charset=utf-8" },
      { path: ["style.css"], body: STYLE, type: "text/css; charset=utf-8" },
      { path: ["assets", "logo.svg"], body: LOGO, type: "image/svg+xml" },
    ];
    for (const c of cases) {
      const res = await GET(request(`/api/site/${digest}/${c.path.join("/")}`), params(digest, c.path));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(c.body);
      expect(res.headers.get("content-type")).toBe(c.type);
      expect(res.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    }
  });

  describe("public origin behind a reverse proxy (staging P0 regression)", () => {
    // The dogfood bug: req.url is the INTERNAL origin behind ngrok/Cloud Run,
    // so both the CSP allowlist and the 308 Location pointed at localhost.
    const internal = (path: string) =>
      new Request(`https://localhost:3111${path}`, {
        headers: { "x-forwarded-proto": "https", "x-forwarded-host": "abc.ngrok-free.app" },
      });
    const serve = () => GET(internal(siteUrlPath(digest)), params(digest, [SITE_INDEX]));
    const redirect = () => GET(internal(`/api/site/${digest}`), params(digest));

    afterEach(() => {
      delete process.env.AILX_PUBLIC_ORIGIN;
      delete process.env.AILX_TRUST_PROXY;
    });

    it("leaks the internal origin only when nothing is configured", async () => {
      expect((await serve()).headers.get("content-security-policy")).toContain(
        "script-src 'self' https://localhost:3111",
      );
      expect((await redirect()).headers.get("location")).toBe(`https://localhost:3111${siteUrlPath(digest)}`);
    });

    it("puts AILX_PUBLIC_ORIGIN in the CSP and the redirect", async () => {
      process.env.AILX_PUBLIC_ORIGIN = "https://ailx.example";
      const csp = (await serve()).headers.get("content-security-policy")!;
      for (const directive of ["script-src", "style-src", "img-src", "media-src", "font-src", "manifest-src"]) {
        expect(csp).toContain(`${directive} 'self' https://ailx.example`);
      }
      expect(csp).not.toContain("localhost:3111");
      const res = await redirect();
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe(`https://ailx.example${siteUrlPath(digest)}`);
    });

    it("honours forwarded headers when AILX_TRUST_PROXY is set", async () => {
      process.env.AILX_TRUST_PROXY = "1";
      expect((await serve()).headers.get("content-security-policy")).toContain(
        "script-src 'self' https://abc.ngrok-free.app",
      );
      expect((await redirect()).headers.get("location")).toBe(`https://abc.ngrok-free.app${siteUrlPath(digest)}`);
    });
  });

  it("404s unknown digests and paths", async () => {
    const res = await GET(request(`/api/site/${digest}/nope.css`), params(digest, ["nope.css"]));
    expect(res.status).toBe(404);
    const unknown = `sha256:${"0".repeat(64)}`;
    const res2 = await GET(request(siteUrlPath(unknown)), params(unknown, [SITE_INDEX]));
    expect(res2.status).toBe(404);
    // A malformed digest never reaches the store.
    const res3 = await GET(request("/api/site/not-a-digest/index.html"), params("not-a-digest", [SITE_INDEX]));
    expect(res3.status).toBe(404);
  });

  it("404s stored bytes that NO response row records (orphan snapshot)", async () => {
    // The P1-1 attack residue: bytes on disk, nothing in the DB pointing at
    // them. The digest is a valid capability and the manifest resolves — the
    // record is what is missing, and that is enough to serve nothing.
    const orphan = snapshotFromZip(buildSiteZip([{ path: "index.html", data: bytes("<h1>orphan</h1>") }]));
    await new FsSnapshotStore(dir).put(orphan);
    const res = await GET(request(siteUrlPath(orphan.digest)), params(orphan.digest, [SITE_INDEX]));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("orphan");

    // Recording it is exactly what makes it servable.
    recorded.add(orphan.digest);
    const after = await GET(request(siteUrlPath(orphan.digest)), params(orphan.digest, [SITE_INDEX]));
    expect(after.status).toBe(200);
    recorded.delete(orphan.digest);
  });
});
