import { describe, expect, it } from "vitest";

import {
  API_QUERY_PARSERS,
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
  it("throws on a missing parameter instead of building /attempts/undefined/items", () => {
    expect(() => apiPath("attemptItems")).toThrow(/missing parameter "id"/);
    expect(() => apiPath("attemptItems", {})).toThrow(/missing parameter "id"/);
    expect(() => apiPath("attemptTrackView", { id: "a1" })).toThrow(/missing parameter "trackId"/);
  });

  it("treats an empty parameter as missing — an empty id is not an id", () => {
    expect(() => apiPath("attemptItems", { id: "" })).toThrow(/missing parameter "id"/);
  });

  it("throws on a parameter the route does not have, which is how a typo shows up", () => {
    expect(() => apiPath("attemptItems", { id: "a1", attemptId: "a2" })).toThrow(/no parameter "attemptId"/);
    expect(() => apiPath("gallery", { id: "a1" })).toThrow(/no parameter "id"/);
  });

  it("throws on an unknown route", () => {
    expect(() => apiPath("scoreAttempt" as ApiRouteKey)).toThrow(/unknown route: scoreAttempt/);
  });
});

describe("query-parser coupling", () => {
  it("names a parser that exists, and names one only where the route reads a query", () => {
    const named = entries.filter(([, r]) => r.query !== undefined);
    expect(named.map(([name]) => name).sort()).toEqual(["gallery", "moderationCases"]);
    for (const [, route] of named) {
      expect(typeof API_QUERY_PARSERS[route.query!]).toBe("function");
    }
  });

  it("is the SAME parser the package exports — one clamp, not a second copy", () => {
    expect(API_QUERY_PARSERS.gallery).toBe(parseGalleryQuery);
    expect(API_QUERY_PARSERS.case).toBe(parseCaseQuery);
  });

  it("normalizes through the named parser, so a hostile query is clamped once", () => {
    const gallery = API_QUERY_PARSERS[API_ROUTES.gallery.query] as typeof parseGalleryQuery;
    expect(gallery({ limit: "1000000000", sort: "sideways" })).toMatchObject({
      limit: GALLERY_MAX_PAGE_SIZE,
      sort: "recent",
    });
    const cases = API_QUERY_PARSERS[API_ROUTES.moderationCases.query] as typeof parseCaseQuery;
    expect(cases({ limit: "-4", lane: "sideways" })).toMatchObject({
      limit: 1,
      lane: "pending",
    });
    expect(CASE_MAX_PAGE_SIZE).toBeGreaterThan(0);
  });
});
