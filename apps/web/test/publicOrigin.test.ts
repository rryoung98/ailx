/**
 * Public-origin resolution — the value that lands in the sandbox CSP allowlist
 * and in the 308 Location. Regression cover for the staging P0 where both
 * carried the internal origin (https://localhost:3111) behind ngrok.
 */
import { describe, expect, it } from "vitest";
import { isEnabled, normalizeOrigin, resolvePublicOrigin } from "../lib/server/origin";

const req = (url: string) => new URL(url);
const hdrs = (h: Record<string, string> = {}) => new Headers(h);

describe("isEnabled", () => {
  it("accepts explicit opt-in spellings, case and whitespace insensitive", () => {
    for (const v of ["1", "true", "TRUE", " yes ", "on"]) expect(isEnabled(v)).toBe(true);
  });

  it("rejects everything else", () => {
    for (const v of [undefined, "", " ", "0", "false", "no", "maybe", "2"]) expect(isEnabled(v)).toBe(false);
  });
});

describe("normalizeOrigin", () => {
  it("accepts absolute http(s) origins", () => {
    expect(normalizeOrigin("https://ailx.example")).toBe("https://ailx.example");
    expect(normalizeOrigin("http://ailx.example")).toBe("http://ailx.example");
  });

  it("normalizes case, a single trailing slash, and default ports", () => {
    expect(normalizeOrigin("HTTPS://AILX.Example")).toBe("https://ailx.example");
    expect(normalizeOrigin("https://ailx.example/")).toBe("https://ailx.example");
    expect(normalizeOrigin("  https://ailx.example  ")).toBe("https://ailx.example");
    // WHATWG special-scheme shorthand: still an unambiguous, safe origin.
    expect(normalizeOrigin("http:ailx.example")).toBe("http://ailx.example");
    expect(normalizeOrigin("https://ailx.example:443")).toBe("https://ailx.example");
    expect(normalizeOrigin("http://ailx.example:80")).toBe("http://ailx.example");
  });

  it("keeps non-default ports and IPv6 literals", () => {
    expect(normalizeOrigin("https://ailx.example:8443")).toBe("https://ailx.example:8443");
    expect(normalizeOrigin("http://[::1]:3111")).toBe("http://[::1]:3111");
    expect(normalizeOrigin("http://[2001:DB8::1]")).toBe("http://[2001:db8::1]");
  });

  it("rejects junk", () => {
    for (const v of [
      undefined,
      "",
      "   ",
      "ailx.example", // not absolute
      "//ailx.example", // protocol-relative
      "ftp://ailx.example",
      "javascript://ailx.example",
      "data:text/html,x",
      "file:///etc/passwd",
      "https://ailx.example/path",
      "https://ailx.example//",
      "https://ailx.example/?q=1",
      "https://ailx.example/#frag",
      "https://user:pw@ailx.example",
      "https://",
      "https:// space.example",
      "not a url",
    ]) {
      expect(normalizeOrigin(v), `expected reject: ${String(v)}`).toBeNull();
    }
  });
});

describe("resolvePublicOrigin", () => {
  const url = req("https://localhost:3111/api/site/sha256:abc/");

  it("falls back to the request origin with no env and no trust", () => {
    expect(resolvePublicOrigin({}, url, hdrs())).toBe("https://localhost:3111");
  });

  it("prefers a valid AILX_PUBLIC_ORIGIN over everything", () => {
    const env = { AILX_PUBLIC_ORIGIN: "https://ailx.example/", AILX_TRUST_PROXY: "1" };
    const h = hdrs({ "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" });
    expect(resolvePublicOrigin(env, url, h)).toBe("https://ailx.example");
  });

  it("ignores an invalid AILX_PUBLIC_ORIGIN rather than throwing", () => {
    expect(resolvePublicOrigin({ AILX_PUBLIC_ORIGIN: "nonsense" }, url, hdrs())).toBe("https://localhost:3111");
    expect(resolvePublicOrigin({ AILX_PUBLIC_ORIGIN: "" }, url, hdrs())).toBe("https://localhost:3111");
    expect(resolvePublicOrigin({ AILX_PUBLIC_ORIGIN: "https://a.example/x" }, url, hdrs())).toBe(
      "https://localhost:3111",
    );
  });

  it("uses forwarded headers only when proxy trust is enabled", () => {
    const h = hdrs({ "x-forwarded-host": "abc.ngrok-free.app", "x-forwarded-proto": "https" });
    expect(resolvePublicOrigin({}, url, h)).toBe("https://localhost:3111");
    expect(resolvePublicOrigin({ AILX_TRUST_PROXY: "0" }, url, h)).toBe("https://localhost:3111");
    expect(resolvePublicOrigin({ AILX_TRUST_PROXY: "1" }, url, h)).toBe("https://abc.ngrok-free.app");
  });

  it("takes the first entry of comma-separated forwarded lists", () => {
    const h = hdrs({
      "x-forwarded-host": "edge.example, internal.example, 10.0.0.7",
      "x-forwarded-proto": "https, http",
    });
    expect(resolvePublicOrigin({ AILX_TRUST_PROXY: "1" }, url, h)).toBe("https://edge.example");
  });

  it("handles ports, IPv6 literals and header case", () => {
    const h = hdrs({ "X-Forwarded-Host": "Edge.Example:8443", "X-Forwarded-Proto": "HTTPS" });
    expect(resolvePublicOrigin({ AILX_TRUST_PROXY: "1" }, url, h)).toBe("https://edge.example:8443");
    const v6 = hdrs({ "x-forwarded-host": "[2001:db8::1]:8080", "x-forwarded-proto": "http" });
    expect(resolvePublicOrigin({ AILX_TRUST_PROXY: "1" }, url, v6)).toBe("http://[2001:db8::1]:8080");
  });

  it("falls back to the request protocol when only the host is forwarded", () => {
    const h = hdrs({ "x-forwarded-host": "edge.example" });
    expect(resolvePublicOrigin({ AILX_TRUST_PROXY: "1" }, url, h)).toBe("https://edge.example");
    expect(resolvePublicOrigin({ AILX_TRUST_PROXY: "1" }, req("http://localhost:3111/x"), h)).toBe(
      "http://edge.example",
    );
  });

  it("ignores a forwarded proto-only header and malformed forwarded values", () => {
    expect(resolvePublicOrigin({ AILX_TRUST_PROXY: "1" }, url, hdrs({ "x-forwarded-proto": "https" }))).toBe(
      "https://localhost:3111",
    );
    for (const host of ["", "  ", "evil.example/path", "evil.example?q=1", "evil example", "evil.example#f"]) {
      const h = hdrs({ "x-forwarded-host": host, "x-forwarded-proto": "https" });
      expect(resolvePublicOrigin({ AILX_TRUST_PROXY: "1" }, url, h), `host: ${host}`).toBe("https://localhost:3111");
    }
    const badProto = hdrs({ "x-forwarded-host": "edge.example", "x-forwarded-proto": "javascript" });
    expect(resolvePublicOrigin({ AILX_TRUST_PROXY: "1" }, url, badProto)).toBe("https://localhost:3111");
  });

  it("never reflects an untrusted Host header", () => {
    const h = hdrs({ host: "evil.example", "x-forwarded-host": "evil.example" });
    expect(resolvePublicOrigin({}, url, h)).toBe("https://localhost:3111");
  });
});
