import { describe, it, expect } from "vitest";
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
