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

describe("what-you-get marketing section", () => {
  it("renders exactly three steps with the serif one-idea headers", async () => {
    const h = await render(createElement(Home));
    const steps = h.querySelectorAll(".wyg-steps .wyg-step");
    expect(steps).toHaveLength(3);
    const titles = [...h.querySelectorAll(".wyg-title")].map((t) => t.textContent);
    expect(titles).toEqual([
      "Play the four tracks.",
      "Get one honest score.",
      "Share a report that proves itself.",
    ]);
    // one plain supporting line + one decorative visual per step
    expect(h.querySelectorAll(".wyg-line")).toHaveLength(3);
    const vizzes = h.querySelectorAll(".wyg-viz");
    expect(vizzes).toHaveLength(3);
    for (const v of vizzes) expect(v.getAttribute("aria-hidden")).toBe("true");
  });

  it("replaced the stats soup: no .grid4/.stat block on the landing page", async () => {
    const h = await render(createElement(Home));
    expect(h.querySelector("main .grid4")).toBeNull();
    expect(h.querySelector("main .stat")).toBeNull();
    expect(h.textContent).not.toContain("1 : 2 : 3");
  });

  it("keeps the methodology and /validate links as quiet footnotes", async () => {
    const h = await render(createElement(Home));
    const foot = h.querySelector(".wyg-footnotes")!;
    expect(foot).not.toBeNull();
    const hrefs = [...foot.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/methodology", "/validate"]);
  });
});

describe("campus map journey", () => {
  it("renders four floating /exam cards in DOM order T1..T4 inside the pinned stage", async () => {
    const h = await render(createElement(Home));
    const journey = h.querySelector(".campus-journey")!;
    expect(journey).not.toBeNull();
    const cards = [...journey.querySelectorAll("a.campus-card")];
    expect(cards).toHaveLength(4);
    for (const a of cards) expect(a.getAttribute("href")).toBe("/exam");
    expect(cards.map((c) => c.querySelector(".campus-card-code")!.textContent)).toEqual([
      "T1", "T2", "T3", "T4",
    ]);
    expect(cards.map((c) => c.classList.contains(`campus-stop-${cards.indexOf(c) + 1}`))).toEqual([
      true, true, true, true,
    ]);
    // each stop carries a mini scene slot (three.js when WebGL, CSS otherwise)
    for (const c of cards) expect(c.querySelector(".campus-card-viz .track-scene")).not.toBeNull();
  });

  it("pans the aerial campus photo as the background layer", async () => {
    const h = await render(createElement(Home));
    const map = h.querySelector<HTMLElement>(".campus-journey .campus-map")!;
    expect(map).not.toBeNull();
    expect(map.getAttribute("aria-hidden")).toBe("true");
    expect(map.style.backgroundImage).toContain("/media/campus-map.jpg");
    expect(h.querySelector(".campus-journey .campus-scrim")).not.toBeNull();
  });

  it("keeps the static alternating bands in the DOM as the fallback", async () => {
    const h = await render(createElement(Home));
    const fallback = h.querySelector(".track-bands-fallback")!;
    expect(fallback).not.toBeNull();
    expect(fallback.querySelectorAll(".track-band")).toHaveLength(4);
  });

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

describe("declauded landing copy", () => {
  it("hero lede is at most two plain sentences with no em dashes", async () => {
    const h = await render(createElement(Home));
    const lede = h.querySelector(".hero-lede")!.textContent!.trim();
    expect(lede).not.toContain("\u2014");
    const sentences = lede.split(/[.!?]+\s*/).filter(Boolean);
    expect(sentences.length).toBeLessThanOrEqual(2);
    expect(lede.length).toBeLessThan(160);
  });

  it("landing page carries no marketing puffery or stats soup", async () => {
    const h = await render(createElement(Home));
    const text = h.textContent!;
    for (const banned of ["trilateral", "audit-grade", "specification,"]) {
      expect(text).not.toContain(banned);
    }
  });
});
