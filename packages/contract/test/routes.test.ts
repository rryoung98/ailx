import { describe, expect, it } from "vitest";

import { API_QUERY_PARSERS, API_RESPONSE_SCHEMAS } from "../src/tables.js";
import {
  API_ROUTES,
  type ApiRoute,
  type ApiRouteKey,
  apiPath,
} from "../src/routes.js";
import { GALLERY_MAX_PAGE_SIZE, parseGalleryQuery } from "../src/gallery.js";
import { CASE_MAX_PAGE_SIZE, parseCaseQuery } from "../src/moderation.js";

/**
 * THE ROUTE MANIFEST.
 *
 * The table is the only place a service URL is spelled, so what it says has to
 * be true and what it refuses has to be refused. `apps/web/test/routeManifest
 * .test.ts` holds the other half: no module in the frontend may spell one of
 * these paths by hand.
 */

const entries = Object.entries(API_ROUTES) as [ApiRouteKey, ApiRoute][];

describe("the table itself", () => {
  it("declares a method, a rooted path and a response name for every route", () => {
    expect(entries.length).toBeGreaterThan(30);
    for (const [name, route] of entries) {
      expect({ name, ok: ["GET", "POST", "DELETE"].includes(route.method) }).toEqual({ name, ok: true });
      // Below the versioned root, never including it: `apiBase()` owns the
      // "/api" vs "<origin>/v1" difference and no entry may re-decide it.
      expect({ name, path: route.path.startsWith("/") }).toEqual({ name, path: true });
      expect({ name, versioned: /^\/(v1|api)\//.test(route.path) }).toEqual({ name, versioned: false });
      expect({ name, response: route.response.length > 0 }).toEqual({ name, response: true });
      expect({ name, query: route.path.includes("?") }).toEqual({ name, query: false });
    }
  });

  it("has no duplicate method+path pair", () => {
    const seen = entries.map(([, r]) => `${r.method} ${r.path}`);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("apiPath — substitution", () => {
  it("returns a parameterless path unchanged", () => {
    expect(apiPath("gallery")).toBe("/gallery");
    expect(apiPath("progress")).toBe("/progress");
    expect(apiPath("startPractice")).toBe("/practice");
  });

  it("substitutes every parameter, including two in one path", () => {
    expect(apiPath("attemptItems", { id: "a1" })).toBe("/attempts/a1/items");
    expect(apiPath("attemptTrackView", { id: "a1", trackId: "t3" })).toBe("/attempts/a1/track/t3");
  });

  it("percent-encodes a parameter, so a hostile id cannot climb the path", () => {
    expect(apiPath("shareView", { token: "a/../b" })).toBe("/share/a%2F..%2Fb");
    expect(apiPath("credentialView", { code: "a b?c=1" })).toBe("/credentials/a%20b%3Fc%3D1");
    expect(apiPath("moderationCase", { id: "../gallery" })).toBe("/moderation/..%2Fgallery");
  });

  it("appends a query string verbatim, and refuses one that is not a query", () => {
    expect(apiPath("gallery", {}, "?sort=oldest&limit=5")).toBe("/gallery?sort=oldest&limit=5");
    expect(apiPath("gallery", {}, "")).toBe("/gallery");
    expect(() => apiPath("gallery", {}, "sort=oldest")).toThrow(/must start with/);
  });
});

describe("apiPath — refusals", () => {
  // The signature refuses a missing or extra parameter at compile time
  // (apps/web/test/routeManifest.test.ts proves that, where tests are
  // typechecked). These calls go through an untyped view of the same function,
  // because a value can still arrive from JSON, an `any` or a cast.
  const untyped = apiPath as unknown as (
    key: string,
    params?: Readonly<Record<string, string>>,
    query?: string,
  ) => string;

  it("throws on a missing parameter instead of building /attempts/undefined/items", () => {
    expect(() => untyped("attemptItems")).toThrow(/missing parameter "id"/);
    expect(() => untyped("attemptItems", {})).toThrow(/missing parameter "id"/);
    expect(() => untyped("attemptTrackView", { id: "a1" })).toThrow(/missing parameter "trackId"/);
  });

  it("treats an empty parameter as missing — an empty id is not an id", () => {
    expect(() => apiPath("attemptItems", { id: "" })).toThrow(/missing parameter "id"/);
  });

  it("throws on a parameter the route does not have, which is how a typo shows up", () => {
    expect(() => untyped("attemptItems", { id: "a1", attemptId: "a2" })).toThrow(/no parameter "attemptId"/);
    expect(() => untyped("gallery", { id: "a1" })).toThrow(/no parameter "id"/);
  });

  it("throws on an unknown route", () => {
    expect(() => untyped("scoreAttempt")).toThrow(/unknown route: scoreAttempt/);
  });
});


describe("response-schema coupling", () => {
  it("keys every schema by a route that exists", () => {
    for (const key of Object.keys(API_RESPONSE_SCHEMAS)) {
      expect(Object.keys(API_ROUTES)).toContain(key);
    }
  });

  it("validates the body the route's `response` line names", () => {
    expect(API_ROUTES.gallery.response).toBe("{ gallery: GalleryListing }");
    const parsed = API_RESPONSE_SCHEMAS.gallery.safeParse({
      gallery: { entries: [], total: 0, facets: [], query: parsedQuery() },
    });
    expect(parsed.success).toBe(true);
    // The envelope is checked too: a bare listing is not this route's body.
    expect(API_RESPONSE_SCHEMAS.gallery.safeParse({ entries: [], total: 0, facets: [], query: parsedQuery() }).success).toBe(false);
  });

  it("covers one route of the manifest, and says so rather than implying more", () => {
    expect(Object.keys(API_RESPONSE_SCHEMAS)).toEqual(["gallery"]);
    expect(Object.keys(API_ROUTES).length).toBeGreaterThan(30);
  });
});

/** The default query, through the parser, so no test hand-spells the shape. */
function parsedQuery() {
  const result = parseGalleryQuery();
  if (!result.ok) throw new Error(result.message);
  return result.query;
}

describe("query-parser coupling", () => {
  it("names a parser that exists, for the two routes a shared parser covers", () => {
    const named = entries.filter(([, r]) => r.queryParser !== undefined);
    expect(named.map(([name]) => name).sort()).toEqual(["gallery", "moderationCases"]);
    for (const [, route] of named) {
      expect(typeof API_QUERY_PARSERS[route.queryParser!]).toBe("function");
    }
  });

  it("does not claim these are the only routes that take a query", () => {
    // `uploadSite` is called with `?seq=` (apps/web/lib/siteUpload.ts), through
    // apiPath()'s third argument. No shared parser owns it: only the service
    // reads it. `queryParser` names a clamp both sides must agree on, and the
    // field name is the whole claim.
    expect(API_ROUTES.uploadSite.queryParser).toBeUndefined();
    expect(apiPath("uploadSite", { id: "a1" }, "?seq=3")).toBe("/attempts/a1/site?seq=3");
  });

  it("is the SAME parser the package exports — one clamp, not a second copy", () => {
    expect(API_QUERY_PARSERS.gallery).toBe(parseGalleryQuery);
    expect(API_QUERY_PARSERS.case).toBe(parseCaseQuery);
  });

  it("goes through the named parser, so a hostile query is judged once", () => {
    // The two parsers no longer answer the same way, and that is the open
    // half of this work: `gallery` REFUSES what `case` still clamps
    // (docs/ADR-zod-tanstack.md §4). One seam was converted, not both.
    const gallery = API_QUERY_PARSERS[API_ROUTES.gallery.queryParser] as typeof parseGalleryQuery;
    expect(gallery({ limit: "1000000000", sort: "sideways" }).ok).toBe(false);
    expect(gallery({ limit: String(GALLERY_MAX_PAGE_SIZE) })).toMatchObject({
      ok: true,
      query: { limit: GALLERY_MAX_PAGE_SIZE, sort: "recent" },
    });
    const cases = API_QUERY_PARSERS[API_ROUTES.moderationCases.queryParser] as typeof parseCaseQuery;
    expect(cases({ limit: "-4", lane: "sideways" })).toMatchObject({
      limit: 1,
      lane: "pending",
    });
    expect(CASE_MAX_PAGE_SIZE).toBeGreaterThan(0);
  });
});
