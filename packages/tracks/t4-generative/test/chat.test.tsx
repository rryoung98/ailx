// @vitest-environment jsdom
/**
 * T4 chat-style drafting — regression for "T4 gets the same chat styling
 * as T1" (ai-sdk-chatbot-inspired layout, no new dependency): the LEFT
 * pane is a conversation (brief pinned, prompt bubbles + generations with
 * the image INLINE, input at the bottom); the RIGHT pane keeps the
 * drafts/finals gallery.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  lsStore.clear();
});

function mount() {
  const c = document.createElement("div");
  document.body.appendChild(c);
  root = createRoot(c);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: {},
        onEvent: () => {},
        onComplete: () => {},
        secondsRemaining: 3600,
        onCheckpoint: () => {},
      }),
    ),
  );
  return c;
}

function typePrompt(c: HTMLElement, text: string) {
  const ta = c.querySelector('textarea[aria-label="Image prompt"]') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("T4 chat drafting pane", () => {
  it("renders the conversation pane with the brief pinned and the gallery on the right", () => {
    const c = mount();
    const pane = c.querySelector('section[aria-label="Prompt"]')!;
    expect(pane).not.toBeNull();
    expect(pane.querySelector('[role="note"][aria-label="Brief"]')).not.toBeNull();
    expect(pane.querySelector('[role="log"][aria-label="Generation conversation"]')).not.toBeNull();
    expect(pane.querySelector('textarea[aria-label="Image prompt"]')).not.toBeNull();
    // Gallery panes survive on the right.
    expect(c.querySelector('section[aria-label="Finals"]')).not.toBeNull();
    expect(c.querySelector('section[aria-label="Drafts"]')).not.toBeNull();
  });

  it("a generation appears as a user bubble + an assistant message with the image INLINE", async () => {
    const c = mount();
    await act(async () => {});
    typePrompt(c, "three boats on a wave");
    const gen = [...c.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").startsWith("Generate draft"),
    )!;
    act(() => gen.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => {});
    const log = c.querySelector('[role="log"][aria-label="Generation conversation"]')!;
    expect(log.textContent).toContain("you");
    expect(log.textContent).toContain("three boats on a wave");
    expect(log.textContent).toContain("draft #1");
    const img = log.querySelector("img");
    expect(img, "the generated image renders inline in the chat").not.toBeNull();
    expect(img!.getAttribute("alt")).toContain("three boats on a wave");
    // And it still lands in the right-hand drafts gallery too.
    expect(c.querySelector('section[aria-label="Drafts"]')!.querySelectorAll("img").length).toBe(1);
  });
});
