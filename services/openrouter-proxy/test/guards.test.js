import { describe, it, expect, afterEach } from "vitest";
import {
  PROD_ORIGIN,
  isAllowedOrigin,
  applyCors,
  clientIp,
  createRateLimiter,
  clampMaxTokens,
} from "../api/_lib/guards.js";
import { makeReq, makeRes } from "./helpers.js";

describe("isAllowedOrigin", () => {
  it.each([
    [PROD_ORIGIN, true],
    ["http://localhost", true],
    ["http://localhost:3000", true],
    ["http://localhost:3199", true],
    ["http://localhost:65535", true],
    ["http://127.0.0.1", true],
    ["http://127.0.0.1:8080", true],
  ])("allows %s", (origin, ok) => expect(isAllowedOrigin(origin)).toBe(ok));

  it.each([
    "",
    "https://evil.example.com",
    "http://localhost.evil.com",       // suffix attack
    "http://localhost.evil.com:3000",
    "http://evillocalhost",
    "https://localhost:3000",          // https localhost not in policy
    "http://127.0.0.2",
    "http://rryoung98.github.io",      // http downgrade of prod origin
    "https://rryoung98.github.io.evil.com",
    "http://localhost:3000/path",      // origins never have paths
    "null",
  ])("rejects %s", (origin) => expect(isAllowedOrigin(origin)).toBe(false));
});

describe("isAllowedOrigin with AILX_ALLOWED_ORIGINS", () => {
  const ENV = "AILX_ALLOWED_ORIGINS";
  afterEach(() => {
    delete process.env[ENV];
  });

  it("keeps the defaults when the env var is unset", () => {
    expect(isAllowedOrigin(PROD_ORIGIN)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("https://staging.example.com")).toBe(false);
  });

  it("keeps the defaults when the env var is set", () => {
    process.env[ENV] = "https://staging.example.com";
    expect(isAllowedOrigin(PROD_ORIGIN)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
  });

  it("allows a configured origin", () => {
    process.env[ENV] = "https://staging.example.com";
    expect(isAllowedOrigin("https://staging.example.com")).toBe(true);
  });

  it("picks up env changes between calls (no load-time caching)", () => {
    expect(isAllowedOrigin("https://a.ngrok.app")).toBe(false);
    process.env[ENV] = "https://a.ngrok.app";
    expect(isAllowedOrigin("https://a.ngrok.app")).toBe(true);
    process.env[ENV] = "https://b.ngrok.app";
    expect(isAllowedOrigin("https://a.ngrok.app")).toBe(false);
    expect(isAllowedOrigin("https://b.ngrok.app")).toBe(true);
    delete process.env[ENV];
    expect(isAllowedOrigin("https://b.ngrok.app")).toBe(false);
  });

  it.each([
    ["comma separated", "https://a.example.com,https://b.example.com"],
    ["comma + space", "https://a.example.com, https://b.example.com"],
    ["whitespace only", "https://a.example.com \n\t https://b.example.com"],
    ["trailing comma", "https://a.example.com,https://b.example.com,"],
    ["empty entries", ",,https://a.example.com,,,https://b.example.com,,"],
    ["duplicates", "https://a.example.com,https://b.example.com,https://a.example.com"],
    ["surrounding whitespace", "  https://a.example.com , https://b.example.com  "],
  ])("parses %s", (_label, raw) => {
    process.env[ENV] = raw;
    expect(isAllowedOrigin("https://a.example.com")).toBe(true);
    expect(isAllowedOrigin("https://b.example.com")).toBe(true);
    expect(isAllowedOrigin("https://c.example.com")).toBe(false);
  });

  it.each(["", "   ", "\n\t ", ",", " , , "])("treats %j as no extra origins", (raw) => {
    process.env[ENV] = raw;
    expect(isAllowedOrigin("https://staging.example.com")).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
    expect(isAllowedOrigin(PROD_ORIGIN)).toBe(true);
  });

  it.each([
    "*",
    "null",
    "https://staging.example.com/",        // trailing slash
    "https://staging.example.com/app",     // path
    "https://staging.example.com?a=1",     // query
    "https://staging.example.com#frag",    // fragment
    "staging.example.com",                 // no scheme
    "ftp://staging.example.com",           // wrong scheme
    "file://staging.example.com",
    "javascript:alert(1)",
    "https://user:pass@staging.example.com", // userinfo
    "https:/staging.example.com",          // malformed
    "https://",                            // no host
    "http://",
  ])("ignores the malformed entry %j", (bad) => {
    process.env[ENV] = `${bad},https://good.example.com`;
    expect(isAllowedOrigin("https://good.example.com")).toBe(true);
    expect(isAllowedOrigin(bad)).toBe(false);
    expect(isAllowedOrigin("*")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin("https://staging.example.com")).toBe(false);
  });

  it("never allows a wildcard or null even when configured alone", () => {
    process.env[ENV] = "*, null";
    expect(isAllowedOrigin("*")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin("https://anything.example.com")).toBe(false);
  });

  it("normalizes scheme and host case, but not the rest of the origin", () => {
    process.env[ENV] = "HTTPS://Staging.Example.COM";
    expect(isAllowedOrigin("https://staging.example.com")).toBe(true);
    expect(isAllowedOrigin("HTTPS://STAGING.EXAMPLE.COM")).toBe(true);
    expect(isAllowedOrigin("https://other.example.com")).toBe(false);
  });

  it("treats a default port as the portless origin, and other ports as distinct", () => {
    process.env[ENV] = "https://staging.example.com:443, http://staging.example.com:80";
    expect(isAllowedOrigin("https://staging.example.com")).toBe(true);
    expect(isAllowedOrigin("http://staging.example.com")).toBe(true);
    expect(isAllowedOrigin("https://staging.example.com:8443")).toBe(false);
  });

  it("keeps a non-default port significant", () => {
    process.env[ENV] = "http://staging.example.com:8080";
    expect(isAllowedOrigin("http://staging.example.com:8080")).toBe(true);
    expect(isAllowedOrigin("http://staging.example.com")).toBe(false);
  });

  it("stays anchored: no suffix, prefix, or path bypass", () => {
    process.env[ENV] = "https://staging.example.com";
    for (const bad of [
      "https://staging.example.com.evil.com",
      "https://evil.com/https://staging.example.com",
      "https://staging.example.com/../evil",
      "https://staging.example.com/",
      "https://staging.example.com@evil.com",
      "http://staging.example.com",          // scheme must match
      "http://localhost.evil.com",
    ]) {
      expect(isAllowedOrigin(bad)).toBe(false);
    }
  });

  it("echoes a configured origin through applyCors and still falls back to prod", () => {
    process.env[ENV] = "https://staging.example.com";
    const ok = makeRes();
    expect(applyCors(makeReq({ method: "POST", origin: "https://staging.example.com" }), ok, ["POST"])).toBe(false);
    expect(ok.headers["access-control-allow-origin"]).toBe("https://staging.example.com");

    const bad = makeRes();
    applyCors(makeReq({ method: "POST", origin: "https://evil.example.com" }), bad, ["POST"]);
    expect(bad.headers["access-control-allow-origin"]).toBe(PROD_ORIGIN);
  });
});

describe("applyCors", () => {
  it("echoes an allowed origin", () => {
    const res = makeRes();
    const handled = applyCors(makeReq({ method: "POST", origin: "http://localhost:3199" }), res, ["POST"]);
    expect(handled).toBe(false);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3199");
    expect(res.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
  });

  it("falls back to the prod origin for disallowed origins", () => {
    const res = makeRes();
    applyCors(makeReq({ origin: "https://evil.example.com" }), res, ["POST"]);
    expect(res.headers["access-control-allow-origin"]).toBe(PROD_ORIGIN);
  });

  it("falls back to the prod origin when no origin header is sent", () => {
    const res = makeRes();
    applyCors(makeReq({}), res, ["POST"]);
    expect(res.headers["access-control-allow-origin"]).toBe(PROD_ORIGIN);
  });

  it("handles OPTIONS preflight with 204 and no body", () => {
    const res = makeRes();
    const handled = applyCors(makeReq({ method: "OPTIONS", origin: PROD_ORIGIN }), res, ["POST"]);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBeUndefined();
    expect(res.ended).toBe(true);
  });

  it("rejects disallowed methods with 405", () => {
    const res = makeRes();
    const handled = applyCors(makeReq({ method: "DELETE" }), res, ["GET", "POST"]);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: "GET or POST only" });
  });

  it("allows any listed method", () => {
    const res = makeRes();
    expect(applyCors(makeReq({ method: "GET" }), res, ["GET", "POST"])).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    expect(clientIp(makeReq({ ip: "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
  it("trims whitespace", () => {
    expect(clientIp(makeReq({ ip: " 1.2.3.4 ,10.0.0.1" }))).toBe("1.2.3.4");
  });
  it("falls back to ? when header is missing", () => {
    expect(clientIp(makeReq({}))).toBe("?");
  });
});

describe("createRateLimiter", () => {
  it("limits after max hits inside the window", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 3 });
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rl.isLimited("a", t + i)).toBe(false);
      rl.record("a", t + i);
    }
    expect(rl.isLimited("a", t + 3)).toBe(true);
  });

  it("keeps IPs independent", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 });
    rl.record("a", 0);
    expect(rl.isLimited("a", 1)).toBe(true);
    expect(rl.isLimited("b", 1)).toBe(false);
  });

  it("expires hits after the window", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 });
    rl.record("a", 0);
    expect(rl.isLimited("a", 999)).toBe(true);
    expect(rl.isLimited("a", 1000)).toBe(false);
  });

  it("slides the window (partial expiry)", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 2 });
    rl.record("a", 0);
    rl.record("a", 900);
    expect(rl.isLimited("a", 950)).toBe(true);
    expect(rl.isLimited("a", 1100)).toBe(false); // first hit expired, one live
  });

  it("prunes fully-expired entries from the map", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 5 });
    rl.record("a", 0);
    expect(rl.size()).toBe(1);
    rl.isLimited("a", 5000);
    expect(rl.size()).toBe(0);
  });

  it("stays bounded at maxIps without resetting live limits", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1, maxIps: 3 });
    rl.record("hot", 100); // oldest-inserted but still live
    rl.record("b", 100);
    rl.record("c", 100);
    rl.record("d", 100); // over cap → evicts oldest-inserted ("hot")
    expect(rl.size()).toBe(3);
    // Everyone still tracked keeps their limit.
    expect(rl.isLimited("d", 101)).toBe(true);
    expect(rl.isLimited("c", 101)).toBe(true);
  });

  it("evicts expired entries before live ones when over cap", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1, maxIps: 2 });
    rl.record("stale", 0);
    rl.record("live", 5000);
    rl.record("live2", 5000); // over cap at t=5000 → "stale" swept as expired
    expect(rl.size()).toBe(2);
    expect(rl.isLimited("live", 5001)).toBe(true);
    expect(rl.isLimited("live2", 5001)).toBe(true);
  });
});

describe("clampMaxTokens", () => {
  const CAP = 8000;
  it.each([
    [undefined, CAP],
    [null, CAP],
    [NaN, CAP],
    ["abc", CAP],           // the original NaN-bypass bug
    ["", CAP],              // empty string is "absent", not a request for 0
    ["   ", CAP],
    [Infinity, CAP],
    [-Infinity, CAP],
    ["1e999", CAP],         // Infinity via string
    [{}, CAP],
    [[1, 2], CAP],          // Number([1,2]) is NaN
    [9999999, CAP],
    [8001, CAP],
    [8000, 8000],
    [7999, 7999],
    [1, 1],
    [0, 1],
    [-5, 1],
    [-0.5, 1],
    [3.9, 3],               // floored, never rounded up past intent
    ["500", 500],           // numeric strings pass through clamped
    ["  42 ", 42],
    [true, 1],
    [false, 1],             // Number(false)=0 → floor 1
  ])("clampMaxTokens(%j) -> %d", (input, expected) => {
    expect(clampMaxTokens(input, CAP)).toBe(expected);
  });
});
