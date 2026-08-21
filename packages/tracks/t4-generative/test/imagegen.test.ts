import { describe, expect, it, vi } from "vitest";
import {
  CURATED_IMAGE_MODELS,
  DRAFT_MAX_BYTES,
  ImageGenError,
  buildImageFetchInit,
  buildImageRequest,
  chatCompletionsUrl,
  chooseDraftAsset,
  dataUriByteSize,
  draftNeedsRecompress,
  normalizeBaseUrl,
  parseImageResponse,
  requestImage,
  OPENROUTER_KEY_STORAGE,
  LLM_BASE_URL_STORAGE,
} from "../src/imagegen.js";

const PNG_URI = "data:image/png;base64,aGVsbG8="; // "hello"

function okResponse(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function imageJson(url: string, model?: string) {
  return {
    ...(model ? { model } : {}),
    choices: [{ message: { content: "", images: [{ image_url: { url } }] } }],
  };
}

describe("t4 imagegen — request builder", () => {
  it("builds the verified OpenRouter image payload shape", () => {
    const p = buildImageRequest("a red boat", "google/gemini-3.1-flash-image");
    expect(p).toEqual({
      model: "google/gemini-3.1-flash-image",
      messages: [{ role: "user", content: "a red boat" }],
      modalities: ["image", "text"],
    });
  });

  it("adds a Bearer header only when a key is present", () => {
    const p = buildImageRequest("x", "m");
    const withKey = buildImageFetchInit(" sk-abc ", p);
    expect((withKey.headers as Record<string, string>).Authorization).toBe("Bearer sk-abc");
    const noKey = buildImageFetchInit("", p);
    expect((noKey.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(withKey.method).toBe("POST");
    expect(JSON.parse(String(withKey.body))).toEqual(p);
  });

  it("targets the OpenRouter chat-completions endpoint by default", () => {
    expect(chatCompletionsUrl()).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(chatCompletionsUrl("http://localhost:11434/v1/")).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    expect(normalizeBaseUrl("  ")).toBe("https://openrouter.ai/api/v1");
  });
});

describe("t4 imagegen — model catalog & shared storage slots", () => {
  it("curates the four verified image models", () => {
    expect(CURATED_IMAGE_MODELS).toEqual([
      "google/gemini-3.1-flash-image",
      "google/gemini-3.1-flash-lite-image",
      "openai/gpt-5-image-mini",
      "google/gemini-3-pro-image",
    ]);
  });

  it("reuses the exact localStorage slots T1 uses", () => {
    expect(OPENROUTER_KEY_STORAGE).toBe("ailx:openrouter-key");
    expect(LLM_BASE_URL_STORAGE).toBe("ailx:llm-base-url");
  });
});

describe("t4 imagegen — response parsing", () => {
  it("extracts the data URI and served model id", () => {
    const out = parseImageResponse(imageJson(PNG_URI, "google/gemini-3-pro-image"), "req/model");
    expect(out).toEqual({ dataUri: PNG_URI, modelId: "google/gemini-3-pro-image" });
  });

  it("falls back to the requested model id when the reply omits it", () => {
    const out = parseImageResponse(imageJson(PNG_URI), "req/model");
    expect(out.modelId).toBe("req/model");
  });

  it("maps a text-only reply to a refusal error carrying the text", () => {
    const json = { choices: [{ message: { content: "I can't generate that image." } }] };
    try {
      parseImageResponse(json, "m");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ImageGenError);
      expect((e as ImageGenError).kind).toBe("refusal");
      expect((e as ImageGenError).message).toContain("I can't generate that image.");
    }
  });

  it("maps an empty reply to no-image", () => {
    for (const json of [
      { choices: [{ message: { content: "" } }] },
      { choices: [{ message: { images: [] } }] },
      { choices: [] },
      {},
      null,
    ]) {
      try {
        parseImageResponse(json, "m");
        expect.unreachable();
      } catch (e) {
        expect((e as ImageGenError).kind).toBe("no-image");
      }
    }
  });

  it("rejects a non-image url shape", () => {
    const json = { choices: [{ message: { images: [{ image_url: { url: 42 } }] } }] };
    expect(() => parseImageResponse(json, "m")).toThrowError(ImageGenError);
  });
});

describe("t4 imagegen — requestImage error mapping", () => {
  const payload = buildImageRequest("p", "m");

  async function kindOf(fetchImpl: Parameters<typeof requestImage>[0]) {
    try {
      await requestImage(fetchImpl, "k", payload);
      return "ok";
    } catch (e) {
      return (e as ImageGenError).kind;
    }
  }

  it("maps 401 to auth with a user-facing message", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(requestImage(f, "k", payload)).rejects.toThrow(/rejected the key \(401\)/);
    expect(await kindOf(f)).toBe("auth");
  });

  it("maps 429 to rate-limit", async () => {
    const f = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await expect(requestImage(f, "k", payload)).rejects.toThrow(/rate limit/);
    expect(await kindOf(f)).toBe("rate-limit");
  });

  it("maps other statuses to http", async () => {
    const f = async () => ({ ok: false, status: 500, json: async () => ({}) });
    expect(await kindOf(f)).toBe("http");
  });

  it("maps a thrown fetch to network", async () => {
    const f = async () => {
      throw new Error("boom");
    };
    expect(await kindOf(f)).toBe("network");
  });

  it("maps unparseable JSON to bad-json", async () => {
    const f = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("nope");
      },
    });
    expect(await kindOf(f)).toBe("bad-json");
  });

  it("returns the image on success and sends the right request", async () => {
    const f = vi.fn(async () => okResponse(imageJson(PNG_URI, "served/model")));
    const out = await requestImage(f, "sk-key", payload, "http://localhost:1/v1");
    expect(out).toEqual({ dataUri: PNG_URI, modelId: "served/model" });
    expect(f).toHaveBeenCalledWith(
      "http://localhost:1/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("t4 imagegen — draft size guard (pure part of recompression)", () => {
  it("computes decoded base64 sizes", () => {
    expect(dataUriByteSize(PNG_URI)).toBe(5); // "hello"
    expect(dataUriByteSize("data:image/png;base64,aGVsbG9v")).toBe(6);
    expect(dataUriByteSize("data:image/svg+xml;utf8,<svg/>")).toBe(6);
    expect(dataUriByteSize("plain")).toBe(5);
  });

  it("flags only oversized images for recompression", () => {
    expect(draftNeedsRecompress(PNG_URI)).toBe(false);
    const big = "data:image/jpeg;base64," + "A".repeat(Math.ceil((DRAFT_MAX_BYTES + 4) / 3) * 4);
    expect(draftNeedsRecompress(big)).toBe(true);
  });

  it("keeps the recompressed copy only when it is a smaller valid image within the cap", () => {
    const original = "data:image/jpeg;base64," + "A".repeat(Math.ceil((DRAFT_MAX_BYTES + 4) / 3) * 4);
    const good = PNG_URI;
    expect(chooseDraftAsset(original, good)).toBe(good);
    // recompress failed → keep original
    expect(chooseDraftAsset(original, null)).toBe(original);
    // junk output → keep original
    expect(chooseDraftAsset(original, "not-a-data-uri")).toBe(original);
    // still over the cap → keep original
    const stillBig = "data:image/jpeg;base64," + "B".repeat(Math.ceil((DRAFT_MAX_BYTES + 100) / 3) * 4);
    expect(chooseDraftAsset(original, stillBig)).toBe(original);
    // "recompressed" grew → keep original
    expect(chooseDraftAsset(PNG_URI, "data:image/jpeg;base64," + "C".repeat(400))).toBe(PNG_URI);
  });

  it("recompressDataUri never throws — no-canvas environments resolve to null", async () => {
    const { recompressDataUri } = await import("../src/recompress.js");
    await expect(recompressDataUri(PNG_URI, 100)).resolves.toBeNull();
  });
});
