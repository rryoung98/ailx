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

  it("every page that reads the store is server-only by name", () => {
    // The gallery, its reviewer queue, the world aggregates and one person's
    // progress all read the database; in the static export none of them may
    // exist at all.
    for (const route of ["gallery", "world", "review", "progress", "verify/[code]"]) {
      const pages = files.filter((f) => f.rel.startsWith(`${route}/page`));
      expect(pages.map((f) => f.rel), route).toEqual([`${route}/page.api.tsx`]);
    }
  });

  it("the practice drill's own page is NOT server-only — it plays in both builds", () => {
    // Its corpus is bundled and its API calls are made from the client, so
    // /practice must exist in the export. A page.api.tsx here would delete
    // the drill from the demo, which is the surface that sells the loop.
    const pages = files.filter((f) => f.rel.startsWith("practice/page"));
    expect(pages.map((f) => f.rel)).toEqual(["practice/page.tsx"]);
    expect(pages[0].source).not.toMatch(SERVER_ONLY);
  });

  it("the practice API is server-only by name, on both of its routes", () => {
    const routes = files.filter((f) => f.rel.startsWith("api/practice/"));
    expect(routes.length).toBe(2);
    for (const f of routes) expect(f.rel, f.rel).toMatch(/route\.api\.ts$/);
  });

  it("no route has both a static and a server-only page (duplicate route)", () => {
    const pages = files.filter((f) => /(^|\/)page\.(api\.)?tsx$/.test(f.rel));
    const byDir = new Map<string, string[]>();
    for (const f of pages) {
      const dir = f.rel.split("/").slice(0, -1).join("/");
      byDir.set(dir, [...(byDir.get(dir) ?? []), f.rel]);
    }
    const clashes = [...byDir.values()].filter((v) => v.length > 1);
    expect(clashes).toEqual([]);
  });

  it("the whole moderation surface is server-only by name", () => {
    // The dashboard, the case page and both moderation API twins read the
    // store and enforce the reviewer gate; in the static Pages export none of
    // them may exist at all, so a "moderation" file with a static extension
    // is a build failure rather than a review comment.
    const mod = files.filter((f) => f.rel.startsWith("review/") || f.rel.includes("moderation"));
    expect(mod.length).toBeGreaterThanOrEqual(4);
    for (const f of mod) expect(f.rel, f.rel).toMatch(/\.api\.tsx?$/);
    expect(mod.map((f) => f.rel).sort()).toContain("review/[id]/page.api.tsx");
  });

  it("the credential surface is server-only by name, page and both routes", () => {
    // /verify reads the store, and both credential routes reach the DB. In
    // the static Pages export none of them may exist: a credential that
    // cannot be verified live is worse than no credential.
    const credential = files.filter(
      (f) => f.rel.startsWith("verify/") || f.rel.includes("credential"),
    );
    expect(credential.length).toBeGreaterThanOrEqual(3);
    for (const f of credential) expect(f.rel, f.rel).toMatch(/\.api\.tsx?$/);
    expect(credential.map((f) => f.rel).sort()).toEqual([
      "api/attempts/[id]/credential/route.api.ts",
      "api/credentials/[code]/route.api.ts",
      "verify/[code]/page.api.tsx",
    ]);
  });

  it("the share view and its routes are all server-only by name", () => {
    const shareFiles = files.filter((f) => f.rel.includes("share") || f.rel.startsWith("s/"));
    expect(shareFiles.length).toBeGreaterThanOrEqual(3);
    for (const f of shareFiles) expect(f.rel, f.rel).toMatch(/\.api\.tsx?$/);
  });
});
