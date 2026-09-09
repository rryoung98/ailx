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

type Overrides = Record<string, unknown>;

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  overrides?: Overrides;
  resolutions?: Overrides;
  pnpm?: { overrides?: Overrides };
  bundledDependencies?: string[];
  bundleDependencies?: string[];
}

/** The exam service's own packages, banned by name because that is their name. */
const BANNED_PACKAGES: readonly string[] = ["@ailx/backend", "@ailx/instrument"];

/**
 * SERVER-SIDE CLERK is banned by CAPABILITY, not by name (TEN-227 review).
 *
 * The ban was two literals, `@clerk/nextjs/server` and `@clerk/backend`, so
 * `@clerk/express`, `@clerk/fastify`, `@clerk/clerk-sdk-node`, `@clerk/remix`
 * and the rest walked through both the manifest scan and the import scan —
 * every one of them wraps `@clerk/backend` and verifies a token with a secret
 * key. Adding three more names would leave the next one open, so invert it:
 * a Clerk entrypoint is server-side unless it is one of the BROWSER halves,
 * which are the short, stable list.
 */
const BROWSER_AUTH_MODULES: readonly RegExp[] = [
  // `@clerk/nextjs@7.9.2` publishes `.`, `./types`, `./errors`, `./legacy`,
  // `./server`, `./internal`, `./webhooks` and `./experimental`. Two of those
  // subpaths are browser halves — `./errors` is the client-component helper
  // for a failed sign-in — and the rest, `./server` first among them, are not.
  /^@clerk\/nextjs(\/(errors|types))?$/,
  /^@clerk\/elements(\/.*)?$/, // headless browser UI, no secret key
  /^@clerk\/(clerk-react|clerk-js|themes|localizations|types|shared)(\/.*)?$/,
];

/**
 * `@clerk/backend` is banned by LITERAL as well as by capability. The rule
 * above is deny-by-default with an allowlist, and one over-wide entry in that
 * allowlist would unban the whole namespace without a single failure.
 *
 * What makes this load-bearing is that the literal is a SEPARATE DISJUNCT of
 * `isServerAuthModule`, not that it appears first: `A || (B && !C)` is
 * order-independent, so moving this line changes nothing and folding it INTO
 * the capability branch silently removes the protection. Keep it a disjunct.
 * `test/frontendOnly.test.ts` proves it earns its place by building the
 * over-wide allowlist `/^@clerk\//` and asserting `@clerk/backend` is still
 * denied under it.
 */
const SERVER_AUTH_LITERALS: readonly RegExp[] = [/^@clerk\/backend(\/.*)?$/];

const isServerAuthModule = (spec: string): boolean =>
  SERVER_AUTH_LITERALS.some((re) => re.test(spec)) ||
  (/^@clerk\//.test(spec) && !BROWSER_AUTH_MODULES.some((re) => re.test(spec)));

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

/**
 * Every package a manifest names, through ANY field it can name one in
 * (TEN-226 review). `dependencies` and `devDependencies` were the whole scan,
 * so `optionalDependencies`, `peerDependencies`, `overrides`, `resolutions`,
 * `pnpm.overrides` and a bundled list were all open doors into the same
 * `node_modules`. An override key may carry a version selector (`pg@8`) and
 * may be NESTED under the package it applies to, so both are unwrapped.
 */
function overrideNames(node: unknown): string[] {
  if (Array.isArray(node)) return node.filter((n): n is string => typeof n === "string");
  if (!node || typeof node !== "object") return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(node as Overrides)) {
    // `pg@8` -> `pg`, `@clerk/backend@2` -> `@clerk/backend`, `>pg` -> `pg`.
    const at = key.lastIndexOf("@");
    out.push((at > 0 ? key.slice(0, at) : key).replace(/^[<>=^~]+/, ""));
    out.push(...overrideNames(value));
  }
  return out;
}

function declaredPackages(pkg: Manifest): string[] {
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...overrideNames(pkg.overrides),
    ...overrideNames(pkg.resolutions),
    ...overrideNames(pkg.pnpm?.overrides),
    ...overrideNames(pkg.bundledDependencies),
    ...overrideNames(pkg.bundleDependencies),
  ];
}

/** Pure, so a fixture manifest proves it bites without touching the tree. */
function bannedDependencies(pkg: Manifest): string[] {
  return [...new Set(declaredPackages(pkg))]
    .filter(
      (dep) =>
        BANNED_PACKAGES.includes(dep) ||
        isServerAuthModule(dep) ||
        DATABASE_DEPS.some((re) => re.test(dep)),
    )
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
 * The import scan asks the same capability question as the manifest scan:
 * every `@clerk/*` specifier is server-side unless it is a browser half.
 */
const CLERK_IMPORT = /(?:from|import|require)\s*\(?\s*["'](@clerk\/[^"']+)["']/g;

function serverAuthImports(src: string): string[] {
  return [...code(src).matchAll(CLERK_IMPORT)].map((m) => m[1]!).filter(isServerAuthModule);
}

/**
 * A `'use server'` DIRECTIVE: a string statement on a line of its own, at
 * module scope or at the top of a function. A quoted mention in an expression
 * is not one, and neither is prose — comments are stripped first.
 */
const USE_SERVER = /^[ \t]*["']use server["'][ \t]*;?[ \t]*$/m;

function hasUseServerDirective(src: string): boolean {
  return USE_SERVER.test(code(src));
}

/**
 * Which files the `use server` scan reads: EVERY source under an app, not the
 * `app/` route tree alone. A directive is a property of a module, not of its
 * path — `apps/web/features/exam/actions.ts` becomes the same public endpoint
 * as soon as a page imports it, and the route-tree scan could not see it.
 */
const isAppSource = (f: string): boolean => /^apps\/[^/]+\//.test(f);

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

  it("reads every dependency field a manifest can carry, not just the two", () => {
    // `dependencies` and `devDependencies` were the whole scan, so a driver
    // installed through any other field was invisible — and every one of
    // these fields really does put a package in the store on `pnpm install`
    // or pin the version that lands there.
    expect(bannedDependencies({ optionalDependencies: { pg: "^8" } })).toEqual(["pg"]);
    expect(bannedDependencies({ peerDependencies: { "@neondatabase/serverless": "*" } })).toEqual([
      "@neondatabase/serverless",
    ]);
    expect(bannedDependencies({ overrides: { "better-sqlite3": "11" } })).toEqual([
      "better-sqlite3",
    ]);
    // An override may be NESTED under the package it applies to.
    expect(bannedDependencies({ overrides: { next: { mongodb: "6" } } })).toEqual(["mongodb"]);
    expect(bannedDependencies({ resolutions: { mysql2: "3" } })).toEqual(["mysql2"]);
    expect(bannedDependencies({ pnpm: { overrides: { "@clerk/backend": "2" } } })).toEqual([
      "@clerk/backend",
    ]);
    expect(bannedDependencies({ bundledDependencies: ["drizzle-orm"] })).toEqual(["drizzle-orm"]);
    expect(bannedDependencies({ bundleDependencies: ["typeorm"] })).toEqual(["typeorm"]);
    // A version spec in an override key is still that package.
    expect(bannedDependencies({ overrides: { "pg@8": "8.13.0" } })).toEqual(["pg"]);
    // ...and the fields a real manifest carries stay quiet.
    expect(bannedDependencies({ peerDependencies: { react: "^19.0.0" } })).toEqual([]);
  });

  it("bans a database by capability, and lets a browser capability through", () => {
    for (const dep of [
      "pg", "@types/pg", "node-pg-migrate", "pg-promise", "postgres",
      "@neondatabase/serverless", "@vercel/postgres", "@planetscale/database",
      "@libsql/client", "mysql2", "better-sqlite3", "mongodb", "drizzle-orm",
      "@prisma/client", "kysely", "knex", "typeorm", "sequelize",
      "@ailx/backend", "@ailx/instrument",
      // Server-side Clerk is the same kind of capability: it verifies a token
      // with a secret key, whichever framework binding ships it.
      "@clerk/backend", "@clerk/express", "@clerk/fastify", "@clerk/clerk-sdk-node",
      "@clerk/remix", "@clerk/astro", "@clerk/tanstack-react-start",
    ]) {
      expect(bannedDependencies({ dependencies: { [dep]: "1" } }), dep).toEqual([dep]);
      expect(bannedDependencies({ devDependencies: { [dep]: "1" } }), dep).toEqual([dep]);
    }
    // `@vercel/blob` is deliberately NOT banned: the BROWSER uses
    // `@vercel/blob/client` to PUT a T1 site straight into the object store
    // with a scoped token the service issued. That is a frontend capability
    // and holds no credential of its own. Nor is the Clerk BROWSER SDK.
    for (const ok of [
      "@vercel/blob", "@clerk/nextjs", "@clerk/clerk-react", "@clerk/themes",
      "@clerk/localizations", "@clerk/types", "next", "zod", "yaml",
    ]) {
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

  it("names a server-side Clerk SDK by capability, not by the two it knew about", () => {
    // Two literals — `@clerk/nextjs/server` and `@clerk/backend` — left every
    // other framework binding through, and each of these verifies a token
    // with a secret key exactly as `@clerk/backend` does; they all wrap it.
    expect(serverAuthImports('import { clerkMiddleware } from "@clerk/express";')).toEqual([
      "@clerk/express",
    ]);
    expect(serverAuthImports('import clerkPlugin from "@clerk/fastify";')).toEqual([
      "@clerk/fastify",
    ]);
    expect(serverAuthImports("const c = require('@clerk/clerk-sdk-node')")).toEqual([
      "@clerk/clerk-sdk-node",
    ]);
    expect(serverAuthImports('import { getAuth } from "@clerk/remix/ssr.server";')).toEqual([
      "@clerk/remix/ssr.server",
    ]);
    expect(serverAuthImports('import { verifyToken } from "@clerk/astro/server";')).toEqual([
      "@clerk/astro/server",
    ]);
  });

  it("lets the BROWSER SDK through, and does not fire on prose", () => {
    // `<SignIn />` and `<SignUp />` are the whole point of the hosted build.
    expect(serverAuthImports('import { SignUp } from "@clerk/nextjs";')).toEqual([]);
    expect(serverAuthImports('import { useUser } from "@clerk/clerk-react";')).toEqual([]);
    expect(serverAuthImports('import { dark } from "@clerk/themes";')).toEqual([]);
    expect(serverAuthImports('import type { UserResource } from "@clerk/types";')).toEqual([]);
    expect(serverAuthImports('vi.mock("@clerk/nextjs", () => ({}))')).toEqual([]);
    expect(serverAuthImports("// never import @clerk/nextjs/server here")).toEqual([]);
  });

  /**
   * `@clerk/nextjs` is ONE package with EIGHT published entrypoints, and the
   * capability rule cannot guess which half a subpath is. Checked against the
   * registry rather than reasoned about: `@clerk/nextjs@7.9.2` publishes `.`,
   * `./types`, `./errors`, `./legacy`, `./server`, `./internal`, `./webhooks`
   * and `./experimental`. `./errors` is the documented CLIENT-component helper
   * for rendering a failed sign-in and `./types` is types — both are browser
   * halves, and the exact `/^@clerk\/nextjs$/` denied both. A legitimate
   * browser import would have failed the build with a message about
   * server-side token verification, which says nothing to whoever hit it.
   *
   * So the split is asserted subpath by subpath, allowed AND denied, because
   * the boundary is now the only thing between a real browser package and a
   * failed build. It is pinned, not implied.
   */
  it("splits @clerk/nextjs by its published subpaths, browser half from server half", () => {
    // ALLOWED: the browser halves.
    expect(
      serverAuthImports('import { isClerkAPIResponseError } from "@clerk/nextjs/errors";'),
    ).toEqual([]);
    expect(serverAuthImports('import type { SessionResource } from "@clerk/nextjs/types";')).toEqual(
      [],
    );

    // DENIED: every remaining published subpath, each named.
    expect(serverAuthImports('import { auth } from "@clerk/nextjs/server";')).toEqual([
      "@clerk/nextjs/server",
    ]);
    expect(serverAuthImports('import { x } from "@clerk/nextjs/internal";')).toEqual([
      "@clerk/nextjs/internal",
    ]);
    expect(serverAuthImports('import { verifyWebhook } from "@clerk/nextjs/webhooks";')).toEqual([
      "@clerk/nextjs/webhooks",
    ]);
    expect(serverAuthImports('import { x } from "@clerk/nextjs/experimental";')).toEqual([
      "@clerk/nextjs/experimental",
    ]);
    // `./legacy` re-exports the old default-export surface, server half and
    // all, so it stays denied with the rest.
    expect(serverAuthImports('import { x } from "@clerk/nextjs/legacy";')).toEqual([
      "@clerk/nextjs/legacy",
    ]);
  });

  it("lets @clerk/elements through and keeps @clerk/testing out, for stated reasons", () => {
    // `@clerk/elements` is unstyled BROWSER UI — headless sign-in/sign-up
    // components that render in a client component and hold no secret key.
    expect(serverAuthImports('import * as SignIn from "@clerk/elements/sign-in";')).toEqual([]);
    expect(serverAuthImports('import * as Common from "@clerk/elements/common";')).toEqual([]);
    expect(bannedDependencies({ dependencies: { "@clerk/elements": "1" } })).toEqual([]);

    // `@clerk/testing` STAYS DENIED, and here is why, in words, because the
    // Playwright/Clerk e2e work will hit this and a bare failure teaches
    // nothing: it is a TEST-HARNESS package, not a browser package, and it
    // DEPENDS on `@clerk/backend` (`@clerk/testing@2.2.34` -> `^3.17.2`).
    // Installing it puts the token verifier in `node_modules` by declaration,
    // whatever any code does with it. That fact is checkable in a manifest
    // rather than remembered. If e2e needs it, it belongs in the exam service
    // repo that already holds the secret key — not here.
    expect(serverAuthImports('import { clerkSetup } from "@clerk/testing/playwright";')).toEqual([
      "@clerk/testing/playwright",
    ]);
    expect(bannedDependencies({ devDependencies: { "@clerk/testing": "1" } })).toEqual([
      "@clerk/testing",
    ]);
  });

  /**
   * The browser allowlist is a deny-by-default with an escape hatch, so ONE
   * over-wide entry in it — a stray `/^@clerk\//` — would unban the whole
   * namespace silently and nothing here would fail. `@clerk/backend` is
   * therefore ALSO a literal, checked BEFORE the allowlist is consulted. It
   * costs nothing and it fails loudly.
   */
  it("bans @clerk/backend by literal as well as by capability", () => {
    expect(SERVER_AUTH_LITERALS.some((re) => re.test("@clerk/backend"))).toBe(true);
    expect(SERVER_AUTH_LITERALS.some((re) => re.test("@clerk/backend/internal"))).toBe(true);
    expect(serverAuthImports('import { createClerkClient } from "@clerk/backend";')).toEqual([
      "@clerk/backend",
    ]);
    expect(bannedDependencies({ dependencies: { "@clerk/backend": "2" } })).toEqual([
      "@clerk/backend",
    ]);
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

/**
 * TEN-228: a server action is a route handler with no file name to catch it.
 *
 * FRONTEND.md banned `'use server'` in PROSE only. The gate matched
 * `apps/*\/app/api/**` and `route.(api.)?tsx?` file NAMES, and neither can see
 * a directive inside a page component — so a `'use server'` block in any
 * hosted `page.api.tsx` would have compiled into a public POST endpoint in
 * this repo, unguarded, with the suite green. The one-route-handler invariant
 * in AGENTS.md is the reason a reviewer sees any new server surface at all.
 */
describe("no server action anywhere under an app", () => {
  const appSources = scanned.filter(isAppSource);

  it("reads a real set of app sources", () => {
    expect(appSources.length).toBeGreaterThan(10);
    expect(appSources).toContain("apps/web/app/page.tsx");
  });

  it("scans every app source, not only the route tree", () => {
    // The route tree was the first hole and only part of it: a server action
    // is a module directive, so `apps/web/features/actions.ts` compiles into
    // the same public endpoint from outside `app/`, and Next bundles it the
    // moment a page imports it.
    expect(isAppSource("apps/web/features/exam/actions.ts")).toBe(true);
    expect(isAppSource("apps/web/lib/data/actions.ts")).toBe(true);
    expect(isAppSource("apps/web/app/page.tsx")).toBe(true);
    expect(isAppSource("packages/report/src/index.ts")).toBe(false);
    expect(appSources).toContain("apps/web/features/exam/ConnectPanel.tsx");
  });

  it("declares `use server` in no app source", () => {
    const offenders = appSources.filter((f) => hasUseServerDirective(read(f)));
    expect(offenders, "a server action is an unguarded public endpoint").toEqual([]);
  });

  it("names a `use server` directive at module or function scope", () => {
    expect(hasUseServerDirective('"use server";\nexport async function save() {}')).toBe(true);
    expect(hasUseServerDirective("'use server'\nexport async function save() {}")).toBe(true);
    expect(
      hasUseServerDirective("export async function save() {\n  'use server';\n}"),
    ).toBe(true);
    // A hosted page is exactly the file the name-based checks could not see.
    expect(
      hasUseServerDirective('export default function Page() {\n  async function act() {\n    "use server";\n  }\n}'),
    ).toBe(true);
  });

  it("does not fire on prose, or on a client directive", () => {
    expect(hasUseServerDirective("// 'use server' is banned here\n")).toBe(false);
    expect(hasUseServerDirective("/**\n * \"use server\" is banned here\n */\n")).toBe(false);
    expect(hasUseServerDirective('const mode = "use server";')).toBe(false);
    expect(hasUseServerDirective('"use client";\n')).toBe(false);
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
