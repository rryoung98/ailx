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

async function mount(listing: () => unknown = () => ({ ok: true, json: async () => ({ items: [SUB] }) })) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/vote")) return { ok: true, json: async () => ({ ok: true }) };
    if (String(url).includes("/subs/")) return { ok: true, json: async () => DOC };
    return listing();
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

  it("labels the upvote, so its accessible name is not the string \"▲ 2\"", async () => {
    await mount();
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent!.includes("▲"))!;
    expect(btn.getAttribute("aria-label")).toBe("Upvote this set — 2 votes");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    await act(async () => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(btn.getAttribute("aria-label")).toBe("You upvoted this set — 3 votes");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("conveys the current sort with aria-pressed, not with colour alone", async () => {
    await mount();
    const sorts = [...host.querySelectorAll("button")].filter((b) => /^(Top|New)$/.test(b.textContent!));
    expect(sorts).toHaveLength(2);
    expect(sorts.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(sorts.every((b) => b.getAttribute("type") === "button")).toBe(true);
    await act(async () => sorts[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(sorts.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });

  it("offers a retry and a way onwards when the shared service is unreachable", async () => {
    let fail = true;
    await mount(() => {
      if (fail) throw new Error("network");
      return { ok: true, json: async () => ({ items: [SUB] }) };
    });
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/shared demo service did not answer/);
    expect(host.querySelector('a[href="/gallery"]')).toBeTruthy();
    // The retry actually re-fetches, rather than only clearing the message.
    fail = false;
    const retry = [...host.querySelectorAll("button")].find((b) => /Try again/.test(b.textContent!))!;
    await act(async () => retry.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="gallery-card"]')).toHaveLength(1);
  });

  it("uses the shared page shell, and an eyebrow class that exists", async () => {
    await mount();
    // `.kicker` is not defined in globals.css, so the old markup rendered the
    // wall's eyebrow as unstyled body text on a different left edge.
    expect(host.querySelector(".kicker")).toBeNull();
    expect(host.querySelector("main.page > .container > .eyebrow")).toBeTruthy();
  });
});
