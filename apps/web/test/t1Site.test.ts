/**
 * T1 site routes — server-mode wiring. The serve route is exercised for real
 * (filesystem store via AILX_SNAPSHOT_DIR); the upload route needs Postgres,
 * so its wiring is checked at the source level like nextConfig.test.ts does.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FsSnapshotStore, type SiteSnapshot } from "@ailx/backend/t1";
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

  const INDEX = "<h1>served</h1>";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ailx-t1-web-"));
    process.env.AILX_SNAPSHOT_DIR = dir;
    const bytes = new TextEncoder().encode(INDEX);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const manifest = [{ path: "index.html", sha256, bytes: bytes.length, contentType: "text/html; charset=utf-8" }];
    digest = `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
    const snapshot: SiteSnapshot = {
      digest,
      fileCount: 1,
      totalBytes: bytes.length,
      manifest,
      files: [{ ...manifest[0]!, data: bytes }],
    };
    await new FsSnapshotStore(dir).put(snapshot);
    ({ GET } = await import("../app/api/site/[digest]/[[...path]]/route.api"));
  });

  afterAll(async () => {
    delete process.env.AILX_SNAPSHOT_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  const request = (path: string) => new Request(`https://sandbox.example${path}`);
  const params = (d: string, path?: string[]) => ({ params: Promise.resolve({ digest: d, path }) });

  it("serves the stored index with sandbox headers", async () => {
    const res = await GET(request(`/api/site/${digest}/`), params(digest));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("script-src 'self' https://sandbox.example");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("308-redirects the bare digest URL to its trailing-slash form", async () => {
    const res = await GET(request(`/api/site/${digest}`), params(digest));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`https://sandbox.example/api/site/${digest}/`);
  });

  it("404s unknown digests and paths", async () => {
    const res = await GET(request(`/api/site/${digest}/nope.css`), params(digest, ["nope.css"]));
    expect(res.status).toBe(404);
    const unknown = `sha256:${"0".repeat(64)}`;
    const res2 = await GET(request(`/api/site/${unknown}/`), params(unknown));
    expect(res2.status).toBe(404);
  });
});
