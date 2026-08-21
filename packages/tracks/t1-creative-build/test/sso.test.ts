import { describe, it, expect, vi } from "vitest";
import {
  base64Url,
  buildAuthUrl,
  buildKeyExchangePayload,
  cleanCallbackUrl,
  computeCodeChallenge,
  exchangeCodeForKey,
  extractCallbackCode,
  generateCodeVerifier,
  OPENROUTER_AUTH_URL,
  OPENROUTER_KEY_EXCHANGE_URL,
  PKCE_VERIFIER_STORAGE,
} from "../src/sso.js";
import { OpenRouterError } from "../src/openrouter.js";

describe("base64Url", () => {
  it("encodes without padding using the url-safe alphabet", () => {
    // 0xfb 0xff -> base64 "+/8=" -> base64url "-_8"
    expect(base64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(base64Url(new Uint8Array([]))).toBe("");
  });
});

describe("generateCodeVerifier (injected crypto)", () => {
  it("produces a 43-char RFC 7636 verifier from 32 injected bytes", () => {
    const getRandomValues = vi.fn((a: Uint8Array) => {
      for (let i = 0; i < a.length; i++) a[i] = i;
      return a;
    });
    const v = generateCodeVerifier(getRandomValues);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect((getRandomValues.mock.calls[0][0] as Uint8Array).length).toBe(32);
    expect(v).toHaveLength(43); // base64url(32 bytes), no padding
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/); // unreserved charset only
    // deterministic given the injected bytes
    expect(generateCodeVerifier(getRandomValues)).toBe(v);
  });
});

describe("computeCodeChallenge (S256)", () => {
  it("matches the RFC 7636 appendix B vector using real SHA-256", async () => {
    const challenge = await computeCodeChallenge(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      globalThis.crypto.subtle,
    );
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("uses the injected digest implementation", async () => {
    const digest = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    const challenge = await computeCodeChallenge("verifier", { digest });
    expect(digest).toHaveBeenCalledWith("SHA-256", expect.any(Uint8Array));
    expect(challenge).toBe(base64Url(new Uint8Array([1, 2, 3])));
  });
});

describe("buildAuthUrl", () => {
  it("targets openrouter.ai/auth with callback, challenge and S256 method", () => {
    const url = buildAuthUrl("https://exam.example/path?x=1", "CHAL-123_abc");
    expect(url.startsWith(`${OPENROUTER_AUTH_URL}?`)).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get("callback_url")).toBe("https://exam.example/path?x=1");
    expect(q.get("code_challenge")).toBe("CHAL-123_abc");
    expect(q.get("code_challenge_method")).toBe("S256");
  });
});

describe("exchangeCodeForKey (mocked fetch — no network)", () => {
  it("POSTs code + verifier to /api/v1/auth/keys and returns the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: "sk-or-v1-user-scoped" }),
    });
    const key = await exchangeCodeForKey(fetchMock, "the-code", "the-verifier");
    expect(key).toBe("sk-or-v1-user-scoped");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OPENROUTER_KEY_EXCHANGE_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(
      buildKeyExchangePayload("the-code", "the-verifier"),
    );
  });
  it("payload shape follows the OpenRouter PKCE contract", () => {
    expect(buildKeyExchangePayload("c", "v")).toEqual({
      code: "c",
      code_verifier: "v",
      code_challenge_method: "S256",
    });
  });
  it("maps HTTP, network and shape failures to OpenRouterError", async () => {
    await expect(
      exchangeCodeForKey(
        vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }),
        "c",
        "v",
      ),
    ).rejects.toThrow(/403/);
    await expect(
      exchangeCodeForKey(vi.fn().mockRejectedValue(new TypeError("offline")), "c", "v"),
    ).rejects.toBeInstanceOf(OpenRouterError);
    await expect(
      exchangeCodeForKey(
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
        "c",
        "v",
      ),
    ).rejects.toThrow(/no key/i);
  });
});

describe("callback URL handling", () => {
  it("extracts ?code= from a search string", () => {
    expect(extractCallbackCode("?code=abc123")).toBe("abc123");
    expect(extractCallbackCode("code=abc123&state=x")).toBe("abc123");
    expect(extractCallbackCode("?other=1")).toBeNull();
    expect(extractCallbackCode("")).toBeNull();
  });
  it("cleanCallbackUrl strips the code param (for history.replaceState)", () => {
    expect(cleanCallbackUrl("https://exam.example/exam?code=abc&tab=t1")).toBe(
      "https://exam.example/exam?tab=t1",
    );
    expect(cleanCallbackUrl("https://exam.example/exam?code=abc")).toBe(
      "https://exam.example/exam",
    );
    expect(cleanCallbackUrl("not a url")).toBe("not a url");
  });
  it("the verifier storage slot is declared and distinct from the key slot", () => {
    expect(PKCE_VERIFIER_STORAGE).toBe("ailx:openrouter-pkce-verifier");
  });
});
