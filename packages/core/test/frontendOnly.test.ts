/**
 * THE PUBLIC REPOSITORY IS A FRONTEND. This test is what keeps it one.
 *
 * The exam service — its HTTP handlers, its store, its auth, and the
 * OPERATIONAL item bank with the answer keys in it — lives in the private
 * `rryoung98/ailx-backend` repository and nowhere else. It used to live here
 * too, and that cost something concrete twice over:
 *
 *  - The bank was readable. 84 operational T2 items shipped with `key`,
 *    `rationale` and `provenance` inside a public JS chunk, in a public repo.
 *    A leaked bank cannot be un-leaked.
 *  - The two copies drifted. The private repo's handlers predated
 *    `POST /attempts/:id/score`, so a browser called a route that existed in
 *    THIS repo's copy and not in the one actually deployed. Two hosts over one
 *    handler set is two security postures, and the weaker one is the real one.
 *
 * Deleting them was not enough on its own: what a person removes on Monday, a
 * person re-adds on Friday, and every other suite in this repo stays green
 * while they do it. This file goes red instead.
 *
 * SCOPE — the MODULE GRAPH, not the content tree. What can this repository
 * import, declare and answer? The content tree is guarded separately and more
 * precisely by `packages/content-tools/test/public-tree.test.ts`, which knows
 * what a redacted rubric may contain. Two guards, no overlap, because a guard
 * that duplicates another one gets deleted as noise the first time it is
 * inconvenient.
 *
 * The other half of the fence is in the private repo: `pnpm sync:shared:check`
 * fails there if a package both repos need stops matching this one, with THIS
 * repo as the source of truth. Between them there is exactly one copy of every
 * security-critical file, and one source of truth for every shared one.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SKIP = new Set([
  "node_modules", "dist", "out", ".git", ".next", "coverage", "test-results",
  "playwright-report", ".turbo",
]);

/** Every source-ish file in the repo, as repo-relative POSIX paths. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(child));
    else if (entry.isFile()) out.push(relative(repoRoot, child).split(/[\\/]/).join("/"));
  }
  return out;
}

const files = walk(repoRoot);
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");
const exists = (rel: string): boolean => {
  try {
    statSync(join(repoRoot, rel));
    return true;
  } catch {
    return false;
  }
};

const packageJsons = files.filter(
  (f) => f.endsWith("package.json") && !f.includes("/node_modules/"),
);
const sources = files.filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.includes("/node_modules/"));

describe("the guard can see the repository", () => {
  // A walk that silently returned nothing would make every assertion below
  // pass over an empty list. Sentinels, not faith.
  it("walks a plausible tree, including files it must ALLOW", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("apps/web/app/page.tsx");
    expect(files).toContain("packages/report/src/index.ts");
    expect(packageJsons.length).toBeGreaterThan(5);
    expect(sources.length).toBeGreaterThan(100);
  });
});

describe("no second copy of the exam service", () => {
  it("declares no server-only package", () => {
    const names = packageJsons.map((f) => (JSON.parse(read(f)) as { name?: string }).name);
    for (const banned of ["@ailx/backend", "@ailx/instrument"]) {
      expect(names, `${banned} belongs in the private repo`).not.toContain(banned);
    }
    expect(exists("packages/backend")).toBe(false);
    expect(exists("packages/instrument")).toBe(false);
  });

  it("depends on no database, no object store SDK and no exam-service package", () => {
    // `@vercel/blob` is deliberately absent from this list: the BROWSER uses
    // `@vercel/blob/client` to PUT a T1 site straight into the object store
    // with a scoped token the service issued. That is a frontend capability
    // and holds no credential of its own.
    const banned = ["pg", "@types/pg", "@ailx/backend", "@ailx/instrument", "node-pg-migrate", "@clerk/backend"];
    const offenders: string[] = [];
    for (const f of packageJsons) {
      const pkg = JSON.parse(read(f)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (banned.includes(dep)) offenders.push(`${f} -> ${dep}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("imports neither deleted package from any source file", () => {
    // Comments may still MENTION them — the split is worth explaining. Only a
    // real import is a re-coupling, so match the import forms and not prose.
    const importing = sources.filter((f) =>
      /(?:from|import|require)\s*\(?\s*["']@ailx\/(?:backend|instrument)(?:\/[^"']*)?["']/.test(read(f)),
    );
    expect(importing).toEqual([]);
  });

  it("has no database schema or migration to be a second truth about", () => {
    expect(exists("db")).toBe(false);
    expect(files.filter((f) => f.startsWith("db/"))).toEqual([]);
  });
});

describe("no API surface of its own", () => {
  it("has no `app/api/**` in any app", () => {
    const routes = files.filter((f) => /^apps\/[^/]+\/app\/api\//.test(f));
    expect(routes, "app/api/** was the duplicate exam host — it is services/api now").toEqual([]);
  });

  it("has no server request adapter", () => {
    for (const gone of [
      "apps/web/lib/server/api.ts",
      "apps/web/lib/server/site.ts",
      "apps/web/lib/server/instrument.ts",
    ]) {
      expect(exists(gone), gone).toBe(false);
    }
  });

  /**
   * ONE route handler survives, and it is allowed BY NAME so that adding a
   * second is a decision somebody has to make in this file, in front of a
   * reviewer, rather than a file somebody quietly adds.
   */
  it("keeps exactly one route handler: the frontend's own Open Graph card", () => {
    const handlers = files.filter((f) => /(^|\/)route\.(api\.)?tsx?$/.test(f));
    expect(handlers).toEqual(["apps/web/app/s/[token]/card.png/route.api.ts"]);
    const src = read(handlers[0]!);
    // It must stay a RASTERIZER: it may read the public share payload over
    // HTTP, and it may not grow a store, a key or a policy decision.
    expect(src).toContain("ImageResponse");
    expect(src).not.toMatch(/@ailx\/(backend|instrument)/);
    expect(src).not.toMatch(/\bfrom\s+["']pg["']/);
  });
});

describe("what a browser legitimately needs is still here", () => {
  it.each([
    ["packages/core", "content addressing and the purity harness"],
    ["packages/contract", "the wire shapes the client renders"],
    ["packages/report", "composite, insights, player type — all derived client-side"],
    ["packages/session", "the event-sourced engine the sitting runs on"],
    ["packages/tracks", "the runners"],
    ["instruments/demo-2026.1", "the released-practice tier the static export plays"],
  ])("%s is still here — %s", (dir) => expect(exists(dir)).toBe(true));

  it("still reaches the exam service through the one seam", () => {
    // If this stops being true the frontend has no backend at all. That is a
    // different bug, and it should not be silent either.
    expect(read("apps/web/lib/mode.ts")).toContain("NEXT_PUBLIC_AILX_API_BASE");
  });
});
