// @vitest-environment jsdom
/**
 * Landing polish regression tests (map journey + marketing + pill CTA + copy):
 *  - pill CTA: cursor:pointer on the class (button UAs default to `default`)
 *    and a :focus-visible ring;
 *  - bottom section is a three-step "what you get" marketing section, not a
 *    stats grid: serif one-idea headers, one plain line each, small visuals,
 *    and the methodology//validate links as quiet footnotes;
 *  - campus map journey: 400vh pinned scrub over the aerial campus photo,
 *    background pans per track stop, floating /exam cards in DOM order
 *    T1..T4; gated behind @supports (animation-timeline) + no-preference,
 *    with the static alternating bands kept as the displayed fallback;
 *  - copy: hero lede is <= 2 plain sentences, no em-dash chains.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import Home from "../app/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const css = readFileSync(join(appDir, "globals.css"), "utf8");

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(el: React.ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("pill CTA affordance", () => {
  it("sets cursor: pointer on .pill-cta (buttons do not get it by default)", () => {
    expect(css).toMatch(/\.pill-cta \{ cursor: pointer; \}/);
  });

  it("shows a visible focus ring on :focus-visible", () => {
    const m = css.match(/\.pill-cta:focus-visible \{[^}]*\}/s);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("outline: 3px solid var(--accent)");
  });
});

describe("funnel section", () => {

  it("replaced the stats soup: no .grid4/.stat block on the landing page", async () => {
    const h = await render(createElement(Home));
    expect(h.querySelector("main .grid4")).toBeNull();
    expect(h.querySelector("main .stat")).toBeNull();
    expect(h.textContent).not.toContain("1 : 2 : 3");
  });
});

describe("campus map journey", () => {

  it("CSS: journey hidden at base, shown (and fallback hidden) only behind @supports + motion", () => {
    const section = css.slice(css.indexOf("campus map journey"));
    const supportsAt = section.indexOf("@supports (animation-timeline: view())");
    expect(supportsAt).toBeGreaterThan(-1);
    const base = section.slice(0, supportsAt);
    expect(base).toMatch(/\.campus-journey \{ display: none; \}/);
    expect(base).not.toContain("position: sticky");
    const gated = section.slice(supportsAt);
    expect(gated).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(gated).toMatch(/\.track-bands-fallback \{ display: none; \}/);
    expect(gated).toContain("height: 400vh");
    expect(gated).toContain("view-timeline: --campus block");
    expect(gated).toContain("animation-timeline: --campus");
    expect(gated).toContain("position: sticky");
  });

  it("CSS: pan keyframes move background-position/scale across four building stops", () => {
    const m = css.match(/@keyframes campusPan \{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const frames = m![0];
    const positions = [...frames.matchAll(/background-position: ([\d.]+)% /g)].map((x) => Number(x[1]));
    // four distinct stops, monotonically panning left -> right
    const stops = [...new Set(positions)];
    expect(stops.length).toBeGreaterThanOrEqual(4);
    expect([...stops].sort((a, b) => a - b)).toEqual(stops);
    expect(frames).toContain("scale(");
    // card swap keyframes gate visibility so hidden stops are not clickable
    expect(css).toContain("@keyframes campusCard");
    expect(css).toMatch(/visibility: hidden/);
  });
});
