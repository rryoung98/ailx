// @vitest-environment jsdom
/**
 * /wall community wall: renders shared sets from the service, upvote is
 * optimistic + deduped via localStorage; votes are labeled as non-score.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import WallPage from "../app/wall/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  },
  configurable: true,
});

const SUB = { id: "abc123", url: "https://blob/subs/abc123.json", votes: 2 };
const DOC = { images: ["https://blob/img/abc123-0.png"], note: "one idea, three distances", model: "google/gemini-3.1-flash-image", ts: "2026-08-21T00:00:00Z" };

let root: Root | null = null;
let host: HTMLElement;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  store.clear();
  vi.unstubAllGlobals();
});

async function mount() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/vote")) return { ok: true, json: async () => ({ ok: true }) };
    if (String(url).includes("/subs/")) return { ok: true, json: async () => DOC };
    return { ok: true, json: async () => ({ items: [SUB] }) };
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(WallPage)));
  await act(async () => { await Promise.resolve(); });
}

describe("gallery wall", () => {
  it("renders shared sets with note, model, votes, and the non-score disclosure", async () => {
    await mount();
    expect(host.querySelectorAll('[data-testid="gallery-card"]')).toHaveLength(1);
    expect(host.textContent).toContain("one idea, three distances");
    expect(host.textContent).toContain("▲ 2");
    expect(host.textContent).toContain("never part of the score");
  });

  it("upvote is optimistic and deduped", async () => {
    await mount();
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent!.includes("▲"))!;
    await act(async () => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(btn.textContent).toContain("3");
    await act(async () => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(btn.textContent).toContain("3"); // no double vote
    expect(JSON.parse(store.get("ailx:gallery-voted")!)).toContain("abc123");
  });
});
