/**
 * NO HAND-SPELLED SERVICE URL.
 *
 * A browser once called `POST /attempts/:id/score` on a deployed service that
 * did not have it, because the path was a string in a component and nothing
 * compiled both sides (`packages/core/test/frontendOnly.test.ts`, file
 * header). `@ailx/contract`'s route manifest now holds every one of those
 * paths, and this test is what stops a second copy appearing: `apps/web` may
 * build a service URL from `apiPath()` and from nothing else.
 *
 * The detector is checked BOTH WAYS. A guard nobody can make fail is a guard
 * that has already rotted, so `offences()` is fed the exact patterns it exists
 * to catch and must report them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { API_ROUTES } from "@ailx/contract";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "out" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Prose ABOUT a route is not a call to one — the same rule the purity guard uses. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** First segment of every manifest path: "attempts", "gallery", "practice", … */
const SEGMENTS = [
  ...new Set(Object.values(API_ROUTES).map((r) => r.path.split("/")[1])),
].sort();

const PATTERNS: readonly { readonly what: string; readonly re: RegExp }[] = [
  {
    what: "a fetch with a literal service path",
    re: new RegExp(`fetch(?:Fn)?\\(\\s*[\`"'][^\`"'\\n]*\\/(?:${SEGMENTS.join("|")})\\b`),
  },
  {
    what: "an API root followed by a literal path",
    re: new RegExp(`\\$\\{[^}]*(?:apiBase\\(\\)|[bB]aseUrl)[^}]*\\}\\/(?:${SEGMENTS.join("|")})\\b`),
  },
  {
    what: "serviceFetch/useService given a string instead of an ApiPath",
    re: /(?:serviceFetch|useService)\s*(?:<[^>]*>)?\(\s*[`"']/,
  },
];

/** Every rule this source breaks. Empty means the module goes through apiPath(). */
function offences(src: string): string[] {
  const text = code(src);
  return PATTERNS.filter(({ re }) => re.test(text)).map(({ what }) => what);
}

describe("the detector catches what it exists to catch", () => {
  it("flags the three ways a path used to be spelled by hand", () => {
    expect(offences('const r = await fetch(`${apiBase()}/gallery/review`, {});')).toEqual([
      "a fetch with a literal service path",
      "an API root followed by a literal path",
    ]);
    expect(offences("await opts.fetchFn(`${opts.baseUrl}/attempts/${id}/share`);")).toEqual([
      "a fetch with a literal service path",
      "an API root followed by a literal path",
    ]);
    expect(offences('useService<{ progress: Report }>("/progress");')).toEqual([
      "serviceFetch/useService given a string instead of an ApiPath",
    ]);
    expect(offences('await serviceFetch(`/share/${token}`);')).toEqual([
      "serviceFetch/useService given a string instead of an ApiPath",
    ]);
  });

  it("passes the manifest-built forms the frontend now uses", () => {
    expect(offences('await fetch(`${apiBase()}${apiPath("reviewDecision")}`, {});')).toEqual([]);
    expect(offences('useService<{ gallery: G }>(apiPath("gallery", {}, query));')).toEqual([]);
    expect(offences('await serviceFetch(apiPath("shareView", { token }));')).toEqual([]);
  });

  it("ignores a comment and a page link — neither is a service call", () => {
    expect(offences('/** Reads `${apiBase()}/gallery` over HTTP. */')).toEqual([]);
    expect(offences('// await fetch(`${apiBase()}/practice`)')).toEqual([]);
    expect(offences('<Link href="/gallery">the wall</Link>')).toEqual([]);
  });

  it("derives its segments from the manifest, not from a second list", () => {
    expect(SEGMENTS).toContain("attempts");
    expect(SEGMENTS).toContain("moderation");
    expect(SEGMENTS.length).toBeGreaterThan(5);
    // The frontend's own pages ("/s/…", "/verify/…") are not service routes
    // and must not be swept in, or the guard would flag every nav link.
    expect(SEGMENTS).not.toContain("s");
    expect(SEGMENTS).not.toContain("verify");
  });
});

describe("apps/web spells no service URL by hand", () => {
  const files = sources(join(webDir, "lib")).concat(sources(join(webDir, "app")));

  it("reads the frontend it is guarding", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => relative(webDir, f))).toContain(join("lib", "serviceFetch.ts"));
  });

  it("has no offender", () => {
    const offenders = files
      .map((f) => ({ file: relative(webDir, f), broke: offences(readFileSync(f, "utf8")) }))
      .filter((r) => r.broke.length > 0);
    expect(offenders, `build these from apiPath(): ${JSON.stringify(offenders)}`).toEqual([]);
  });
});
