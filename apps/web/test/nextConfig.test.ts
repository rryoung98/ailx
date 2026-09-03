/**
 * Dual-mode build config: the default build must stay a static export (the
 * GitHub Pages showcase), and AILX_BACKEND=1 must switch to a server build
 * that recognises `route.api.ts` route handlers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const saved = {
  AILX_BACKEND: process.env.AILX_BACKEND,
  NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
};

let bust = 0;
async function loadConfig(env: Record<string, string | undefined>) {
  delete process.env.AILX_BACKEND;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  Object.assign(process.env, env);
  const url = new URL("../next.config.mjs", import.meta.url).href;
  const mod = await import(`${url}?bust=${bust++}`);
  return mod.default as Record<string, unknown>;
}

afterEach(() => {
  delete process.env.AILX_BACKEND;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
});

describe("next.config.mjs", () => {
  it("defaults to the static GitHub Pages export", async () => {
    const cfg = await loadConfig({});
    expect(cfg.output).toBe("export");
    // route.api.ts AND page.api.tsx both stay inert: no API surface, and no
    // server-only page, is emitted into the GitHub Pages export.
    expect(cfg.pageExtensions).toBeUndefined();
    expect(cfg.basePath).toBe("/ailx");
    expect((cfg.env as Record<string, string>).NEXT_PUBLIC_AILX_BACKEND).toBe("");
  });

  it("AILX_BACKEND=1 switches to a server build with API route handlers", async () => {
    const cfg = await loadConfig({ AILX_BACKEND: "1" });
    expect(cfg.output).toBeUndefined();
    expect(cfg.pageExtensions).toContain("api.ts");
    expect(cfg.pageExtensions).toContain("api.tsx"); // server-only PAGES
    expect((cfg.pageExtensions as string[])[0]).toBe("api.ts"); // must win over "ts"
    expect((cfg.pageExtensions as string[])[1]).toBe("api.tsx"); // must win over "tsx"
    expect(cfg.basePath).toBe("");
    expect((cfg.env as Record<string, string>).NEXT_PUBLIC_AILX_BACKEND).toBe("1");
  });

  // Next traces a `<entry>_client-reference-manifest.js` for every app entry
  // but only EMITS one for `/route` (no extra dot suffix), so `route.api.ts`
  // handlers leave a dangling trace entry that makes Vercel's builder fail
  // with ENOENT. The server build must prune it; the export build has no
  // route handlers to prune.
  //
  // These assertions are DERIVED from the files on disk, not copied from the
  // config. The old test froze the literal key `/api/**`; the handler then
  // moved to `app/s/[token]/card.png`, the key did not, and every Production
  // deploy failed for a day with CI green. A test that repeats the config
  // cannot catch the config going stale.
  describe("the client reference manifest Next never writes for route.api.ts", () => {
    /** Every route handler under app/, as the PAGE path tracing keys on. */
    function routeHandlerPaths(): string[] {
      const appDir = fileURLToPath(new URL("../app", import.meta.url));
      const found: string[] = [];
      const walk = (dir: string): void => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (/^route\.api\.tsx?$/.test(e.name)) {
            found.push(`/${relative(appDir, dir).split(sep).join("/")}`);
          }
        }
      };
      walk(appDir);
      return found.sort();
    }

    it("prunes it for every route handler this app has, by exact page path", async () => {
      const cfg = await loadConfig({ AILX_BACKEND: "1" });
      const excludes = cfg.outputFileTracingExcludes as Record<string, string[]>;
      const handlers = routeHandlerPaths();
      // The repo allows exactly one (packages/core/test/frontendOnly.test.ts).
      expect(handlers).toHaveLength(1);
      expect(Object.keys(excludes).sort()).toEqual(handlers);
      for (const key of handlers) {
        expect(excludes[key]).toEqual(["**/*_client-reference-manifest.js"]);
      }
    });

    it("never widens the prune to pages, which need the manifest", async () => {
      const cfg = await loadConfig({ AILX_BACKEND: "1" });
      const excludes = cfg.outputFileTracingExcludes as Record<string, string[]>;
      for (const key of Object.keys(excludes)) {
        // `/**` or `/s/**` would also strip the share PAGE's manifest and
        // ship a deploy that builds green and 500s on first render.
        expect(key.endsWith("/**"), key).toBe(false);
      }
    });
  });

  it("does not touch file tracing in the static export", async () => {
    expect((await loadConfig({})).outputFileTracingExcludes).toBeUndefined();
  });

  it("any other AILX_BACKEND value stays static (opt-in is exact)", async () => {
    const cfg = await loadConfig({ AILX_BACKEND: "true" });
    expect(cfg.output).toBe("export");
  });

  it("respects an explicit NEXT_PUBLIC_BASE_PATH in both modes", async () => {
    expect((await loadConfig({ NEXT_PUBLIC_BASE_PATH: "/x" })).basePath).toBe("/x");
    expect((await loadConfig({ AILX_BACKEND: "1", NEXT_PUBLIC_BASE_PATH: "/y" })).basePath).toBe("/y");
  });

  // The export has no auth provider and never mounts one (docs/ARCHITECTURE.md
  // §10.2), but `app/layout.tsx` is one file for both builds, so the IMPORT of
  // @clerk/nextjs is in both graphs and an import is enough to bundle it.
  // Resolving it to a stub is what keeps the SDK out of the GitHub Pages
  // bundle; `test/bundleSecrecy.test.ts` greps the built output, this pins the
  // mechanism that makes it true.
  describe("the auth SDK", () => {
    /** What webpack hands a Next config function, reduced to what we touch. */
    function aliasAfter(cfg: Record<string, unknown>): Record<string, string> {
      const webpack = cfg.webpack as ((c: unknown) => { resolve: { alias: Record<string, string> } }) | undefined;
      if (!webpack) return {};
      return webpack({ resolve: { alias: { existing: "/keep/me" } } }).resolve.alias;
    }

    it("resolves to the local stub in the static export", async () => {
      const cfg = await loadConfig({});
      const alias = aliasAfter(cfg);
      expect(alias["@clerk/nextjs"]).toMatch(/lib\/auth\/clerkStub\.tsx$/);
      // ...without dropping aliases Next set up itself.
      expect(alias.existing).toBe("/keep/me");
      const turbo = cfg.turbopack as { resolveAlias: Record<string, string> };
      expect(turbo.resolveAlias["@clerk/nextjs"]).toBe("./lib/auth/clerkStub.tsx");
    });

    it("resolves to the real package in the hosted build", async () => {
      const cfg = await loadConfig({ AILX_BACKEND: "1" });
      expect(cfg.webpack).toBeUndefined();
      expect(cfg.turbopack).toBeUndefined();
    });

    it("points the stub at a file that exists", async () => {
      const alias = aliasAfter(await loadConfig({}));
      expect(existsSync(alias["@clerk/nextjs"])).toBe(true);
    });
  });
});
