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

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** The exam service's own packages, banned by name because that is their name. */
const BANNED_PACKAGES: readonly string[] = ["@ailx/backend", "@ailx/instrument", "@clerk/backend"];

/**
 * A DATABASE is banned by CAPABILITY, not by name (TEN-226).
 *
 * The ban used to be six literal names, and `@neondatabase/serverless` — the
 * driver docs/DEPLOY.md names for the hosted database — was not one of them,
 * so a hosted page reading Neon directly would have gone through green. The
 * rule this repo actually has is "the frontend talks to the exam service, not
 * to a store", so match the SHAPE: a SQL driver, a migration runner, an ORM or
 * a key-value client, whoever ships it.
 */
const DATABASE_DEPS: readonly RegExp[] = [
  /^@types\/pg$/,
  /^pg(-[a-z0-9-]+)?$/, // pg, pg-promise, pg-pool, pg-native...
  /^node-pg-migrate$/,
  /^postgres(-migrations)?$/,
  /^@neondatabase\//,
  /^@vercel\/postgres/,
  /^@planetscale\/database$/,
  /^@libsql\//,
  /^@electric-sql\/pglite$/,
  /^(mysql|mysql2|sqlite3|better-sqlite3|mongodb|mongoose|ioredis|redis)$/,
  /^(drizzle-orm|prisma|@prisma\/client|kysely|knex|typeorm|sequelize|slonik|mikro-orm|@mikro-orm\/)/,
];

/** Pure, so a fixture manifest proves it bites without touching the tree. */
function bannedDependencies(pkg: Manifest): string[] {
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter((dep) => BANNED_PACKAGES.includes(dep) || DATABASE_DEPS.some((re) => re.test(dep)))
    .sort();
}

const packageJsons = files.filter(
  (f) => f.endsWith("package.json") && !f.includes("/node_modules/"),
);
const sources = files.filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.includes("/node_modules/"));

/**
 * This file QUOTES the strings it bans — a fixture has to say them to prove
 * the scan bites — so it names itself out of every source scan below. It is
 * the one exemption, and it is spelled once.
 */
const GUARD_FILE = "packages/core/test/frontendOnly.test.ts";
const scanned = sources.filter((f) => f !== GUARD_FILE);

/** Source with comments removed: prose ABOUT a banned import is not one. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Every server-side Clerk entrypoint a source imports, in any import form.
 * `@clerk/nextjs` (the browser SDK) is allowed; `@clerk/nextjs/server` and
 * every `@clerk/backend` path are not.
 */
const SERVER_AUTH_IMPORT =
  /(?:from|import|require)\s*\(?\s*["'](@clerk\/nextjs\/server|@clerk\/backend(?:\/[^"']*)?)["']/g;

function serverAuthImports(src: string): string[] {
  return [...code(src).matchAll(SERVER_AUTH_IMPORT)].map((m) => m[1]!);
}

describe("the guard can see the repository", () => {
  // A walk that silently returned nothing would make every assertion below
  // pass over an empty list. Sentinels, not faith.
  it("walks a plausible tree, including files it must ALLOW", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("apps/web/app/page.tsx");
    expect(files).toContain("packages/report/src/index.ts");
    expect(packageJsons.length).toBeGreaterThan(5);
    expect(sources.length).toBeGreaterThan(100);
    // The one self-exemption must name a file that is really there, or the
    // scans below would silently include this file's own fixtures.
    expect(files).toContain(GUARD_FILE);
    expect(scanned.length).toBe(sources.length - 1);
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
    const offenders: string[] = [];
    for (const f of packageJsons) {
      for (const dep of bannedDependencies(JSON.parse(read(f)) as Manifest)) {
        offenders.push(`${f} -> ${dep}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names a database driver added to an app, not just the six it knew about", () => {
    // The fixture is the REAL apps/web manifest plus the driver docs/DEPLOY.md
    // names for the hosted database. A name list missed it (TEN-226).
    const real = JSON.parse(read("apps/web/package.json")) as Manifest;
    expect(bannedDependencies(real), "apps/web is clean today").toEqual([]);
    const withNeon: Manifest = {
      ...real,
      dependencies: { ...real.dependencies, "@neondatabase/serverless": "^0.10.4" },
    };
    expect(bannedDependencies(withNeon)).toEqual(["@neondatabase/serverless"]);
  });

  it("bans a database by capability, and lets a browser capability through", () => {
    for (const dep of [
      "pg", "@types/pg", "node-pg-migrate", "pg-promise", "postgres",
      "@neondatabase/serverless", "@vercel/postgres", "@planetscale/database",
      "@libsql/client", "mysql2", "better-sqlite3", "mongodb", "drizzle-orm",
      "@prisma/client", "kysely", "knex", "typeorm", "sequelize",
      "@ailx/backend", "@ailx/instrument",
    ]) {
      expect(bannedDependencies({ dependencies: { [dep]: "1" } }), dep).toEqual([dep]);
      expect(bannedDependencies({ devDependencies: { [dep]: "1" } }), dep).toEqual([dep]);
    }
    // `@vercel/blob` is deliberately NOT banned: the BROWSER uses
    // `@vercel/blob/client` to PUT a T1 site straight into the object store
    // with a scoped token the service issued. That is a frontend capability
    // and holds no credential of its own. Nor is the Clerk BROWSER SDK.
    for (const ok of ["@vercel/blob", "@clerk/nextjs", "next", "zod", "yaml"]) {
      expect(bannedDependencies({ dependencies: { [ok]: "1" } }), ok).toEqual([]);
    }
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
    // Root-only was the hole: `apps/web/db/` passed (TEN-226). A `db/` or a
    // `migrations/` directory ANYWHERE in the tree is a second truth about a
    // store this repo does not own.
    expect(exists("db")).toBe(false);
    const dbTrees = files.filter((f) => /(^|\/)(db|migrations)\//.test(f));
    expect(dbTrees, "a schema or migration directory belongs in the private repo").toEqual([]);
    // ...and the pattern really would see one under an app.
    const bites = (f: string): boolean => /(^|\/)(db|migrations)\//.test(f);
    expect(bites("apps/web/db/schema.sql")).toBe(true);
    expect(bites("db/1-init.sql")).toBe(true);
    expect(bites("apps/web/lib/dbg/log.ts")).toBe(false);
  });
});

/**
 * TEN-227: the auth boundary is a rule about IMPORTS, not about a manifest.
 *
 * `@clerk/backend` was banned as a declared dependency, and `@clerk/nextjs`
 * ships it transitively, so `import { auth } from "@clerk/nextjs/server"` put
 * token verification one import away with nothing failing. AGENTS.md says this
 * app verifies no token and holds no `CLERK_SECRET_KEY`: the exam service owns
 * that decision, and a second verifier is a second security posture.
 */
describe("no server-side auth is reachable from this repo", () => {
  it("imports no server-side Clerk entrypoint from any source", () => {
    const offenders = scanned
      .map((f) => [f, serverAuthImports(read(f))] as const)
      .filter(([, hits]) => hits.length > 0)
      .map(([f, hits]) => `${f} -> ${hits.join(", ")}`);
    expect(offenders, "the exam service verifies the token, this repo does not").toEqual([]);
  });

  it("names a server-auth import in a page, whatever spelling it uses", () => {
    // The fixture is the import the ban could not see.
    expect(serverAuthImports('import { auth } from "@clerk/nextjs/server";')).toEqual([
      "@clerk/nextjs/server",
    ]);
    expect(serverAuthImports("const { auth } = require('@clerk/nextjs/server')")).toEqual([
      "@clerk/nextjs/server",
    ]);
    expect(serverAuthImports('import { createClerkClient } from "@clerk/backend";')).toEqual([
      "@clerk/backend",
    ]);
    expect(serverAuthImports('export * from "@clerk/backend/internal";')).toEqual([
      "@clerk/backend/internal",
    ]);
    expect(serverAuthImports('await import("@clerk/nextjs/server")')).toEqual([
      "@clerk/nextjs/server",
    ]);
  });

  it("lets the BROWSER SDK through, and does not fire on prose", () => {
    // `<SignIn />` and `<SignUp />` are the whole point of the hosted build.
    expect(serverAuthImports('import { SignUp } from "@clerk/nextjs";')).toEqual([]);
    expect(serverAuthImports('vi.mock("@clerk/nextjs", () => ({}))')).toEqual([]);
    expect(serverAuthImports("// never import @clerk/nextjs/server here")).toEqual([]);
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

/**
 * TEN-62: the browser holds no provider credential, in EITHER build.
 *
 * The key, the PKCE verifier and the browser-side token exchange were deleted
 * from `apps/web` and `packages/tracks`. A codex review pointed out that the
 * only guard was a source scan of ONE file (T1's `Runner.tsx`), so a key path
 * re-added in the panel, in the gateway client, in T4, or under a different
 * slot name would have gone through green. This scans every browser source in
 * the repo, which is the scope the claim is made at.
 *
 * The shared-demo proxy under `services/` is deliberately EXCLUDED: it is a
 * deployed service that holds the operator's key on purpose, and it never
 * runs in a browser.
 */
describe("no provider credential can reach a browser", () => {
  const browserSources = files.filter(
    (f) =>
      /^(apps\/web|packages\/(tracks|contract|report|session|core))\//.test(f) &&
      /\.(ts|tsx)$/.test(f) &&
      !f.includes("/test/") &&
      !f.endsWith(".test.ts") &&
      !f.endsWith(".test.tsx"),
  );

  it("reads a real set of sources", () => {
    expect(browserSources.length).toBeGreaterThan(50);
    expect(browserSources).toContain("apps/web/features/exam/ConnectPanel.tsx");
    expect(browserSources).toContain("apps/web/lib/data/modelGateway.ts");
    expect(browserSources).toContain("packages/tracks/t4-generative/src/imagegen.ts");
  });

  it.each([
    // Both spellings: the slot was deleted before the rename, so it must not
    // come back under either namespace (docs/RENAME.md §5 step 7).
    ["the deleted key slot", /(?:ailx|foray):openrouter-key/],
    ["a PKCE verifier slot", /pkce-verifier|PKCE_VERIFIER/],
    ["a browser-side code exchange", /code_verifier|code_challenge/],
  ])("names %s nowhere", (_what, pattern) => {
    const offenders = browserSources.filter((f) => pattern.test(code(read(f))));
    expect(offenders).toEqual([]);
  });

  it("the comment stripper does not hide a real slot behind a comment", () => {
    expect(/(?:ailx|foray):openrouter-key/.test(code('const k = "foray:openrouter-key";'))).toBe(true);
    expect(/(?:ailx|foray):openrouter-key/.test(code('// the old ailx:openrouter-key slot'))).toBe(false);
  });

  /**
   * `authHeaders` mints the ONE `Authorization` header a browser sends, and it
   * is a Clerk session JWT — this browser's own identity, never a provider's
   * credential. Allowed by name for the same reason the card route is: a
   * second minter has to be a decision in front of a reviewer.
   */
  it("mints an Authorization header in exactly one place", () => {
    const minters = browserSources.filter((f) => /authorization`?:\s*`Bearer/i.test(read(f)));
    expect(minters).toEqual(["apps/web/lib/data/authHeaders.ts"]);
  });

  it("keeps the shared-demo proxy, which the static export still needs", () => {
    // The exam service's /v1/model/* routes are all behind auth, so a build
    // with no identity cannot use them (AGENTS.md, "The shared demo has no
    // anonymous path"). Deleting this would leave the Pages export unable to
    // call a model at all.
    expect(exists("services/openrouter-proxy")).toBe(true);
  });
});
