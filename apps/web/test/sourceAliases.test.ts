// @vitest-environment node
/**
 * The apps/web suite must measure THIS TREE, not the last build.
 *
 * Every `@ailx/*` package resolves through node_modules to a symlink of the
 * package directory, whose `main` is `dist/`. Unaliased, a test run therefore
 * measures whatever was last built — and that already produced a false green:
 * a mutation to a package `src` survived because nothing ever loaded the
 * mutated file. `vitest.config.ts` aliases each package to its SOURCE entry.
 * This file fails if that stops being true, in the two ways it can stop:
 * at RUNTIME for the specifiers this app actually imports, and STATICALLY for
 * a package that gains a dependency, a subpath, or a moved source directory.
 *
 * The Next builds are deliberately untouched by the alias — they consume
 * `dist/`, as a published build should — so there is nothing to assert here
 * about them beyond `next.config.mjs` never reading this config.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core/dist/purity.js";
import { calibrationBins } from "@ailx/report";
import config from "../vitest.config";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Where a thrown error says the package code that threw it lives. */
function throwSite(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).stack ?? "";
  }
  throw new Error("expected the call to throw");
}

describe("packages load from src at runtime", () => {
  // A BARE specifier: `@ailx/report` -> packages/report/src/index.ts.
  it("a bare `@ailx/*` import runs the source file", () => {
    const stack = throwSite(() => calibrationBins([], {}, 0));
    expect(stack).toContain("/packages/report/src/calibration.ts");
    // Only WORKSPACE frames are the claim here — vitest's own frames live in
    // a node_modules `dist/` and always will.
    expect(stack).not.toMatch(/\/packages\/[^\n]*\/dist\//);
  });

  // A SUBPATH: `lib/validateChecks.ts` really imports `@ailx/core/dist/purity.js`,
  // and a string alias would have rewritten it to `.../src/index.ts/dist/purity.js`.
  it("a `dist/`-spelled subpath import runs the source file", () => {
    const stack = throwSite(() => runPure(() => Date.now()));
    expect(stack).toContain("/packages/core/src/purity.ts");
    expect(stack).not.toMatch(/\/packages\/[^\n]*\/dist\//);
  });
});

/** The alias table as vite will apply it: first matching entry wins. */
const aliases = (Array.isArray(config.resolve?.alias) ? config.resolve.alias : []) as Array<{
  find: RegExp | string;
  replacement: string;
}>;

function resolveAlias(specifier: string): string | null {
  for (const { find, replacement } of aliases) {
    if (typeof find === "string") {
      if (specifier === find || specifier.startsWith(`${find}/`)) {
        return specifier.replace(find, replacement);
      }
    } else if (find.test(specifier)) {
      return specifier.replace(find, replacement);
    }
  }
  return null;
}

/** What vite would load for an extensionless alias target. */
function resolvedFile(target: string): string | null {
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, join(target, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every `@ailx/*` specifier this app IMPORTS, from app/, lib/ and test/.
 *
 * Only import positions count: `from "..."`, a bare side-effect `import "..."`,
 * a dynamic `import("...")` and `require("...")`. A plain quoted string is NOT
 * one — `test/scoringDigest.test.ts` asserts on the audit digest's
 * package-qualified path `"@ailx/core/src/rounding.ts"`, which no resolver
 * ever sees and which no alias should have to explain.
 */
const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'](@ailx\/[^"']+)["']/g;

function ailxSpecifiers(): string[] {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(entry.name)) {
        for (const m of readFileSync(child, "utf8").matchAll(IMPORT_SPECIFIER)) {
          found.add(m[1]!);
        }
      }
    }
  };
  // e2e/ is Playwright's and never runs under this config.
  for (const dir of ["app", "lib", "test"]) walk(join(webRoot, dir));
  return [...found].sort();
}

describe("the alias table covers what this app imports", () => {
  const specifiers = ailxSpecifiers();

  it("sees a plausible set of specifiers, including the awkward subpath", () => {
    expect(specifiers.length).toBeGreaterThan(5);
    expect(specifiers).toContain("@ailx/core/dist/purity.js");
  });

  it.each(specifiers)("%s resolves to a real file under src/", (specifier) => {
    const target = resolveAlias(specifier);
    expect(target, `${specifier} has no alias — add its package to vitest.config.ts`).not.toBeNull();
    const file = resolvedFile(target!);
    expect(file, `${specifier} aliases to ${target}, which is not a file`).not.toBeNull();
    const rel = relative(repoRoot, file!).split(/[\\/]/).join("/");
    expect(rel).toMatch(/\/src\//);
    expect(rel).not.toMatch(/\/dist\//);
  });

  it("aliases every workspace `@ailx/*` dependency, imported today or not", () => {
    const pkg = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const workspaceDeps = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@ailx/"));
    expect(workspaceDeps.length).toBeGreaterThan(0);
    for (const dep of workspaceDeps) {
      expect(resolvedFile(resolveAlias(dep) ?? ""), `${dep} is a dependency with no src alias`).not.toBeNull();
    }
  });

  it("leaves non-@ailx specifiers alone", () => {
    for (const untouched of ["react", "next/navigation", "@ailxfoo/bar", "vitest"]) {
      expect(resolveAlias(untouched)).toBeNull();
    }
  });
});

describe("the alias belongs to vitest only", () => {
  it("next.config.mjs does not read vitest.config.ts", () => {
    expect(readFileSync(join(webRoot, "next.config.mjs"), "utf8")).not.toContain("vitest.config");
  });
});
