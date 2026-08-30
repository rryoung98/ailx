import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import vitestProjects from "../../../vitest-workspace.ts";

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
