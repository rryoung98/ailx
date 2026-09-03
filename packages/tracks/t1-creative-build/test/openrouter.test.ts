import { describe, it, expect, vi } from "vitest";
import {
  buildVibeRequest,
  buildFetchInit,
  clearLlmConnection,
  extractHtmlFence,
  LLM_CONNECTION_KEYS,
  requestVibeCompletion,
  parseModelsResponse,
  fetchModelIds,
  normalizeBaseUrl,
  chatCompletionsUrl,
  modelsUrl,
  CURATED_MODELS,
  hasModelEndpoint,
  LLM_BASE_URL_STORAGE,
  OpenRouterError,
} from "../src/openrouter.js";

/** Any endpoint at all; the module has no default and must not grow one. */
const BASE = "https://exam.example/v1/model";

const DOC = "<!doctype html><html><head><title>x</title></head><body>hi</body></html>";

describe("extractHtmlFence", () => {
  it("extracts the html-tagged fence", () => {
    expect(extractHtmlFence("Sure!\n```html\n" + DOC + "\n```\nDone.")).toBe(DOC);
  });
  it("prefers the html fence over other fences", () => {
    const text =
      "```css\nbody{}\n```\n```html\n" + DOC + "\n```";
    expect(extractHtmlFence(text)).toBe(DOC);
  });
  it("is case/label tolerant: falls back to an untagged fence holding a document", () => {
    expect(extractHtmlFence("```\n" + DOC + "\n```")).toBe(DOC);
  });
  it("accepts a bare full-document reply with no fence", () => {
    expect(extractHtmlFence(DOC)).toBe(DOC);
  });
  it("returns null for chatter, empty fences, and non-documents", () => {
    expect(extractHtmlFence("I can't help with that.")).toBeNull();
    expect(extractHtmlFence("```html\n\n```")).toBeNull();
    expect(extractHtmlFence("```js\nconsole.log(1)\n```")).toBeNull();
    expect(extractHtmlFence("")).toBeNull();
  });
});

describe("buildVibeRequest / buildFetchInit", () => {
  const payload = buildVibeRequest({
    model: "openai/gpt-4o-mini",
    brief: "Build a personal site.",
    currentHtml: DOC,
    userPrompt: "add a project grid",
  });

  it("targets the chosen model with a system + user message", () => {
    expect(payload.model).toBe("openai/gpt-4o-mini");
    expect(payload.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });
  it("system prompt demands one complete fenced html document", () => {
    const sys = payload.messages[0].content;
    expect(sys).toContain("COMPLETE UPDATED HTML DOCUMENT");
    expect(sys).toContain("```html");
    expect(sys).toContain("self-contained");
  });
  it("user message carries brief, current document and request", () => {
    const user = payload.messages[1].content;
    expect(user).toContain("Build a personal site.");
    expect(user).toContain(DOC);
    expect(user).toContain("add a project grid");
  });
  it("fetch init is a POST with a JSON body and NO credential (TEN-62)", () => {
    const init = buildFetchInit(payload);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });
  it("cannot send an Authorization header: there is no header but content-type", () => {
    // The signature is the guard. `buildFetchInit` takes no key, so no call
    // site can pass one, and the built headers are exactly one entry.
    expect(Object.keys(buildFetchInit(payload).headers as Record<string, string>)).toEqual([
      "Content-Type",
    ]);
    expect(buildFetchInit.length).toBe(1);
  });
});

describe("requestVibeCompletion (mocked fetch — no network)", () => {
  const payload = buildVibeRequest({
    model: "m",
    brief: "b",
    currentHtml: "<p>x</p>",
    userPrompt: "p",
  });

  it("POSTs to the chat endpoint and returns the assistant text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "reply-text" } }] }),
    });
    const text = await requestVibeCompletion(fetchMock, payload, BASE);
    expect(text).toBe("reply-text");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/chat/completions`);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("maps 401/429/other statuses to inline-safe OpenRouterError messages", async () => {
    const at = (status: number) =>
      requestVibeCompletion(
        vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) }),
        payload,
        BASE,
      );
    // 401 is no longer "check your key" — this browser has none. It means the
    // endpoint would not accept the SITTING.
    await expect(at(401)).rejects.toThrow(/401/);
    await expect(at(401)).rejects.toThrow(/sitting/i);
    await expect(at(401)).rejects.not.toThrow(/check the key/i);
    // 402 is the shared demo budget, which only exists now that somebody
    // else's key is paying.
    await expect(at(402)).rejects.toThrow(/budget/i);
    await expect(at(429)).rejects.toThrow(/429/);
    await expect(at(500)).rejects.toThrow(/500/);
    await expect(at(401)).rejects.toBeInstanceOf(OpenRouterError);
  });

  it("wraps network failures and malformed bodies", async () => {
    await expect(
      requestVibeCompletion(vi.fn().mockRejectedValue(new TypeError("offline")), payload, BASE),
    ).rejects.toThrow(/network/i);
    await expect(
      requestVibeCompletion(
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: 1 }) }),
        payload,
        BASE,
      ),
    ).rejects.toThrow(/no message content/i);
  });
});

describe("model list", () => {
  it("curated defaults track the current OpenRouter catalog", () => {
    expect(CURATED_MODELS).toEqual([
      "openai/gpt-4.1-nano",
      "openai/gpt-4.1-mini",
      "anthropic/claude-sonnet-5",
      "google/gemini-3.5-flash-lite",
      "deepseek/deepseek-v4-flash",
      "moonshotai/kimi-k3",
      "z-ai/glm-5.2:free",
    ]);
    expect(CURATED_MODELS.every((m) => m.includes("/"))).toBe(true);
  });
  it("parseModelsResponse extracts and sorts ids, tolerating junk", () => {
    expect(
      parseModelsResponse({ data: [{ id: "z/b" }, { id: "a/a" }, { nope: 1 }, { id: "" }] }),
    ).toEqual(["a/a", "z/b"]);
    expect(parseModelsResponse(null)).toEqual([]);
    expect(parseModelsResponse({ data: "x" })).toEqual([]);
  });
  it("fetchModelIds never throws (mocked fetch)", async () => {
    expect(await fetchModelIds(vi.fn().mockRejectedValue(new Error("x")), BASE)).toEqual([]);
    expect(
      await fetchModelIds(
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ id: "m/1" }] }) }),
        BASE,
      ),
    ).toEqual(["m/1"]);
  });
});

describe("the endpoint (the exam gateway, the demo proxy, a local server)", () => {
  it("normalizeBaseUrl trims and strips trailing slashes, and has NO default", () => {
    // The old default was `https://openrouter.ai/api/v1`, which worked only
    // because a key sat beside it in this browser. Empty must stay empty, or
    // "not connected" silently becomes "call the provider with no key".
    expect(normalizeBaseUrl(undefined)).toBe("");
    expect(normalizeBaseUrl(null)).toBe("");
    expect(normalizeBaseUrl("")).toBe("");
    expect(normalizeBaseUrl("   ")).toBe("");
    expect(normalizeBaseUrl("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
    expect(normalizeBaseUrl(" http://localhost:11434/v1// ")).toBe("http://localhost:11434/v1");
  });
  it("hasModelEndpoint is the connected predicate", () => {
    expect(hasModelEndpoint(undefined)).toBe(false);
    expect(hasModelEndpoint(null)).toBe(false);
    expect(hasModelEndpoint("  ")).toBe(false);
    expect(hasModelEndpoint("/")).toBe(false);
    expect(hasModelEndpoint(BASE)).toBe(true);
  });
  it("no module constant names the provider's own origin", async () => {
    const mod: Record<string, unknown> = await import("../src/openrouter.js");
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== "string") continue;
      expect({ name, namesProvider: value.includes("openrouter.ai") }).toEqual({
        name,
        namesProvider: false,
      });
    }
  });
  it("derives chat/models endpoints from any base", () => {
    expect(chatCompletionsUrl(BASE)).toBe(`${BASE}/chat/completions`);
    expect(chatCompletionsUrl("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    expect(modelsUrl("http://localhost:8000/v1/")).toBe("http://localhost:8000/v1/models");
  });
  it("the storage slot is declared", () => {
    expect(LLM_BASE_URL_STORAGE).toBe("ailx:llm-base-url");
  });
  it("requestVibeCompletion targets the given base and sends no credential", async () => {
    const payload = buildVibeRequest({ model: "kimi-k3", brief: "b", currentHtml: "<p/>", userPrompt: "p" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    await requestVibeCompletion(fetchMock, payload, "http://localhost:11434/v1/");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
  it("fetchModelIds targets the given base and sends no credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "kimi-k3" }] }),
    });
    expect(await fetchModelIds(fetchMock, "http://localhost:11434/v1")).toEqual(["kimi-k3"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/models");
    expect(init.headers).toBeUndefined();
  });
});

describe("clearLlmConnection", () => {
  const spy = () => {
    const removed: string[] = [];
    return { removed, removeItem: (k: string) => void removed.push(k) };
  };

  it("removes the endpoint slot — the only slot a connection now has", () => {
    const s = spy();
    clearLlmConnection(s);
    expect(s.removed).toEqual([LLM_BASE_URL_STORAGE]);
  });

  it("covers exactly the documented slot list, and it names no key", () => {
    expect(LLM_CONNECTION_KEYS).toEqual([LLM_BASE_URL_STORAGE]);
    expect(LLM_CONNECTION_KEYS.join(" ")).not.toContain("openrouter-key");
  });

  it("is a no-op for null/undefined storage (SSR, private mode)", () => {
    expect(() => clearLlmConnection(null)).not.toThrow();
    expect(() => clearLlmConnection(undefined)).not.toThrow();
  });

  it("never throws when a removal is blocked (private mode)", () => {
    expect(() =>
      clearLlmConnection({
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });

  it("leaves unrelated slots alone", () => {
    const store = new Map([
      [LLM_BASE_URL_STORAGE, "http://localhost:11434/v1"],
      ["ailx:attempt", "keep-me"],
    ]);
    clearLlmConnection({ removeItem: (k: string) => void store.delete(k) });
    expect([...store.keys()]).toEqual(["ailx:attempt"]);
  });
});
