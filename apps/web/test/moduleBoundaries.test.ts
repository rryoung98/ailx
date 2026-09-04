/**
 * Module-boundary guards for apps/web.
 *
 * FRONTEND.md §3 states two rules about the shape of this app that nothing
 * checked: `features/` holds "one folder per product surface; no cross-feature
 * imports", and `components/` is what two or more surfaces share. Both held
 * when TEN-63 finished the move, and both are the kind of rule that decays in
 * one hurried import: a component that reaches into `features/report/` stops
 * being shared, and a feature that reaches into another feature's internals
 * stops being deletable with `rm -rf` plus one route.
 *
 * `lib/` is checked too, in the other direction. It is the non-visual layer,
 * and exactly two of its modules reach into `components/` (lib/README.md):
 * `auth/AuthNav.tsx` mounts Clerk's nav, and `instrument/registry.ts` falls
 * back to the placeholder Runner. Another one should be a decision, not a
 * diff.
 *
 * The guards read source text, not a bundler graph, so a dynamic
 * `import("...")` counts exactly like a static one.
 */

import { readFileSync } from "node:fs";
import { relative, resolve, dirname, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { browserSources, WEB_ROOT } from "./helpers/browserSources";

/** Every module specifier in a file: static, `export ... from`, dynamic, require. */
const SPEC = /(?:from\s*|import\s*\(\s*|require\(\s*)["'`]([^"'`]+)["'`]/g;

/**
 * The apps/web-relative path a specifier points at, or null when it leaves
 * the app (a package, a bare module). Extensions are irrelevant here: every
 * guard below only asks which directory the target lives in.
 */
function targetOf(file: string, spec: string): string | null {
  if (spec.startsWith("@/")) return spec.slice(2);
  if (!spec.startsWith(".")) return null;
  return relative(WEB_ROOT, resolve(dirname(file), spec));
}

interface Edge {
  from: string;
  to: string;
}

/** Every in-app import edge, as apps/web-relative paths. */
function edges(): Edge[] {
  const out: Edge[] = [];
  for (const file of browserSources()) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(SPEC)) {
      const to = targetOf(file, m[1]);
      if (to !== null && !to.startsWith("..")) out.push({ from: relative(WEB_ROOT, file), to });
    }
  }
  return out;
}

const ALL = edges();
const inDir = (p: string, dir: string): boolean => p.startsWith(dir + sep) || p.startsWith(dir + "/");
const surfaceOf = (p: string): string => p.split(/[\\/]/)[1];

describe("apps/web module boundaries (FRONTEND.md §3)", () => {
  it("sees the app it is meant to guard", () => {
    // A resolver that silently matches nothing would pass every test below.
    expect(ALL.length).toBeGreaterThan(100);
    expect(ALL.some((e) => inDir(e.from, "app") && inDir(e.to, "features"))).toBe(true);
  });

  it("nothing in components/ imports a feature", () => {
    const offenders = ALL.filter((e) => inDir(e.from, "components") && inDir(e.to, "features")).map(
      (e) => `${e.from} -> ${e.to}`,
    );
    expect(
      offenders,
      `components/ is what 2+ surfaces share, so it cannot depend on one: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no feature imports another feature", () => {
    const offenders = ALL.filter(
      (e) => inDir(e.from, "features") && inDir(e.to, "features") && surfaceOf(e.from) !== surfaceOf(e.to),
    ).map((e) => `${e.from} -> ${e.to}`);
    // There is no surface barrel to import THROUGH: the rule today is that a
    // feature shares by moving the module to components/ or lib/, not by
    // exporting one. Promote the shared file rather than adding an edge here.
    expect(
      offenders,
      `cross-feature imports break "delete a surface with rm -rf": ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("only two lib/ modules reach into components/", () => {
    // lib/README.md names three renders in `lib/`; the third,
    // QueryProvider.tsx, renders its own children and imports nothing from
    // components/ or features/, so it is not an edge this guard can see.
    const allowed = new Set([
      // lib/auth mounts Clerk and its nav (lib/README.md).
      `lib${sep}auth${sep}AuthNav.tsx`,
      // The registry falls back to the placeholder Runner (lib/README.md).
      `lib${sep}instrument${sep}registry.ts`,
    ]);
    const offenders = ALL.filter(
      (e) => inDir(e.from, "lib") && (inDir(e.to, "components") || inDir(e.to, "features")) && !allowed.has(e.from),
    ).map((e) => `${e.from} -> ${e.to}`);
    expect(
      offenders,
      `lib/ is the non-visual layer; another exception is a decision: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("nothing outside app/ imports out of app/", () => {
    // `app/` holds routing, so it is a leaf: a module that imports a page has
    // made a route an API. The one edge that existed was a CSS module parked
    // in `app/progress/` and read by `features/progress/`; it moved next to
    // its only caller (FRONTEND.md §3 rule 6).
    const offenders = ALL.filter((e) => !inDir(e.from, "app") && inDir(e.to, "app")).map(
      (e) => `${e.from} -> ${e.to}`,
    );
    expect(offenders, offenders.join(", ")).toEqual([]);
  });
});
