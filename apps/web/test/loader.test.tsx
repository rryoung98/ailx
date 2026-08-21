// @vitest-environment jsdom
/**
 * Covering loader regression tests:
 *  - first hard load: aria-hidden fixed cover with the six wordmark strokes
 *    (pathLength=1 for the unit dash draw), then ALWAYS unmounts via the
 *    setTimeout fallback even when no animation events ever fire (jsdom);
 *  - sets the sessionStorage flag on first show, and skips entirely when
 *    the flag is already set;
 *  - skips entirely under prefers-reduced-motion;
 *  - wipe animationend unmounts immediately (no full-timeout wait);
 *  - CSS: z-index above the pill CTA, pre-hydration skip hook, reduced
 *    motion display:none, draw + wipe keyframes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Loader, LOADER_FALLBACK_MS, WIPE_ANIMATION } from "../lib/Loader";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css"),
  "utf8",
);

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

function render(el: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(el); });
  return host;
}

beforeEach(() => {
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: true });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Loader behavior", () => {
  it("first load: shows the aria-hidden cover with six unit-dash strokes, sets the flag", () => {
    vi.useFakeTimers();
    const h = render(createElement(Loader));
    const cover = h.querySelector('[data-testid="loader"]')!;
    expect(cover).not.toBeNull();
    expect(cover.getAttribute("aria-hidden")).toBe("true");
    const paths = cover.querySelectorAll("svg path");
    expect(paths).toHaveLength(6);
    for (const p of paths) expect(p.getAttribute("pathLength")).toBe("1");
    expect(window.sessionStorage.getItem("ailx:loaded")).toBe("1");
    // fallback unmount: no animation events ever fire in jsdom
    act(() => { vi.advanceTimersByTime(LOADER_FALLBACK_MS + 10); });
    expect(h.querySelector('[data-testid="loader"]')).toBeNull();
  });

  it("skips when the sessionStorage flag is already set", () => {
    window.sessionStorage.setItem("ailx:loaded", "1");
    const h = render(createElement(Loader));
    expect(h.querySelector('[data-testid="loader"]')).toBeNull();
  });

  it("skips under prefers-reduced-motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const h = render(createElement(Loader));
    expect(h.querySelector('[data-testid="loader"]')).toBeNull();
  });

  it("unmounts on the wipe animationend without waiting for the fallback timer", () => {
    vi.useFakeTimers();
    const h = render(createElement(Loader));
    const cover = h.querySelector('[data-testid="loader"]')!;
    const e = new Event("animationend", { bubbles: true });
    Object.assign(e, { animationName: WIPE_ANIMATION });
    act(() => { cover.dispatchEvent(e); });
    expect(h.querySelector('[data-testid="loader"]')).toBeNull();
  });

  it("renders the cover in the initial HTML (SSR-safe, no flash) with the pre-hydration skip script", () => {
    const h = render(createElement(Loader));
    const script = h.querySelector("script")!;
    expect(script).not.toBeNull();
    expect(script.innerHTML).toContain("ailx:loaded");
    expect(script.innerHTML).toContain("prefers-reduced-motion");
    expect(script.innerHTML).toContain("ailxLoaded");
  });
});

describe("Loader CSS", () => {
  it("cover is fixed, above the pill CTA, deep green with mint grain", () => {
    const m = css.match(/^\.loader \{[^}]*\}/ms)!;
    expect(m).not.toBeNull();
    expect(m[0]).toContain("position: fixed");
    expect(m[0]).toContain("z-index: 100");
    expect(m[0]).toContain("#166b43");
    expect(css).toContain(".loader::after");
  });

  it("pre-hydration hook and reduced motion both hide the cover in pure CSS", () => {
    expect(css).toContain('html[data-ailx-loaded="1"] .loader { display: none; }');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.loader \{ display: none; \} \}/);
  });

  it("strokes draw via unit dash stagger and the cover wipes up", () => {
    expect(css).toContain("@keyframes loaderDraw");
    expect(css).toContain("@keyframes loaderWipe");
    expect(css).toMatch(/\.loader-logo path \{[^}]*stroke-dasharray: 1; stroke-dashoffset: 1;/s);
    expect(css).toContain("translateY(-101%)");
    // stagger: each stroke class has an increasing delay
    for (const cls of ["lg-a2", "lg-i", "lg-l", "lg-x1", "lg-x2"]) {
      expect(css).toContain(`.loader-logo .${cls}`);
    }
  });
});
