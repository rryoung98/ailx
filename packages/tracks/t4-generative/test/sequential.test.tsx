// @vitest-environment jsdom
/**
 * T4 sequential-generation regression (user report: "typed 'chicken
 * nuggets' and got the same image again").
 *
 * 1. Two sequential REAL generations with different prompts must store
 *    distinct dataUris + prompts, and the NEWEST draft must render FIRST
 *    in the drafts gallery (it used to append below the fold).
 * 2. In demo mode, regenerating the SAME prompt must produce a fresh
 *    VARIATION (like a real model's sampling), never a pixel-identical
 *    repeat.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import { OPENROUTER_KEY_STORAGE } from "../src/imagegen.js";
import { generateImage } from "../src/imageModel.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
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

let reactRoot: Root | null = null;
afterEach(() => {
  if (reactRoot) act(() => reactRoot!.unmount());
  reactRoot = null;
  lsStore.clear();
  vi.unstubAllGlobals();
});

function mount(onCheckpoint: (s: unknown) => void = () => {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  reactRoot = createRoot(container);
  act(() =>
    reactRoot!.render(
      createElement(Runner, {
        attemptId: "a-1", locale: "en" as const, config: {},
        onEvent: () => {}, onComplete: () => {}, secondsRemaining: 3600, onCheckpoint,
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
const genBtn = (c: HTMLElement) =>
  [...c.querySelectorAll("button")].find((b) => (b.textContent ?? "").startsWith("Generate draft")) as HTMLButtonElement;
const flush = () => act(async () => {});

describe("T4 sequential generations", () => {
  it("real key: two prompts store two distinct dataUris and the NEWEST renders first", async () => {
    lsStore.set(OPENROUTER_KEY_STORAGE, "sk-test");
    const uris = ["data:image/png;base64,Zmlyc3Q=", "data:image/png;base64,c2Vjb25k"];
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        model: "served/m",
        choices: [{ message: { images: [{ image_url: { url: uris[call++] } }] } }],
      }),
    })));
    const cps: unknown[] = [];
    const c = mount((s) => cps.push(s));
    await flush();
    typePrompt(c, "a red boat");
    act(() => genBtn(c).click());
    await flush();
    typePrompt(c, "chicken nuggets");
    act(() => genBtn(c).click());
    await flush();

    const last = cps.at(-1) as { drafts: Array<{ dataUri?: string; prompt: string }> };
    expect(last.drafts).toHaveLength(2);
    expect(last.drafts[0].dataUri).not.toBe(last.drafts[1].dataUri);
    expect(last.drafts[1].prompt).toBe("chicken nuggets");
    expect(last.drafts[1].dataUri).toBe(uris[1]);

    // The drafts gallery renders NEWEST FIRST: the first draft <img> in the
    // drafts section is the chicken-nuggets image, labeled "latest".
    const draftsSection = c.querySelector('section[aria-label="Drafts"]')!;
    const imgs = [...draftsSection.querySelectorAll("img")];
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute("src")).toBe(uris[1]);
    expect(imgs[0].getAttribute("alt")).toContain("chicken nuggets");
    expect(draftsSection.textContent).toContain("latest");
  });

  it("demo mode: regenerating the SAME prompt yields a different variation image", async () => {
    const cps: unknown[] = [];
    const c = mount((s) => cps.push(s));
    await flush();
    typePrompt(c, "chicken nuggets");
    act(() => genBtn(c).click());
    await flush();
    act(() => genBtn(c).click());
    await flush();
    const last = cps.at(-1) as { drafts: Array<{ svg?: string; prompt: string }> };
    expect(last.drafts).toHaveLength(2);
    expect(last.drafts[0].svg).toBeTruthy();
    expect(last.drafts[0].svg).not.toBe(last.drafts[1].svg);
    // Deterministic variations: pure function of (prompt, nonce).
    expect(last.drafts[0].svg).toBe(generateImage("chicken nuggets", 0));
    expect(last.drafts[1].svg).toBe(generateImage("chicken nuggets", 1));
  });

  it("demo mode: two different prompts always differ", async () => {
    const cps: unknown[] = [];
    const c = mount((s) => cps.push(s));
    await flush();
    typePrompt(c, "a red boat");
    act(() => genBtn(c).click());
    await flush();
    typePrompt(c, "chicken nuggets");
    act(() => genBtn(c).click());
    await flush();
    const last = cps.at(-1) as { drafts: Array<{ svg?: string }> };
    expect(last.drafts[0].svg).not.toBe(last.drafts[1].svg);
  });
});
