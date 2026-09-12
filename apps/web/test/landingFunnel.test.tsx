// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import Home from "../app/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function render(): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Home)); });
  return host;
}

/** Every href on the page, in DOM order. */
function hrefs(h: HTMLElement): string[] {
  return [...h.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!);
}

describe("the short-test entry", () => {
  it("makes the test the first action, with activity and practice still reachable", async () => {
    const h = await render();
    expect(hrefs(h)[0]).toBe("/test");
    expect(hrefs(h)).toContain("/me");
    expect(hrefs(h)).toContain("/practice");
    expect(hrefs(h)).toContain("/mission");
    expect(h.querySelectorAll("h1")).toHaveLength(1);
    expect(h.querySelector("canvas")).toBeNull();
  });
  it("keeps the promise brief and identifies the public scenario", async () => {
    const h = await render();
    expect(h.textContent).toContain("4–5 minutes");
    expect(h.textContent).toContain("public scenario demo");
    expect(h.textContent?.split(/\s+/).length).toBeLessThan(180);
  });
});

describe("funnel order", () => {

  it("never asks for an account before the game", async () => {
    // The front door is the game. The one sign-in affordance in the app is a
    // nav link (lib/auth/AuthNav.tsx); the landing page itself must not put
    // an account between a visitor and the first card.
    const h = await render();
    expect(hrefs(h)).not.toContain("/sign-in");
    expect(hrefs(h)).not.toContain("/sign-up");
    expect(h.textContent).toMatch(/no account/i);
  });
});

describe("nothing on the front door implies a score", () => {
  const NUMBERS = /\b\d+(\.\d+)?\s*(%|th percentile|\/\s*100)\b/i;
  const CLAIMS = /percentile|average score|top \d|better than \d|ranked|norm(ed|ative)\b/i;

  it("states no percentile, norm or cohort comparison in either build", async () => {
    for (const backend of [undefined, "1"]) {
      if (backend !== undefined) {
        vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", backend);
        vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
      }
      const h = await render();
      const text = h.textContent!;
      expect(text).not.toMatch(NUMBERS);
      expect(text).not.toMatch(CLAIMS);
      if (root) act(() => root!.unmount());
      host?.remove();
      root = null;
      host = null;
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});

/**
 * The phone front door. jsdom has no layout engine, so what is checkable
 * here is the DOM contract and the stylesheet text; the GEOMETRY of the same
 * three fixes (64px header, no paper over the lede, the answer buttons on
 * the first screen) is asserted in a real browser by
 * apps/web/e2e/visual.spec.ts. See FRONTEND.md §6.7.
 */
describe("the front door on a 390px phone", () => {
  const cssText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css"), "utf8");

  it("the drifting paper is hidden on a phone, where it printed over the lede", () => {
    const block = cssText.match(/@media \(max-width: 700px\) \{\s*\.hero-artifacts \{ display: none; \}/);
    expect(block).not.toBeNull();
  });

  it("no rule ever wraps the nav back into a second row", () => {
    // The compact row is built in the 640px block; a later `flex-wrap: wrap`
    // on .site-nav won by source order and put the Play pill on its own
    // line, which is exactly the 130px of chrome this replaced.
    for (const rule of cssText.match(/\.site-nav \{[^}]*\}/g) ?? []) {
      expect(rule).not.toMatch(/flex-wrap:\s*wrap/);
    }
    expect(cssText).toMatch(/\.site-header \.inner \{ flex-wrap: nowrap;/);
    expect(cssText).toMatch(/\.nav-links \{[^}]*overflow-x: auto/s);
  });

  it("hides the hand-written aside with enough specificity to actually win", () => {
    // `span.hero-fade { display: inline-block }` is (0,1,1); a bare
    // `.hero-annotation` (0,1,0) lost to it and the rule was dead CSS.
    expect(cssText).toMatch(/\.hero-copy span\.hero-annotation \{ display: none; \}/);
  });
});
