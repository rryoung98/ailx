// @vitest-environment jsdom
/**
 * T4 real-image runner integration — regression tests for the OpenRouter
 * hookup: with a key in the SHARED localStorage slot, "Generate draft"
 * calls the real endpoint, stores the returned dataUri on the draft, and
 * logs the ACTUAL served model id; errors surface inline; without a key
 * the deterministic demo path is unchanged (demo model id logged).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import { OPENROUTER_KEY_STORAGE, CURATED_IMAGE_MODELS } from "../src/imagegen.js";
import { IMAGE_MODEL_ID } from "../src/imageModel.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// This jsdom build ships no localStorage — install a minimal in-memory shim
// (the Runner reads the shared BYOK slot through it).
const lsStore = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, String(v)),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
  },
});

const PNG_URI = "data:image/png;base64,aGVsbG8=";

let reactRoot: Root | null = null;
afterEach(() => {
  if (reactRoot) act(() => reactRoot!.unmount());
  reactRoot = null;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});
beforeEach(() => window.localStorage.clear());

function mount(onEvent: (e: TrackEvent) => void, onCheckpoint: (s: unknown) => void = () => {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  reactRoot = createRoot(container);
  act(() =>
    reactRoot!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: {},
        onEvent,
        onComplete: () => {},
        secondsRemaining: 3600,
        onCheckpoint,
      }),
    ),
  );
  return container;
}

function typePrompt(c: HTMLElement, text: string) {
  const ta = c.querySelector('textarea[aria-label="Image prompt"]') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function generateButton(c: HTMLElement): HTMLButtonElement {
  return [...c.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").startsWith("Generate draft"),
  ) as HTMLButtonElement;
}

const flush = () => act(async () => {});

describe("T4 runner — real OpenRouter image generation", () => {
  it("with a stored key, generate calls the endpoint and stores the dataUri + served model id", async () => {
    window.localStorage.setItem(OPENROUTER_KEY_STORAGE, "sk-test");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "served/image-model",
        choices: [{ message: { images: [{ image_url: { url: PNG_URI } }] } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const events: TrackEvent[] = [];
    const checkpoints: unknown[] = [];
    const c = mount((e) => events.push(e), (s) => checkpoints.push(s));
    await flush();
    expect(c.textContent).toContain(CURATED_IMAGE_MODELS[0]);
    typePrompt(c, "a red boat");
    act(() => generateButton(c).click());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(CURATED_IMAGE_MODELS[0]);
    expect(body.modalities).toEqual(["image", "text"]);
    // Draft shows the REAL image and events carry the served model id.
    const img = c.querySelector(`img[src="${PNG_URI}"]`);
    expect(img).not.toBeNull();
    const gen = events.find((e) => e.object === "t4/draft");
    expect(gen?.result).toMatchObject({ modelId: "served/image-model" });
    // Checkpoint stores what was actually shown.
    const last = checkpoints.at(-1) as { drafts: Array<{ dataUri?: string; modelId?: string }> };
    expect(last.drafts[0].dataUri).toBe(PNG_URI);
    expect(last.drafts[0].modelId).toBe("served/image-model");
  });

  it("surfaces a refusal inline and records no draft", async () => {
    window.localStorage.setItem(OPENROUTER_KEY_STORAGE, "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "I cannot draw that." } }] }),
      })),
    );
    const events: TrackEvent[] = [];
    const c = mount((e) => events.push(e));
    await flush();
    typePrompt(c, "something refused");
    act(() => generateButton(c).click());
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain("I cannot draw that.");
    expect(events.find((e) => e.object === "t4/draft")).toBeUndefined();
  });

  it("without a key, the demo path is unchanged and logs the demo model id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const events: TrackEvent[] = [];
    const c = mount((e) => events.push(e));
    await flush();
    expect(c.textContent).toContain("demo simulator");
    typePrompt(c, "a red boat");
    act(() => generateButton(c).click());
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    const gen = events.find((e) => e.object === "t4/draft");
    expect(gen?.result).toMatchObject({ modelId: IMAGE_MODEL_ID });
  });
});
