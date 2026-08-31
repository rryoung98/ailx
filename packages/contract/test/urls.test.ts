import { describe, expect, it } from "vitest";

import { SITE_INDEX, canonicalSitePath, siteUrlPath } from "../src/site-url.js";
import { SHARE_TOKEN_RE, shareCardPath, shareUrlPath } from "../src/share-url.js";

/**
 * FROZEN STRINGS.
 *
 * Every path here is stored, not just rendered: `siteUrlPath` output is
 * written into the FROZEN share payload and into a credential's `artifact`
 * claim, both of which live in append-only rows, and `shareUrlPath` is what a
 * candidate has already pasted somewhere we cannot edit. So these are not
 * "does it look right" tests — a one-byte change breaks a link that was
 * issued, and re-issuing is exactly what an append-only store forbids.
 *
 * They moved here with the functions (they used to live in @ailx/backend's
 * PGlite suites, which the browser repo cannot run at all).
 */
describe("share url conventions", () => {
  it("builds the share and card paths from one place", () => {
    expect(shareUrlPath("abc")).toBe("/s/abc");
    expect(shareUrlPath("abc", "/ailx")).toBe("/ailx/s/abc");
    expect(shareCardPath("abc")).toBe("/api/share/abc/card.png");
  });

  it("honours a basePath-prefixed API root for the card", () => {
    expect(shareCardPath("abc", "/ailx/api")).toBe("/ailx/api/share/abc/card.png");
  });

  it("accepts exactly a 43-character base64url token", () => {
    expect(SHARE_TOKEN_RE.test("a".repeat(43))).toBe(true);
    expect(SHARE_TOKEN_RE.test("a".repeat(42))).toBe(false);
    expect(SHARE_TOKEN_RE.test("a".repeat(44))).toBe(false);
    expect(SHARE_TOKEN_RE.test(`${"a".repeat(42)}+`)).toBe(false);
    expect(SHARE_TOKEN_RE.test(`${"a".repeat(42)}=`)).toBe(false);
    expect(SHARE_TOKEN_RE.test(`${"a".repeat(42)}_`)).toBe(true);
  });
});

describe("site URL convention", () => {
  const DIGEST = `sha256:${"a".repeat(64)}`;

  it("canonicalises only directory-ish paths", () => {
    expect(canonicalSitePath("")).toBe("index.html");
    expect(canonicalSitePath("/")).toBe("/index.html");
    expect(canonicalSitePath("sub/")).toBe("sub/index.html");
    expect(canonicalSitePath("index.html")).toBe("index.html");
    expect(canonicalSitePath("sub/index.html")).toBe("sub/index.html");
    expect(canonicalSitePath("assets/app.js")).toBe("assets/app.js");
  });

  it("is a fixed point — canonicalising twice cannot start a redirect loop", () => {
    for (const p of ["", "/", "sub/", "index.html", "assets/app.js"]) {
      const once = canonicalSitePath(p);
      expect(canonicalSitePath(once)).toBe(once);
    }
  });

  it("builds the canonical live URL, honouring a basePath-prefixed API root", () => {
    expect(siteUrlPath(DIGEST)).toBe(`/api/site/${DIGEST}/index.html`);
    expect(siteUrlPath(DIGEST, "/ailx/api")).toBe(`/ailx/api/site/${DIGEST}/index.html`);
    expect(siteUrlPath(DIGEST).endsWith("/")).toBe(false);
  });

  it("names the index file explicitly, so no framework rewrites the URL", () => {
    expect(SITE_INDEX).toBe("index.html");
    expect(siteUrlPath(DIGEST).endsWith(`/${SITE_INDEX}`)).toBe(true);
  });
});
