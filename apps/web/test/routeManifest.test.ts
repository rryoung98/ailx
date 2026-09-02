/**
 * No hand-spelled service URL in `apps/web`. `@ailx/contract`'s route manifest
 * holds every path a browser may call, and this test stops a second copy
 * appearing (`packages/contract/src/routes.ts`, file header).
 *
 * The rule, exactly. In a call that builds or issues a request (`fetch`, a
 * `fetchFn`, `serviceFetch`/`useService`, an HTTP verb method such as
 * Playwright's `request.post`, or `new URL`), no argument may contain a string
 * literal or template chunk that starts with `/` and a first segment the
 * manifest uses. The check parses TypeScript, so the shape of the call does
 * not matter. A literal outside such a call passes, because
 * `<Link href="/gallery">` and `router.push("/gallery")` are frontend pages.
 *
 * One gap, stated so it cannot be mistaken for coverage. The check does not
 * resolve identifiers, so a path parked in a variable first
 * (`const url = "/attempts"; fetch(url)`) goes through. Resolving that needs a
 * type checker over the whole project, and the test below pins the gap so a
 * reader is not told the guard is wider than it is.
 *
 * `offences()` is fed each shape it exists to catch, so a regression in the
 * detector fails here instead of going quiet.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { API_ROUTES, apiPath } from "@ailx/contract";

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

/** First segment of every manifest path: "attempts", "gallery", "practice", … */
const SEGMENTS = [
  ...new Set(Object.values(API_ROUTES).map((r) => r.path.split("/")[1])),
].sort();

/**
 * A literal that starts a service path, with or without a versioned root:
 * `/attempts/…`, `/api/attempts/…`, `/v1/attempts/…`.
 */
const SERVICE_PATH_RE = new RegExp(`^(?:/api|/v1)?/(?:${SEGMENTS.join("|")})(?:$|[/?])`);

/** Names whose call arguments are request URLs. */
const REQUEST_CALLEES = new Set([
  "fetch",
  "fetchFn",
  "serviceFetch",
  "useService",
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
]);

function calleeName(node: ts.CallExpression): string | undefined {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) return callee.name.text;
  return undefined;
}

/** Every literal chunk in a subtree: a string, a whole template, a template span. */
function literals(node: ts.Node, out: string[] = []): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) out.push(span.literal.text);
  }
  // A truthy return stops `forEachChild`, and `out` is always truthy.
  node.forEachChild((child) => {
    literals(child, out);
  });
  return out;
}

/** Every rule this source breaks. Empty means the module goes through apiPath(). */
function offences(src: string): string[] {
  const file = ts.createSourceFile("in.tsx", src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const isRequest =
      (ts.isCallExpression(node) && REQUEST_CALLEES.has(calleeName(node) ?? "")) ||
      (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL");
    if (isRequest) {
      for (const arg of node.arguments ?? []) {
        for (const text of literals(arg)) {
          if (SERVICE_PATH_RE.test(text)) found.push(`a request built from the literal path "${text}"`);
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(file);
  return [...new Set(found)];
}

describe("the detector catches what it exists to catch", () => {
  it("flags a literal path whatever the call shape", () => {
    expect(offences('const r = await fetch(`${apiBase()}/gallery/review`, {});')).toEqual([
      'a request built from the literal path "/gallery/review"',
    ]);
    expect(offences('await fetch(apiBase() + "/progress");')).toEqual([
      'a request built from the literal path "/progress"',
    ]);
    expect(offences('await fetch(new URL("/progress", apiBase()));')).toEqual([
      'a request built from the literal path "/progress"',
    ]);
    expect(offences('await request.post("/attempts", { data });')).toEqual([
      'a request built from the literal path "/attempts"',
    ]);
    expect(offences("await opts.fetchFn(`${opts.baseUrl}/attempts/${id}/share`);")).toEqual([
      'a request built from the literal path "/attempts/"',
      'a request built from the literal path "/share"',
    ]);
    expect(offences('useService<{ progress: Report }>("/progress");')).toEqual([
      'a request built from the literal path "/progress"',
    ]);
    expect(offences('await serviceFetch(`/share/${token}`);')).toEqual([
      'a request built from the literal path "/share/"',
    ]);
    expect(offences('await fetch(`${apiRoot()}/practice?seq=1`);')).toEqual([
      'a request built from the literal path "/practice?seq=1"',
    ]);
    // The root is `apiBase()`'s to spell, so a rooted literal is one too.
    expect(offences('await fetch("/api/attempts/" + id);')).toEqual([
      'a request built from the literal path "/api/attempts/"',
    ]);
  });

  it("passes the manifest-built forms the frontend now uses", () => {
    expect(offences('await fetch(`${apiBase()}${apiPath("reviewDecision")}`, {});')).toEqual([]);
    expect(offences('useService<{ gallery: G }>(apiPath("gallery", {}, query));')).toEqual([]);
    expect(offences('await serviceFetch(apiPath("shareView", { token }));')).toEqual([]);
    expect(offences('await fetch(apiBase() + apiPath("progress"));')).toEqual([]);
  });

  it("ignores what is not a request: a comment, a page link, a page navigation", () => {
    expect(offences('/** Reads `${apiBase()}/gallery` over HTTP. */ const x = 1;')).toEqual([]);
    expect(offences('// await fetch(`${apiBase()}/practice`)')).toEqual([]);
    expect(offences('const a = <Link href="/gallery">the wall</Link>;')).toEqual([]);
    expect(offences('router.push("/gallery");')).toEqual([]);
    expect(offences('const paths = ["/attempts"];')).toEqual([]);
  });

  it("does not see a path parked in a variable first — the known gap", () => {
    expect(offences('const url = `${apiBase()}/attempts`; await fetch(url);')).toEqual([]);
  });

  it("does not flag a frontend page path that is not a manifest segment", () => {
    expect(offences('await fetch("/verify/abc");')).toEqual([]);
    expect(offences('await fetch("/characters/eight.png");')).toEqual([]);
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

/**
 * `apiPath()`'s parameters are typed from the path template. The proof lives
 * here because `apps/web` is the project whose tests `next build` typechecks;
 * an unused `@ts-expect-error` below fails that build.
 */
describe("apiPath takes exactly the parameters its route declares", () => {
  it("compiles the right call and refuses the wrong ones", () => {
    expect(apiPath("attemptItems", { id: "a1" })).toBe("/attempts/a1/items");
    expect(apiPath("gallery")).toBe("/gallery");
    // @ts-expect-error attemptItems declares :id
    expect(() => apiPath("attemptItems")).toThrow(/missing parameter "id"/);
    // @ts-expect-error attemptTrackView declares :id and :trackId
    expect(() => apiPath("attemptTrackView", { id: "a1" })).toThrow(/missing parameter "trackId"/);
    // @ts-expect-error gallery declares no parameter
    expect(() => apiPath("gallery", { id: "a1" })).toThrow(/no parameter "id"/);
  });
});

describe("apps/web spells no service URL by hand", () => {
  // The whole app, tests and Playwright fixtures included: the fixtures seed
  // through the same routes, and a renamed route that only they spell would go
  // green here and red on a machine that has a service to talk to.
  const files = sources(webDir);

  it("reads the frontend it is guarding", () => {
    expect(files.length).toBeGreaterThan(50);
    const rel = files.map((f) => relative(webDir, f));
    expect(rel).toContain(join("lib", "data", "serviceFetch.ts"));
    expect(rel).toContain(join("e2e", "fixtures.ts"));
    expect(rel).toContain(join("test", "routeManifest.test.ts"));
  });

  it("has no offender", () => {
    const offenders = files
      .map((f) => ({ file: relative(webDir, f), broke: offences(readFileSync(f, "utf8")) }))
      .filter((r) => r.broke.length > 0);
    expect(offenders, `build these from apiPath(): ${JSON.stringify(offenders)}`).toEqual([]);
  });
});
