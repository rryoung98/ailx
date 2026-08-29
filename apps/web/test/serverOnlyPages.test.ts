/**
 * The static-export boundary, checked as a repo rule rather than a habit.
 *
 * `next.config.mjs` only adds `api.ts`/`api.tsx` to `pageExtensions` in the
 * AILX_BACKEND=1 build, so ANY file under app/ that reaches server capability
 * (pg, the DB context, node fs) must be named `route.api.ts` or
 * `page.api.tsx`. A `page.tsx` that imports lib/server would be compiled into
 * the GitHub Pages export, where it can only fail.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const APP = fileURLToPath(new URL("../app", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(APP).map((path) => ({
  path,
  rel: path.slice(APP.length + 1),
  source: readFileSync(path, "utf8"),
}));

const SERVER_ONLY = /from "[^"]*lib\/server\/|from "pg"|from "node:/;

describe("server-only files carry a server-only extension", () => {
  it("finds the app router files at all (guards against a silent glob bug)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("nothing under app/ reaches server capability without .api.ts / .api.tsx", () => {
    const offenders = files
      .filter((f) => SERVER_ONLY.test(f.source))
      .filter((f) => !/\.api\.tsx?$/.test(f.rel))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("no server-only file is marked \"use client\"", () => {
    const offenders = files
      .filter((f) => /\.api\.tsx?$/.test(f.rel))
      .filter((f) => f.source.trimStart().startsWith('"use client"'))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the share view and its routes are all server-only by name", () => {
    const shareFiles = files.filter((f) => f.rel.includes("share") || f.rel.startsWith("s/"));
    expect(shareFiles.length).toBeGreaterThanOrEqual(3);
    for (const f of shareFiles) expect(f.rel, f.rel).toMatch(/\.api\.tsx?$/);
  });
});
