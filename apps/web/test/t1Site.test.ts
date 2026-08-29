/**
 * T1 site routes — server-mode wiring. The serve route is exercised for real
 * (filesystem store via AILX_SNAPSHOT_DIR); the upload route needs Postgres,
 * so its wiring is checked at the source level like nextConfig.test.ts does.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SITE_INDEX, siteUrlPath } from "@ailx/backend";
import { FsSnapshotStore, snapshotFromZip } from "@ailx/backend/t1";
import { buildSiteZip } from "../lib/siteUpload";
import { snapshotDir } from "../lib/server/site";

const routePath = (rel: string) => new URL(`../app/api/${rel}/route.api.ts`, import.meta.url);
const routeSource = (rel: string) => readFileSync(routePath(rel), "utf8");

describe("route registration", () => {
  it("uses route.api.ts naming so the static export stays API-free", () => {
    // Reading the files at these exact paths IS the assertion.
    expect(routeSource("attempts/[id]/site")).toContain("handleUploadSite");
    expect(routeSource("site/[digest]/[[...path]]")).toContain("handleServeSite");
  });

  it("upload route passes raw ZIP bytes, seq and client timestamp", () => {
    const src = routeSource("attempts/[id]/site");
    expect(src).toContain("rawBody: true");
    expect(src).toContain('searchParams.get("seq")');
    expect(src).toContain("x-ailx-client-ts");
    expect(src).toContain("getSnapshotStore()");
  });
});

describe("snapshotDir", () => {
  it("prefers AILX_SNAPSHOT_DIR and falls back to cwd/.ailx-snapshots", () => {
    expect(snapshotDir({ AILX_SNAPSHOT_DIR: "/data/snaps" }, "/srv")).toBe("/data/snaps");
    expect(snapshotDir({}, "/srv")).toBe(join("/srv", ".ailx-snapshots"));
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
});
