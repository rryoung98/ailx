import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import vitestProjects from "../../../vitest-workspace.ts";
import { workspaceSourceAliases } from "../../../vitest.shared.ts";

/**
 * The workspace wiring guard.
 *
 * A package can be invisible to CI in two ways, and this repo has already been
 * bitten by the first: `services/openrouter-proxy` existed, had tests, and ran
 * nowhere, because `services/*` was missing from `pnpm-workspace.yaml`. The
 * second is the same hole one level down — a package that pnpm knows about but
 * `vitest-workspace.ts` (the project list `pnpm test` runs) does not.
 *
 * Both are silent: the suite stays green because the tests are never
 * collected. So they are asserted here instead of trusted.
 */

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", "dist", "out", ".git", ".next", "coverage"]);

/** Every directory holding a package.json, excluding the repo root itself. */
function findPackageDirs(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const child = join(dir, entry.name);
    try {
      statSync(join(child, "package.json"));
      found.push(relative(repoRoot, child));
    } catch {
      /* not a package; keep descending */
    }
    found.push(...findPackageDirs(child, depth + 1));
  }
  return found;
}

/** `a/*` / `a/b/*` / exact path. The only shapes either list uses. */
function matches(pattern: string, path: string): boolean {
  if (!pattern.includes("*")) return pattern === path;
  const prefix = pattern.slice(0, -1); // "packages/*" -> "packages/"
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("/");
}

const pnpmGlobs = (readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8").match(/^\s*-\s*(\S+)/gm) ?? [])
  .map((line) => line.replace(/^\s*-\s*/, "").trim())
  .filter(Boolean);

const packageDirs = findPackageDirs(repoRoot);

describe("workspace wiring", () => {
  it("finds the packages it is meant to check", () => {
    expect(packageDirs).toContain("apps/web");
    expect(packageDirs).toContain("services/openrouter-proxy");
    expect(packageDirs.length).toBeGreaterThan(5);
  });

  it.each(packageDirs)("%s is a pnpm workspace member", (dir) => {
    expect(pnpmGlobs.some((glob) => matches(glob, dir))).toBe(true);
  });

  it.each(packageDirs)("%s is in the vitest project list", (dir) => {
    const patterns = vitestProjects.filter((entry): entry is string => typeof entry === "string");
    const excluded = patterns.some((p) => p.startsWith("!") && matches(p.slice(1), dir));
    const included = patterns.some((p) => !p.startsWith("!") && matches(p, dir));
    expect(included && !excluded).toBe(true);
  });
});

/**
 * The clean-clone guard.
 *
 * `pnpm test` on a fresh checkout used to fail 75 test files with "Failed to
 * resolve entry for package @ailx/core": every `@ailx/*` import resolved
 * through node_modules to a `dist/` nothing had built yet. Building first hid
 * it and introduced a worse failure — the suite then measured the last build
 * instead of the tree (539d840).
 *
 * The fix is one alias table in `vitest.shared.ts`, used by every project.
 * This block fails if a package stops using it, or if the table stops covering
 * a specifier the repo actually imports.
 */
const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["'](@ailx\/[^"']+)["']/g;
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs)$/;

/** Every file under `dir`, skipping build output and dependencies. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (SOURCE_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

/** The `@ailx/*` specifiers imported by files under `dir`, minus `self`. */
function foreignAilxImports(dir: string, self: string | undefined): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1];
      if (self !== undefined && (specifier === self || specifier.startsWith(`${self}/`))) continue;
      found.add(specifier);
    }
  }
  return found;
}

/** What vite will do with `specifier`: first matching entry wins. */
function applyAliases(specifier: string): string | undefined {
  for (const { find, replacement } of workspaceSourceAliases) {
    if (find.test(specifier)) return specifier.replace(find, replacement);
  }
  return undefined;
}

/** The file vite would land on, trying the extensions it tries. */
function resolvedFile(base: string): string | undefined {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** Packages whose own code or tests import ANOTHER workspace package. */
const importers = packageDirs
  .map((dir) => {
    const full = join(repoRoot, dir);
    const name = (JSON.parse(readFileSync(join(full, "package.json"), "utf8")) as { name?: string })
      .name;
    return { dir, full, imports: foreignAilxImports(full, name) };
  })
  .filter((pkg) => pkg.imports.size > 0);

describe("tests read package source, not the last build", () => {
  it("finds the packages that import a sibling", () => {
    // A regex that matched nothing would make every assertion below vacuous.
    expect(importers.map((p) => p.dir)).toContain("apps/web");
    expect(importers.length).toBeGreaterThan(5);
  });

  it.each(importers.map((p) => p.dir))("%s has a vitest config using the shared aliases", (dir) => {
    const config = join(repoRoot, dir, "vitest.config.ts");
    expect(existsSync(config), `${dir} needs a vitest.config.ts`).toBe(true);
    // The table lives in ONE file. A project that grows its own copy drifts
    // from it silently, which is how the alias set went stale before.
    expect(readFileSync(config, "utf8")).toContain("vitest.shared");
  });

  const specifiers = [...new Set(importers.flatMap((p) => [...p.imports]))].sort();

  it("has a specifier from every shape it must handle", () => {
    expect(specifiers).toContain("@ailx/core");
    expect(specifiers.some((s) => s.includes("/dist/"))).toBe(true);
  });

  it.each(specifiers)("%s resolves to a source file", (specifier) => {
    const aliased = applyAliases(specifier);
    expect(aliased, `${specifier} matches no alias in vitest.shared.ts`).toBeDefined();
    expect(aliased).not.toContain("/dist/");
    expect(resolvedFile(aliased as string), `${specifier} -> ${aliased}`).toBeDefined();
  });
});
