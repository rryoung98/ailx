import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeReq, makeRes } from "./helpers.js";

const PROD = "https://rryoung98.github.io";
const AUTH_URL = "https://openrouter.ai/api/v1/auth/key";
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** fetch mock routing auth/key and chat/completions; records upstream chat bodies. */
function mockUpstream({ usage = 0, authFails = false, chatStatus = 200, chatText = '{"ok":true}' } = {}) {
  const chatCalls = [];
  const fetchMock = vi.fn(async (url, init) => {
    if (url === AUTH_URL) {
      if (authFails) throw new Error("network down");
      return { json: async () => ({ data: { usage_weekly: usage } }) };
    }
    if (url === CHAT_URL) {
      chatCalls.push(JSON.parse(init.body));
      return { status: chatStatus, text: async () => chatText };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, chatCalls };
}

let handler;
let nextIp = 0;
const freshIp = () => `10.0.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;

function post(body, extra = {}) {
  return makeReq({ method: "POST", origin: PROD, ip: freshIp(), body, ...extra });
}
const goodBody = () => ({ model: "openai/gpt-4.1-nano", messages: [{ role: "user", content: "hi" }] });

beforeEach(async () => {
  vi.resetModules(); // fresh limiter + budget cache per test
  process.env.OPENROUTER_KEY = "sk-test";
  delete process.env.SHARED_BUDGET_USD;
  ({ default: handler } = await import("../api/v1/chat/completions.js"));
});
afterEach(() => vi.unstubAllGlobals());

describe("guard ladder", () => {
  it("answers OPTIONS preflight with 204 before anything else", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "OPTIONS", origin: PROD }), res);
    expect(res.statusCode).toBe(204);
  });

  it("rejects non-POST with 405", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "GET", origin: PROD }), res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 500 when OPENROUTER_KEY is unset (no upstream call)", async () => {
    delete process.env.OPENROUTER_KEY;
    const { fetchMock } = mockUpstream();
    const res = makeRes();
    await handler(post(goodBody()), res);
    expect(res.statusCode).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sets CORS fallback origin for unknown origins", async () => {
    mockUpstream();
    const res = makeRes();
    await handler(post(goodBody(), { origin: "https://evil.example.com" }), res);
    expect(res.headers["access-control-allow-origin"]).toBe(PROD);
  });
});

describe("rate limiting", () => {
  it("allows 60 requests per IP then returns 429", async () => {
    mockUpstream();
    const ip = "9.9.9.9";
    for (let i = 0; i < 60; i++) {
      const res = makeRes();
      await handler(post(goodBody(), { ip }), res);
      expect(res.statusCode).toBe(200);
    }
    const res = makeRes();
    await handler(post(goodBody(), { ip }), res);
    expect(res.statusCode).toBe(429);
    // other IPs unaffected
    const res2 = makeRes();
    await handler(post(goodBody()), res2);
    expect(res2.statusCode).toBe(200);
  });

  it("rate-limits invalid requests too (guard runs before validation)", async () => {
    mockUpstream();
    const ip = "8.8.8.8";
    for (let i = 0; i < 60; i++) await handler(post({ model: "nope" }, { ip }), makeRes());
    const res = makeRes();
    await handler(post(goodBody(), { ip }), res);
    expect(res.statusCode).toBe(429);
  });
});

describe("budget guard", () => {
  it("returns 402 when weekly usage >= cap (default $5)", async () => {
    const { chatCalls } = mockUpstream({ usage: 5 });
    const res = makeRes();
    await handler(post(goodBody()), res);
    expect(res.statusCode).toBe(402);
    expect(chatCalls).toHaveLength(0); // never touches the completion endpoint
  });

  it("respects SHARED_BUDGET_USD override", async () => {
    process.env.SHARED_BUDGET_USD = "10";
    mockUpstream({ usage: 7 });
    const res = makeRes();
    await handler(post(goodBody()), res);
    expect(res.statusCode).toBe(200);
  });

  it("caches the verdict for 60s (one auth call across requests)", async () => {
    const { fetchMock } = mockUpstream({ usage: 0 });
    await handler(post(goodBody()), makeRes());
    await handler(post(goodBody()), makeRes());
    const authCalls = fetchMock.mock.calls.filter(([u]) => u === AUTH_URL);
    expect(authCalls).toHaveLength(1);
  });

  it("keeps the last verdict when the budget check itself fails", async () => {
    // First: blocked verdict cached.
    mockUpstream({ usage: 99 });
    vi.useFakeTimers();
    try {
      await handler(post(goodBody()), makeRes());
      vi.advanceTimersByTime(61_000); // cache expired
      mockUpstream({ authFails: true });
      const res = makeRes();
      await handler(post(goodBody()), res);
      expect(res.statusCode).toBe(402); // stale "blocked" verdict retained, fail closed
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("model allowlist", () => {
  it.each([
    [undefined],
    [null],
    [42],
    [{ toString: () => "openai/gpt-4.1-nano" }], // non-string sneak
    ["openai/gpt-5"],
    [""],
    ["OPENAI/GPT-4.1-NANO"],
  ])("rejects model %j with 400", async (model) => {
    const { chatCalls } = mockUpstream();
    const res = makeRes();
    await handler(post({ ...goodBody(), model }), res);
    expect(res.statusCode).toBe(400);
    expect(chatCalls).toHaveLength(0);
  });

  it.each([
    "openai/gpt-4.1-nano",
    "google/gemini-3.1-flash-image",
    "google/gemini-3.1-flash-lite-image",
  ])("accepts allowlisted model %s", async (model) => {
    mockUpstream();
    const res = makeRes();
    await handler(post({ ...goodBody(), model }), res);
    expect(res.statusCode).toBe(200);
  });
});

describe("payload caps forwarded upstream", () => {
  async function sentBody(patch) {
    const { chatCalls } = mockUpstream();
    await handler(post({ ...goodBody(), ...patch }), makeRes());
    expect(chatCalls).toHaveLength(1);
    return chatCalls[0];
  }

  it.each([
    [undefined, 8000],
    ["abc", 8000],        // the NaN bypass: must clamp, not forward null
    [NaN, 8000],
    [999999, 8000],
    [-5, 1],
    [0, 1],
    ["500", 500],
    [123, 123],
  ])("max_tokens %j -> %d", async (input, expected) => {
    const body = await sentBody({ max_tokens: input });
    expect(body.max_tokens).toBe(expected);
    expect(Number.isFinite(body.max_tokens)).toBe(true);
  });

  it("forces stream off and n to 1", async () => {
    const body = await sentBody({ stream: true, n: 7 });
    expect(body.stream).toBe(false);
    expect(body.n).toBe(1);
  });

  it("handles a missing body without crashing", async () => {
    mockUpstream();
    const res = makeRes();
    await handler(post(undefined), res);
    expect(res.statusCode).toBe(400); // no model → allowlist rejection
  });
});

describe("upstream passthrough", () => {
  it("relays upstream status and body verbatim", async () => {
    mockUpstream({ chatStatus: 418, chatText: '{"error":"teapot"}' });
    const res = makeRes();
    await handler(post(goodBody()), res);
    expect(res.statusCode).toBe(418);
    expect(res.body).toBe('{"error":"teapot"}');
    expect(res.headers["content-type"]).toBe("application/json");
  });

  it("never leaks the key to the client, only upstream", async () => {
    const { fetchMock } = mockUpstream();
    const res = makeRes();
    await handler(post(goodBody()), res);
    expect(JSON.stringify(res.body ?? "")).not.toContain("sk-test");
    const [, init] = fetchMock.mock.calls.find(([u]) => u === CHAT_URL);
    expect(init.headers.Authorization).toBe("Bearer sk-test");
  });
});
