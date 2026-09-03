/**
 * The reliance component names may not drift back — TEN-72.
 *
 * These two components have been renamed twice in three days and both renames
 * were the same mistake in a different direction. `rsr`/`rair` claimed
 * Schemmer et al.'s published statistics, which T3 does not compute (TEN-38).
 * `overReliance`/`underReliance` named the failure while the value holds the
 * CREDIT for avoiding it, so a candidate who caught every planted error
 * scored 50 out of 50 on a field called `overReliance` (TEN-72).
 *
 * The current names say what the candidate did: `errorCatchRate` and
 * `adviceUptakeRate`. This file fails if a dead spelling comes back into
 * shipped code or into the spec, because a name that drifts from its meaning
 * is exactly the defect being fixed, and it drifted back once already.
 *
 * WHAT IT READS. Every `.ts`/`.tsx` under a `src/` directory, plus the
 * frontend's non-test source, with comments stripped: the rename HISTORY is
 * worth keeping in a comment and quoting a dead name there is how it is kept.
 * Tests are out of scope for the same reason — `reliance.test.ts` feeds a
 * dead key in on purpose to prove it is ignored. The spec is read whole, and
 * a line may quote a dead name only while it names the ticket that killed it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** The spellings that must never come back, as whole words. */
const DEAD = ["overReliance", "underReliance", "OVER_RELIANCE", "UNDER_RELIANCE", "rsr", "rair"];
const DEAD_RE = new RegExp(`\\b(${DEAD.join("|")})\\b`);

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".git", ".vercel", "coverage", "test", "e2e", "__tests__"]);

/** Source roots a browser or a scorer actually ships. */
const SOURCE_ROOTS = [
  "packages", "services",
  "apps/web/lib", "apps/web/app", "apps/web/features", "apps/web/components", "apps/web/scripts",
];

function walk(dir: string, out: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(e)) walk(p, out);
    } else if (/\.(ts|tsx|mjs)$/.test(e) && !/\.test\.tsx?$/.test(e)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * The file with its comments blanked, line count preserved.
 *
 * String and template literals are tracked, so a `//` inside a URL literal
 * cannot hide the rest of the line from the check.
 *
 * Not exported: a test file that exports a helper reads as a module other
 * tests may import, and the lint says so. Its own cases sit below it.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  type Mode = "code" | "line" | "block" | "'" | '"' | "`";
  let mode: Mode = "code";
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && next === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") mode = c;
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; i++; continue; }
      out += " "; i++; continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") { mode = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? c : " "; i++; continue;
    }
    // inside a string or template literal
    if (c === "\\") { out += "  "; i += 2; continue; }
    if (c === mode) mode = "code";
    out += c; i++;
  }
  return out;
}

describe("the T3 reliance component names cannot drift back", () => {
  const files = SOURCE_ROOTS.flatMap((r) => walk(join(ROOT, r), []));

  it("reads a source tree that exists", () => {
    // A silent zero would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith("allocation.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("scoring.ts"))).toBe(true);
  });

  it("has no dead spelling in shipped code", () => {
    const hits: string[] = [];
    for (const f of files) {
      stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, n) => {
        if (DEAD_RE.test(line)) hits.push(`${f.slice(ROOT.length)}:${n + 1}: ${line.trim()}`);
      });
    }
    expect(hits, "use errorCatchRate / adviceUptakeRate").toEqual([]);
  });

  it("quotes a dead spelling in the spec only where the rename is recorded", () => {
    const spec = readFileSync(join(ROOT, "AILX-Spec-2026.1.md"), "utf8");
    const hits = spec
      .split("\n")
      .map((line, n) => ({ line, n: n + 1 }))
      // RSR and RAIR are real published statistics and the spec cites them by
      // name; only the code spellings are dead.
      .filter(({ line }) => /\b(overReliance|underReliance|OVER_RELIANCE)\b/.test(line))
      .filter(({ line }) => !/TEN-38|TEN-72/.test(line));
    expect(hits.map((h) => h.n), "name the ticket or use the new spelling").toEqual([]);
  });

  it("names both new spellings where they are declared", () => {
    const alloc = readFileSync(join(ROOT, "packages/core/src/allocation.ts"), "utf8");
    expect(alloc).toContain('key: "errorCatchRate"');
    expect(alloc).toContain('key: "adviceUptakeRate"');
  });

  it("blanks comments without blanking a string that looks like one", () => {
    expect(stripComments('const a = "https://x/y"; // overReliance')).toContain("https://x/y");
    expect(stripComments('const a = "https://x/y"; // overReliance')).not.toContain("overReliance");
    expect(stripComments("/* overReliance */ const b = 1;")).toContain("const b = 1;");
    expect(stripComments("/* overReliance */ const b = 1;")).not.toContain("overReliance");
    expect(stripComments('const c = "overReliance";')).toContain("overReliance");
    // Assembled, not written literally: a `${` inside a source string is
    // itself a lint finding, and the case is about the SCANNER, not the text.
    const tpl = ["const d = `a ", "${", "x} // b`;", "\nconst e = 2;"].join("");
    expect(stripComments(tpl)).toContain("const e = 2;");
    // A line comment ends at the newline, and the next line is still code.
    expect(stripComments("// overReliance\nconst f = 3;")).toContain("const f = 3;");
  });
});
