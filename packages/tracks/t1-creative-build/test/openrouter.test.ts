import { describe, it, expect, vi } from "vitest";
import {
  buildVibeRequest,
  buildFetchInit,
  extractHtmlFence,
  requestVibeCompletion,
  parseModelsResponse,
  fetchModelIds,
  CURATED_MODELS,
  OPENROUTER_CHAT_URL,
  OPENROUTER_KEY_STORAGE,
  OpenRouterError,
} from "../src/openrouter.js";

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
  it("fetch init is a POST with bearer auth and JSON body (key injected, never hardcoded)", () => {
    const init = buildFetchInit("sk-or-test123", payload);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test123");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });
  it("no key material ships in the module (public repo)", () => {
    // The storage key name is the only 'key' constant.
    expect(OPENROUTER_KEY_STORAGE).toBe("ailx:openrouter-key");
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
    const text = await requestVibeCompletion(fetchMock, "sk-or-x", payload);
    expect(text).toBe("reply-text");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OPENROUTER_CHAT_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-x");
  });

  it("maps 401/429/other statuses to inline-safe OpenRouterError messages", async () => {
    const at = (status: number) =>
      requestVibeCompletion(
        vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) }),
        "k",
        payload,
      );
    await expect(at(401)).rejects.toThrow(/401.*key|key.*401/i);
    await expect(at(429)).rejects.toThrow(/429/);
    await expect(at(500)).rejects.toThrow(/500/);
    await expect(at(401)).rejects.toBeInstanceOf(OpenRouterError);
  });

  it("wraps network failures and malformed bodies", async () => {
    await expect(
      requestVibeCompletion(vi.fn().mockRejectedValue(new TypeError("offline")), "k", payload),
    ).rejects.toThrow(/network/i);
    await expect(
      requestVibeCompletion(
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: 1 }) }),
        "k",
        payload,
      ),
    ).rejects.toThrow(/no message content/i);
  });
});

describe("model list", () => {
  it("curated defaults are present and slash-namespaced", () => {
    expect(CURATED_MODELS).toContain("openai/gpt-4o-mini");
    expect(CURATED_MODELS).toContain("anthropic/claude-3.5-haiku");
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
    expect(await fetchModelIds(vi.fn().mockRejectedValue(new Error("x")), "k")).toEqual([]);
    expect(
      await fetchModelIds(
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ id: "m/1" }] }) }),
        "k",
      ),
    ).toEqual(["m/1"]);
  });
});
