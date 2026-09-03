/**
 * `reliance.index` is AILX's own construct, and the spec promises it is never
 * used alone to rank, gate or z-score a candidate (AILX-Spec-2026.1.md, T3
 * "Stated against our own case"). No published work reports a signed index of
 * reliance calibration, so nothing outside this track may treat ours as a
 * score. The band already reads BOTH tails; the composite already reads the
 * track's scaled points, not this number.
 *
 * The promise was true when it was written and nothing enforced it. This file
 * does. It fails the moment a second module reads the index.
 *
 * SCOPE, stated plainly: it greps for the two spellings a consumer would
 * actually write, `reliance.index` and `relianceIndex`. It cannot see the
 * number arriving through a destructured `const { index } = reliance`, and it
 * says so here rather than pretending to be a taint tracker. The whole-object
 * `Reliance` is deliberately still exportable — reporting the tuple is the
 * literature-compatible form.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const SKIP = new Set([
  "node_modules", "dist", "out", ".git", ".next", "coverage", "test-results",
  "playwright-report", ".turbo",
]);

/** Where the index is allowed to be spelled at all. */
const OWNER = "packages/tracks/t3-reasoning/";

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

const sources = walk(repoRoot).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");
const MENTIONS = /reliance\.index|relianceIndex/i;

describe("the guard can see the repository", () => {
  it("walks a plausible tree, including the file it must ALLOW", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources).toContain("packages/tracks/t3-reasoning/src/scoring.ts");
    expect(sources).toContain("packages/session/src/scoring.ts");
    expect(sources).toContain("packages/report/src/insights.ts");
  });

  it("still finds the index where it is owned, so the pattern has not rotted", () => {
    expect(MENTIONS.test(read("packages/tracks/t3-reasoning/src/scoring.ts"))).toBe(true);
  });
});

describe("reliance.index is never consumed outside the T3 scorer", () => {
  it("is mentioned by no other module", () => {
    const strangers = sources.filter((f) => !f.startsWith(OWNER) && MENTIONS.test(read(f)));
    expect(
      strangers,
      "reliance.index is descriptive. Report both tails, or the band, or the track's points.",
    ).toEqual([]);
  });

  it("is absent from the composite, which z-scores tracks", () => {
    // The composite is the one place a stray reliance number would silently
    // become part of a rank. Named explicitly so a rename cannot skip it.
    expect(MENTIONS.test(read("packages/session/src/scoring.ts"))).toBe(false);
  });
});
