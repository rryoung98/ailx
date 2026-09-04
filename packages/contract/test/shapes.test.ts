import { describe, expect, it } from "vitest";
import { ALL_SHARE_SECTIONS, sharePayloadFrom } from "@ailx/report";

import { FORBIDDEN_RESULT, UNAUTHORIZED_RESULT, parseApiError } from "../src/api.js";
import {
  GALLERY_MAX_PAGE_SIZE,
  GALLERY_PAGE_SIZE,
  PLAYER_TYPE_CODE_RE,
  galleryEntrySchema,
  galleryListingSchema,
  galleryQueryString,
  parseGalleryQuery,
  publicEntry,
  type GalleryEntry,
} from "../src/gallery.js";
import {
  CASE_MAX_PAGE_SIZE,
  CASE_PAGE_SIZE,
  COMMENT_BODY_MAX,
  candidateMayReply,
  normalizeCommentBody,
  parseCaseQuery,
} from "../src/moderation.js";
import { needsHumanApproval } from "../src/share.js";
import { T1_LIMITS } from "../src/t1.js";
import { DEV_USER_COOKIE, DEV_USER_HEADER } from "../src/identity.js";

/**
 * The contract's own behaviour: normalization of untrusted input, and the
 * exact bodies a caller is refused with. Both halves of the split assert
 * against these, which is the point of there being one copy.
 */

describe("parseGalleryQuery", () => {
  const ok = (raw?: Record<string, string | undefined>) => {
    const result = parseGalleryQuery(raw);
    if (!result.ok) throw new Error(`refused: ${result.message}`);
    return result.query;
  };

  it("defaults everything when nothing is asked for", () => {
    expect(ok()).toEqual({
      type: null,
      sort: "recent",
      withSite: false,
      limit: GALLERY_PAGE_SIZE,
      offset: 0,
    });
  });

  /**
   * The behaviour change this package took on purpose. Every row below used to
   * be HTTP 200 over an answer nobody asked for (docs/ADR-zod-tanstack.md §4).
   * The last row is the sharpest: `Number.parseInt("1e9")` is 1, so a hostile
   * page size used to return ONE card, quietly.
   */
  it("REFUSES an injected sort key, a hostile page size and a negative offset", () => {
    for (const raw of [
      { sort: "s.id; DROP TABLE share_links" },
      { limit: "1000000000" },
      { limit: "1e9" },
      { limit: "many" },
      { limit: "0" },
      { limit: "24.5" },
      { offset: "-5" },
      { type: "nope" },
      { site: "true" },
    ]) {
      const result = parseGalleryQuery(raw);
      expect({ raw, ok: result.ok }).toEqual({ raw, ok: false });
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("accepts every value the service will act on", () => {
    expect(ok({ type: "MSVD" }).type).toBe("MSVD");
    expect(ok({ sort: "oldest" }).sort).toBe("oldest");
    expect(ok({ site: "1" }).withSite).toBe(true);
    expect(ok({ limit: String(GALLERY_MAX_PAGE_SIZE) }).limit).toBe(GALLERY_MAX_PAGE_SIZE);
    expect(ok({ offset: "24" }).offset).toBe(24);
    expect(PLAYER_TYPE_CODE_RE.test("MSVD")).toBe(true);
    expect(PLAYER_TYPE_CODE_RE.test("XSVD")).toBe(false);
  });

  /**
   * A gallery link shared with a tracking parameter on the end must still open
   * the gallery. This is the one place the package is NOT strict, and it is a
   * decision, not an oversight.
   */
  it("ignores a key the route does not act on", () => {
    expect(ok({ utm_source: "twitter", sort: "oldest" }).sort).toBe("oldest");
  });

  it("reads an absent key as absent, not as an empty string", () => {
    expect(ok({ type: undefined, limit: undefined })).toEqual({
      type: null,
      sort: "recent",
      withSite: false,
      limit: GALLERY_PAGE_SIZE,
      offset: 0,
    });
  });
});

/**
 * The other direction, and the reason TEN-107 happened: the browser wrote its
 * own query strings, so `?sort=top&site=0` — a vocabulary no parser here has
 * ever had — went out on the wire and came back 400. One writer, one reader,
 * and a round trip that proves they agree.
 */
describe("galleryQueryString", () => {
  const parse = (qs: string) =>
    parseGalleryQuery(Object.fromEntries(new URLSearchParams(qs.replace(/^\?/, ""))));

  const DEFAULTS = parseGalleryQuery({});

  it("writes nothing at all for the default query", () => {
    if (!DEFAULTS.ok) throw new Error(DEFAULTS.message);
    expect(galleryQueryString(DEFAULTS.query)).toBe("");
  });

  it("OMITS an absent filter — there is no site=0, and never was", () => {
    if (!DEFAULTS.ok) throw new Error(DEFAULTS.message);
    const written = galleryQueryString({ ...DEFAULTS.query, withSite: false });
    expect(written).not.toContain("site");
    expect(galleryQueryString({ ...DEFAULTS.query, withSite: true })).toBe("?site=1");
  });

  it("round-trips every query the parser accepts", () => {
    for (const raw of [
      {},
      { type: "MSVD" },
      { sort: "oldest" },
      { sort: "type" },
      { site: "1" },
      { limit: "48" },
      { offset: "24" },
      { type: "PTAE", sort: "type", site: "1", limit: "48", offset: "48" },
    ]) {
      const first = parseGalleryQuery(raw);
      if (!first.ok) throw new Error(`${JSON.stringify(raw)}: ${first.message}`);
      const again = parse(galleryQueryString(first.query));
      expect({ raw, ok: again.ok }).toEqual({ raw, ok: true });
      if (again.ok) expect(again.query).toEqual(first.query);
    }
  });

  it("cannot write the two spellings the service refused (TEN-107)", () => {
    if (!DEFAULTS.ok) throw new Error(DEFAULTS.message);
    for (const query of [
      DEFAULTS.query,
      { ...DEFAULTS.query, withSite: true },
      { ...DEFAULTS.query, sort: "type" as const, offset: 24 },
    ]) {
      const written = galleryQueryString(query);
      expect(written).not.toContain("sort=top");
      expect(written).not.toContain("site=0");
    }
  });
});

describe("parseApiError", () => {
  it("reads the frozen refusal bodies both sides send", () => {
    expect(parseApiError(UNAUTHORIZED_RESULT.body)).toEqual({
      code: "unauthorized",
      message: "authentication required",
    });
    expect(parseApiError(FORBIDDEN_RESULT.body)?.code).toBe("forbidden");
  });

  it("reads anything that is not the envelope as NO reason", () => {
    // A proxy's HTML page, an empty body, a half-filled envelope: none of
    // these is a sentence we may quote to a reader as the service's own.
    for (const body of [null, undefined, "<html>502</html>", {}, { error: {} }, { error: "no" }, [
      1,
    ], { error: { code: "x" } }, { error: { code: "", message: "m" } }]) {
      expect(parseApiError(body)).toBeNull();
    }
  });
});

describe("the gallery response schema", () => {
  const PAYLOAD = sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
    instrument: "ailx 2026.1",
    sections: ALL_SHARE_SECTIONS,
  });

  const entry = (over: Partial<GalleryEntry> = {}): GalleryEntry => ({
    id: "11111111-2222-3333-4444-555555555555",
    token: "g".repeat(43),
    at: "2026-03-01T12:00:00.000Z",
    payload: PAYLOAD,
    approvedBy: "auto:card",
    ...over,
  });

  const listing = (over: Record<string, unknown> = {}) => ({
    entries: [publicEntry(entry())],
    total: 1,
    facets: [{ code: "MSVD", name: "Method Sceptic", count: 1 }],
    query: {
      type: null,
      sort: "recent",
      withSite: false,
      limit: GALLERY_PAGE_SIZE,
      offset: 0,
    },
    ...over,
  });

  it("accepts what the service sends", () => {
    expect(galleryListingSchema.safeParse(listing()).success).toBe(true);
  });

  /**
   * The drift docs/ADR-orpc.md §7 found by reading code: the browser declared
   * `approvedBy` on a listing entry and the service has never sent it. The
   * schema is now the type, so the wrong shape is the one that fails.
   */
  it("REFUSES a listing entry carrying approvedBy", () => {
    expect(galleryListingSchema.safeParse(listing({ entries: [entry()] })).success).toBe(false);
  });

  it("refuses a missing field, a wrong type and an unknown key", () => {
    const { total: _total, ...noTotal } = listing();
    expect(galleryListingSchema.safeParse(noTotal).success).toBe(false);
    expect(galleryListingSchema.safeParse(listing({ total: "1" })).success).toBe(false);
    expect(galleryListingSchema.safeParse({ ...listing(), extra: 1 }).success).toBe(false);
  });

  it("returns the payload the parser CLEANED, not the object that arrived", () => {
    const dirty = { ...PAYLOAD, surprise: "kept?" } as unknown;
    const parsed = galleryEntrySchema.safeParse({ ...entry(), payload: dirty });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("surprise" in parsed.data.payload).toBe(false);
  });

  it("refuses a payload that is not a share payload", () => {
    const broken = listing({ entries: [{ ...publicEntry(entry()), payload: { v: 99 } }] });
    expect(galleryListingSchema.safeParse(broken).success).toBe(false);
  });

  it("refuses a query the parser would have refused", () => {
    expect(galleryListingSchema.safeParse(listing({ query: { ...listing().query, limit: 1000 } })).success).toBe(false);
  });
});

describe("parseCaseQuery", () => {
  it("defaults to the pending lane and clamps the page", () => {
    expect(parseCaseQuery({})).toEqual({
      lane: "pending",
      includeAuto: false,
      limit: CASE_PAGE_SIZE,
      offset: 0,
    });
    expect(parseCaseQuery({ lane: "'; DROP TABLE share_links; --", limit: "10000", offset: "-5" })).toEqual({
      lane: "pending",
      includeAuto: false,
      limit: CASE_MAX_PAGE_SIZE,
      offset: 0,
    });
  });

  it("accepts the three real lanes", () => {
    for (const lane of ["pending", "appeals", "decided"] as const) {
      expect(parseCaseQuery({ lane }).lane).toBe(lane);
    }
  });
});

describe("normalizeCommentBody", () => {
  it("flattens CRLF, trailing space and blank-line runs", () => {
    expect(normalizeCommentBody("a  \r\n\n\n\nb  ")).toBe("a\n\nb");
  });

  it("caps the length and refuses a non-string", () => {
    expect(normalizeCommentBody("x".repeat(COMMENT_BODY_MAX + 100))).toHaveLength(COMMENT_BODY_MAX);
    expect(normalizeCommentBody(undefined)).toBe("");
    expect(normalizeCommentBody(42)).toBe("");
  });
});

describe("candidateMayReply", () => {
  const reviewer = { id: 1, role: "reviewer", body: "why", at: "2026-01-01T00:00:00.000Z" } as const;
  const candidate = { id: 2, role: "candidate", body: "but", at: "2026-01-01T00:00:01.000Z" } as const;

  it("is silent before a decision", () => {
    expect(candidateMayReply("unlisted", [])).toBe(false);
    expect(candidateMayReply("submitted", [])).toBe(false);
    expect(candidateMayReply("revoked", [])).toBe(false);
  });

  it("gives the candidate the turn only after a moderator has spoken", () => {
    expect(candidateMayReply("rejected", [])).toBe(true);
    expect(candidateMayReply("published", [reviewer])).toBe(true);
    expect(candidateMayReply("rejected", [reviewer, candidate])).toBe(false);
  });
});

describe("needsHumanApproval", () => {
  it("decides from the stored payload, not from any request field", () => {
    expect(needsHumanApproval({ site: null })).toBe(false);
    expect(needsHumanApproval({ site: null, note: null })).toBe(false);
    expect(needsHumanApproval({ site: "/api/site/x/index.html" })).toBe(true);
    // A candidate-authored note is content nobody vetted: same human, same gate.
    expect(needsHumanApproval({ site: null, note: "my words" })).toBe(true);
  });
});

describe("the refusal bodies", () => {
  it("are frozen, because an adapter reproduces them before the handler runs", () => {
    expect(UNAUTHORIZED_RESULT).toEqual({
      status: 401,
      body: { error: { code: "unauthorized", message: "authentication required" } },
    });
    expect(FORBIDDEN_RESULT).toEqual({
      status: 403,
      body: { error: { code: "forbidden", message: "reviewer access required" } },
    });
  });
});

describe("publicEntry", () => {
  it("drops the approver — a public tile names no human", () => {
    const entry = {
      id: "id",
      token: "t",
      at: "2026-01-01T00:00:00.000Z",
      payload: {} as GalleryEntry["payload"],
      approvedBy: "clerk:someone",
    };
    const seen = publicEntry(entry);
    expect("approvedBy" in seen).toBe(false);
    expect(JSON.stringify(seen)).not.toContain("clerk:someone");
  });
});

describe("the shared caps", () => {
  it("are the spec §12 numbers the browser and the server both enforce", () => {
    expect(T1_LIMITS).toEqual({
      maxTotalBytes: 25 * 1024 * 1024,
      maxFiles: 500,
      maxFileBytes: 10 * 1024 * 1024,
      maxPathLength: 512,
    });
  });

  it("spells the dev identity exactly once", () => {
    expect(DEV_USER_HEADER).toBe("x-ailx-dev-user");
    expect(DEV_USER_COOKIE).toBe("ailx_dev_user");
  });
});
