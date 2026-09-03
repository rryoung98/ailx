// @vitest-environment jsdom
/**
 * Connection recovery (staging dogfood F3): a real-mode failure used to be a
 * dead end — the error was bare, and "Disconnect" cleared only the key while
 * the custom base URL kept realMode true, so every retry failed forever.
 *
 * Since TEN-62 there is no key to clear in either build: the connection IS the
 * endpoint, so the two-slot bug it was written for cannot recur by
 * construction. The affordances it pins — Retry, the offline fallback, no
 * duplicate echo — are what a candidate still needs mid-run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import { LLM_BASE_URL_STORAGE } from "../src/openrouter.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  },
});

const props = {
  attemptId: "a-1",
  locale: "en" as const,
  config: {},
  onEvent: () => {},
  onComplete: () => {},
  secondsRemaining: 600,
};

let root: Root | null = null;
let host: HTMLElement;

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Runner, props)));
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;
}

function click(label: string) {
  const btn = button(label);
  expect(btn, `button ${label}`).toBeTruthy();
  act(() => btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function type(text: string) {
  const el = host.querySelector('textarea[aria-label="Assist prompt"]') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Send a prompt and flush the (mocked) async call. */
async function send(text: string) {
  type(text);
  await act(async () => {
    button("Send")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const okReply = {
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: "```html\n<!doctype html><html><body>ok</body></html>\n```" } }] }),
};

beforeEach(() => {
  store.clear();
  // An endpoint and nothing else: since TEN-62 that IS the whole connection.
  store.set(LLM_BASE_URL_STORAGE, "https://ailx-shared-demo.vercel.app/api/v1");
  // GET /models is fired on mount in real mode; default to a rejection so
  // only the explicitly mocked call matters.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("T1 disconnect", () => {
  it("clears the endpoint and drops back to the demo assist", () => {
    mount();
    expect(button("Disconnect")).toBeTruthy();
    click("Disconnect");
    expect(store.get(LLM_BASE_URL_STORAGE)).toBeUndefined();
    expect(button("Disconnect")).toBeUndefined();
    expect(host.textContent).toContain("No model is connected");
  });

  it("is offered for any endpoint at all — there is never a key to have", () => {
    store.set(LLM_BASE_URL_STORAGE, "http://localhost:11434/v1");
    mount();
    expect(button("Disconnect")).toBeTruthy();
    click("Disconnect");
    expect(store.get(LLM_BASE_URL_STORAGE)).toBeUndefined();
  });

  it("survives storage whose removeItem throws — the state still resets", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: () => {},
        removeItem: () => { throw new Error("blocked"); },
        clear: () => {},
      },
    });
    try {
      mount();
      click("Disconnect");
      expect(button("Disconnect")).toBeUndefined();
      expect(host.textContent).toContain("No model is connected");
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});

describe("T1 real-mode failure affordance", () => {
  it("offers Retry and an offline fallback instead of a bare error", async () => {
    mount();
    await send("make the hero bolder");
    expect(host.textContent).toContain("Network error reaching the model endpoint.");
    expect(button("Retry")).toBeTruthy();
    expect(button("Use the offline demo assist")).toBeTruthy();
  });

  it("Retry re-issues the same prompt and clears the error on success", async () => {
    mount();
    await send("add a project grid");
    expect(button("Retry")).toBeTruthy();
    vi.stubGlobal("fetch", vi.fn(async () => okReply));
    await act(async () => {
      button("Retry")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(button("Retry")).toBeUndefined();
    expect(host.textContent).toContain("the preview re-rendered");
  });

  it("the offline fallback disconnects and answers the failed prompt with the simulator", async () => {
    mount();
    await send("give me a nav bar");
    click("Use the offline demo assist");
    expect(store.get(LLM_BASE_URL_STORAGE)).toBeUndefined();
    expect(button("Retry")).toBeUndefined();
    expect(host.textContent).toContain("demo assist");
    // The failed prompt is answered, not lost.
    expect(host.textContent).toContain("give me a nav bar");
  });

  it("does not echo the failed prompt a second time in the chat", async () => {
    // askVibe already rendered the "you" bubble before the call failed;
    // the offline answer must reuse it, not append a duplicate. The chat is
    // the candidate's read of a transcript they are told is a submission
    // artifact, so a doubled prompt reads as a doubled send.
    mount();
    await send("give me a nav bar");
    click("Use the offline demo assist");
    const echoes = [...host.querySelectorAll("div")].filter(
      (d) => d.textContent === "yougive me a nav bar",
    );
    expect(echoes).toHaveLength(1);
  });

  it("never tells a mid-track candidate to use the run start screen", () => {
    // That screen does not exist once a track is live: the old copy named
    // an action the candidate could not take.
    mount();
    click("Disconnect");
    expect(host.textContent).not.toContain("run start screen to use real vibe coding");
    expect(host.textContent).toContain("Code tab");
  });

  it("shows no retry affordance for the run budget cap (retrying cannot help)", async () => {
    mount();
    for (let i = 0; i < 10; i++) await send(`p${i}`);
    await send("one too many");
    expect(host.textContent).toContain("Run budget reached");
    expect(button("Retry")).toBeUndefined();
    expect(button("Use the offline demo assist")).toBeUndefined();
  });
});
