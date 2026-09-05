// @vitest-environment jsdom
/**
 * Covering loader regression tests:
 *  - first hard load: aria-hidden fixed cover with the traced two-tone
 *    wordmark, served as ONE shared asset (public/media/loader-mark.svg,
 *    same traced paths as the header logo) rather than ~14 kB of inline
 *    path data in the layout JS and every prerendered page, then ALWAYS
 *    unmounts via the
 *    setTimeout fallback even when no animation events ever fire (jsdom);
 *  - sets the sessionStorage flag on first show, and skips entirely when
 *    the flag is already set;
 *  - skips entirely under prefers-reduced-motion;
 *  - wipe animationend unmounts immediately (no full-timeout wait);
 *  - the asset: shares its path data with media/logo.svg, carries its own
 *    two-tone fill + staggered fade, resolves under both basePath modes;
 *  - CSS: z-index above the pill CTA, pre-hydration skip hook, reduced
 *    motion display:none, wipe keyframes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Loader, LOADER_FALLBACK_MS, LOADER_MARK, WIPE_ANIMATION } from "../components/Loader";

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
  it("first load: shows the aria-hidden cover with the two-tone wordmark, sets the flag", () => {
    vi.useFakeTimers();
    const h = render(createElement(Loader));
    const cover = h.querySelector('[data-testid="loader"]')!;
    expect(cover).not.toBeNull();
    expect(cover.getAttribute("aria-hidden")).toBe("true");
    // Traced wordmark: an <img> to the shared asset, decorative (empty alt).
    const mark = cover.querySelector("img")!;
    expect(mark).not.toBeNull();
    expect(mark.getAttribute("src")).toBe(`/ailx${LOADER_MARK}`);
    expect(mark.getAttribute("alt")).toBe("");
    expect(cover.querySelector("svg")).toBeNull();
    expect(window.sessionStorage.getItem("foray:loaded")).toBe("1");
    // fallback unmount: no animation events ever fire in jsdom
    act(() => { vi.advanceTimersByTime(LOADER_FALLBACK_MS + 10); });
    expect(h.querySelector('[data-testid="loader"]')).toBeNull();
  });

  it("skips when the sessionStorage flag is already set", () => {
    window.sessionStorage.setItem("foray:loaded", "1");
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
    expect(script.innerHTML).toContain("foray:loaded");
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

  it("sizes the wordmark and wipes the cover up", () => {
    expect(css).toContain("@keyframes loaderWipe");
    expect(css).toContain("translateY(-101%)");
    expect(css).toMatch(/\.loader-logo \{[^}]*width: min\(280px, 56vw\)/s);
    // The fade now lives inside the asset; no dead rules left behind.
    expect(css).not.toContain("loaderFade");
    expect(css).not.toContain("lg-fill");
  });
});

describe("loader wordmark asset", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const read = (f: string) => readFileSync(join(dir, "..", "public", "media", f), "utf8");
  const mark = read("loader-mark.svg");
  const logo = read("logo.svg");
  const paths = (svg: string) => Array.from(svg.matchAll(/<path d="(.*?)"/gs), (m) => m[1]);

  it("is the SAME traced art as the header logo (one source of truth)", () => {
    expect(paths(mark)).toEqual(paths(logo));
    expect(paths(mark)).toHaveLength(2);
    expect(mark).toContain('viewBox="1610 4350 8490 3580"');
    expect(logo).toContain('viewBox="1610 4350 8490 3580"');
  });

  it("carries its own two-tone fill and staggered fade (page CSS cannot reach it)", () => {
    expect(mark).toMatch(/\.lg-ail \{[^}]*fill: #f7f4f2/s);
    expect(mark).toMatch(/\.lg-x \{[^}]*fill: #b7f0cd/s);
    expect(mark).toMatch(/\.lg-x \{[^}]*animation-delay: 220ms/s);
    expect(mark).toContain("@keyframes loaderFade");
    // `both` (not `forwards`): if animations never run the mark stays visible.
    expect(mark).toMatch(/\.lg-fill \{[^}]*animation: loaderFade 460ms ease both/s);
    // opacity-only — a CSS transform would override the groups' scale(1,-1)
    // attribute flip and render the wordmark upside down.
    const fade = mark.slice(mark.indexOf("@keyframes loaderFade"));
    expect(fade.slice(0, fade.indexOf("}}") + 2)).not.toContain("transform");
    expect(mark).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("stays out of the JS bundle and the prerendered HTML", () => {
    const source = readFileSync(join(dir, "..", "components", "Loader.tsx"), "utf8");
    expect(source.length).toBeLessThan(4000);
    expect(source).not.toMatch(/ 8214 c-29 /); // no traced path literal
    const html = renderToStaticMarkup(createElement(Loader));
    expect(html.length).toBeLessThan(1000);
    expect(html).toContain(`${LOADER_MARK}`);
  });
});

describe("loader asset URL under both build modes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefixes the Pages basePath in the static export", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/ailx");
    expect(renderToStaticMarkup(createElement(Loader)))
      .toContain(`src="/ailx${LOADER_MARK}"`);
  });

  it("uses a bare root path in the hosted (server-mode) build", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    expect(renderToStaticMarkup(createElement(Loader)))
      .toContain(`src="${LOADER_MARK}"`);
  });

  it("honors a custom basePath", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/x");
    expect(renderToStaticMarkup(createElement(Loader)))
      .toContain(`src="/x${LOADER_MARK}"`);
  });
});
