import { describe, expect, it } from "vitest";

import { FORBIDDEN_RESULT, UNAUTHORIZED_RESULT } from "../src/api.js";
import {
  GALLERY_MAX_PAGE_SIZE,
  GALLERY_PAGE_SIZE,
  PLAYER_TYPE_CODE_RE,
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
  it("defaults everything when nothing is asked for", () => {
    expect(parseGalleryQuery()).toEqual({
      type: null,
      sort: "recent",
      withSite: false,
      limit: GALLERY_PAGE_SIZE,
      offset: 0,
    });
  });

  it("refuses an injected sort key and a hostile page size", () => {
    expect(
      parseGalleryQuery({ sort: "s.id; DROP TABLE share_links", limit: "1000000000", offset: "-5" }),
    ).toEqual({ type: null, sort: "recent", withSite: false, limit: GALLERY_MAX_PAGE_SIZE, offset: 0 });
    // Not a number at all: the default, never NaN in a LIMIT clause.
    expect(parseGalleryQuery({ limit: "many" }).limit).toBe(GALLERY_PAGE_SIZE);
  });

  it("keeps a player-type code only when it is one", () => {
    expect(parseGalleryQuery({ type: "MSVD" }).type).toBe("MSVD");
    expect(parseGalleryQuery({ type: "nope" }).type).toBeNull();
    expect(PLAYER_TYPE_CODE_RE.test("MSVD")).toBe(true);
    expect(PLAYER_TYPE_CODE_RE.test("XSVD")).toBe(false);
  });

  it("treats site=1 as the only truthy spelling", () => {
    expect(parseGalleryQuery({ site: "1" }).withSite).toBe(true);
    expect(parseGalleryQuery({ site: "true" }).withSite).toBe(false);
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
