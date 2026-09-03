// @vitest-environment jsdom
/**
 * Prompt-box behaviour (dogfood papercut 4): "Generate draft" left the
 * prompt in the box, so a second Enter silently generated the SAME draft
 * again. Submitting now clears the box and a repeated submit in the same
 * beat is a no-op — while a FAILED generation puts the text back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";

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

let root: Root | null = null;
let events: TrackEvent[] = [];

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  events = [];
  lsStore.clear();
  vi.unstubAllGlobals();
});

function mount() {
  const c = document.createElement("div");
  document.body.appendChild(c);
  root = createRoot(c);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-prompt",
        locale: "en" as const,
        config: {},
        onEvent: (e: TrackEvent) => events.push(e),
        onComplete: () => {},
        secondsRemaining: 3600,
        onCheckpoint: () => {},
      }),
    ),
  );
  return c;
}

function box(c: HTMLElement): HTMLTextAreaElement {
  return c.querySelector('textarea[aria-label="Image prompt"]') as HTMLTextAreaElement;
}

function typePrompt(c: HTMLElement, text: string) {
  const ta = box(c);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEnter(c: HTMLElement) {
  act(() => {
    box(c).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

function generateBtn(c: HTMLElement): HTMLButtonElement {
  return [...c.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").startsWith("Generate draft"),
  ) as HTMLButtonElement;
}

function draftCount(c: HTMLElement): number {
  return c.querySelector('section[aria-label="Drafts"]')!.querySelectorAll("img").length;
}

describe("T4 prompt box", () => {
  it("clears the prompt after a successful generation", async () => {
    const c = mount();
    await act(async () => {});
    typePrompt(c, "a lighthouse in fog");
    pressEnter(c);
    await act(async () => {});
    expect(box(c).value).toBe("");
    expect(draftCount(c)).toBe(1);
  });

  it("a second Enter in the same beat does not generate the draft twice", async () => {
    const c = mount();
    await act(async () => {});
    typePrompt(c, "a lighthouse in fog");
    act(() => {
      // Two keydowns before React can re-render: the old code read the same
      // stale prompt twice and produced two identical drafts.
      box(c).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      box(c).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(async () => {});
    expect(draftCount(c)).toBe(1);
    expect(events.filter((e) => e.object === "t4/draft")).toHaveLength(1);
  });

  it("a double click on Generate draft does not generate the draft twice", async () => {
    const c = mount();
    await act(async () => {});
    typePrompt(c, "a lighthouse in fog");
    act(() => {
      generateBtn(c).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      generateBtn(c).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(draftCount(c)).toBe(1);
  });

  it("submitting an empty (or whitespace-only) box does nothing", async () => {
    const c = mount();
    await act(async () => {});
    typePrompt(c, "   ");
    pressEnter(c);
    await act(async () => {});
    expect(draftCount(c)).toBe(0);
    expect(events.filter((e) => e.object === "t4/draft")).toHaveLength(0);
  });

  it("a genuinely new prompt still generates a second, different draft", async () => {
    const c = mount();
    await act(async () => {});
    typePrompt(c, "a lighthouse in fog");
    pressEnter(c);
    await act(async () => {});
    typePrompt(c, "a harbour at dawn");
    pressEnter(c);
    await act(async () => {});
    expect(draftCount(c)).toBe(2);
    expect(box(c).value).toBe("");
  });

  it("'Regenerate last' re-rolls the cleared prompt and is disabled with no drafts", async () => {
    const c = mount();
    await act(async () => {});
    const regen = () =>
      [...c.querySelectorAll("button")].find(
        (b) => (b.textContent ?? "").trim() === "Regenerate last",
      ) as HTMLButtonElement;
    expect(regen().disabled).toBe(true);
    typePrompt(c, "a lighthouse in fog");
    pressEnter(c);
    await act(async () => {});
    expect(regen().disabled).toBe(false);
    act(() => regen().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => {});
    expect(draftCount(c)).toBe(2);
    const drafts = events.filter((e) => e.object === "t4/draft");
    expect(drafts).toHaveLength(2);
    // Same prompt, different variation — the box stays empty.
    expect(box(c).value).toBe("");
  });

  it("puts the prompt back when a real generation fails", async () => {
    lsStore.set("ailx:llm-base-url", "https://exam.example/v1/model");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const c = mount();
    await act(async () => {});
    typePrompt(c, "a lighthouse in fog");
    pressEnter(c);
    await act(async () => {});
    expect(draftCount(c)).toBe(0);
    expect(box(c).value).toBe("a lighthouse in fog");
  });

  it("keeps freshly typed text instead of restoring a failed prompt over it", async () => {
    lsStore.set("ailx:llm-base-url", "https://exam.example/v1/model");
    let reject: (e: Error) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((_res, rej) => { reject = rej; })),
    );
    const c = mount();
    await act(async () => {});
    typePrompt(c, "a lighthouse in fog");
    pressEnter(c);
    await act(async () => {});
    typePrompt(c, "something else entirely");
    await act(async () => {
      reject(new Error("network down"));
    });
    expect(box(c).value).toBe("something else entirely");
  });
});
