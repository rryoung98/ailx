// @vitest-environment jsdom
/**
 * Scroll cinema regression tests:
 *  - pinned scrubbed hero keeps a sane structure: one h1, aria-hidden
 *    phase-B copy, aria-hidden parallax artifacts, staggered .hero-line spans;
 *  - CSS gates the pin behind @supports (animation-timeline) AND
 *    prefers-reduced-motion: no-preference; the base path collapses to
 *    static phase A (phase B display:none — no CLS, no double headline);
 *  - annotations self-draw (pathLength="1" + dash scrub), fully drawn under
 *    reduced motion;
 *  - every product surface carries show-on-scroll reveals, and rule-row
 *    lists reveal row-by-row with stagger vars.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import Home from "../app/page";
import Methodology from "../app/methodology/page";
import { Annotation } from "../lib/Annotation";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const css = readFileSync(join(appDir, "globals.css"), "utf8");
const src = (rel: string) => readFileSync(join(appDir, rel), "utf8");

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

describe("pinned scrubbed hero structure", () => {
  it("keeps exactly one h1 in the DOM; phase-B copy is aria-hidden", async () => {
    const h = await render(createElement(Home));
    expect(h.querySelectorAll("h1")).toHaveLength(1);
    const phaseB = h.querySelector(".hero-phase-b");
    expect(phaseB).not.toBeNull();
    expect(phaseB!.getAttribute("aria-hidden")).toBe("true");
    expect(phaseB!.textContent).toContain("Benchmarks are a hundred numbers.");
    expect(phaseB!.textContent).toContain("one score");
    expect(phaseB!.querySelector(".script-accent")?.textContent).toBe("one");
  });

  it("nests the sticky stage inside the scrub wrapper, hero phase A inside the stage", async () => {
    const h = await render(createElement(Home));
    const stage = h.querySelector(".hero-cinema > .hero-stage");
    expect(stage).not.toBeNull();
    expect(stage!.querySelector(".hero.hero-phase-a")).not.toBeNull();
  });

  it("splits the headline into staggered .hero-line spans inside the single h1", async () => {
    const h = await render(createElement(Home));
    const lines = h.querySelectorAll("h1 .hero-line");
    expect(lines).toHaveLength(2);
    expect(h.querySelector(".hero-line-1")).not.toBeNull();
    expect(h.querySelector(".hero-line-2")).not.toBeNull();
  });

  it("renders >= 3 aria-hidden parallax paper artifacts (pure SVG/CSS)", async () => {
    const h = await render(createElement(Home));
    const wrap = h.querySelector(".hero-artifacts");
    expect(wrap).not.toBeNull();
    expect(wrap!.getAttribute("aria-hidden")).toBe("true");
    expect(wrap!.querySelectorAll(".hero-artifact").length).toBeGreaterThanOrEqual(3);
    expect(wrap!.querySelector("img")).toBeNull(); // no raster assets
  });
});

describe("scroll cinema CSS gating", () => {
  const cinemaBlock = css.slice(css.indexOf("scroll cinema: pinned scrubbed hero"));

  it("collapses to static phase A without scroll timelines (no pin, no phase B)", () => {
    // Base declarations come BEFORE the @supports block, so unsupporting
    // browsers get normal flow and display:none phase B/artifacts.
    const supportsAt = cinemaBlock.indexOf("@supports (animation-timeline: view())");
    const base = cinemaBlock.slice(0, supportsAt);
    expect(base).toMatch(/\.hero-phase-b \{ display: none; \}/);
    expect(base).toMatch(/\.hero-artifacts \{ display: none; \}/);
    expect(base).not.toContain("240vh");
  });

  it("gates the 240vh pin behind @supports AND prefers-reduced-motion: no-preference", () => {
    const supportsAt = cinemaBlock.indexOf("@supports (animation-timeline: view())");
    expect(supportsAt).toBeGreaterThan(-1);
    const gated = cinemaBlock.slice(supportsAt);
    const media = gated.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(media).toBeGreaterThan(-1);
    const inner = gated.slice(media);
    expect(inner).toContain("height: 185vh");
    expect(inner).toContain("view-timeline: --hero-scrub block");
    expect(inner).toContain("position: sticky");
    expect(inner).toContain("animation-timeline: --hero-scrub");
  });

  it("keeps a reduced-motion kill switch for every hero animation", () => {
    expect(css).toMatch(
      /\.hero-line, \.hero-fade, \.hero-stage, \.hero-artifact, \.desk-panel \{ animation: none !important; \}/,
    );
  });
});

describe("self-drawing annotations", () => {
  it("annotation arrow paths carry pathLength=1 so the dash scrub is unit-normalized", async () => {
    const h = await render(createElement(Annotation, null, "note"));
    const paths = h.querySelectorAll(".annotation svg path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const p of paths) expect(p.getAttribute("pathLength")).toBe("1");
  });

  it("CSS scrubs the stroke on a view timeline and fully draws it under reduced motion", () => {
    expect(css).toContain("annotationDraw");
    expect(css).toMatch(/stroke-dasharray: 1; stroke-dashoffset: 1;/);
    // The reduce block immediately after annotationDraw fully draws the arrow
    // (ordering-independent of later sections' own reduce blocks).
    const reduce = css.slice(css.indexOf("@keyframes annotationDraw"));
    expect(reduce).toContain("stroke-dashoffset: 0");
  });
});

describe("site-wide show-on-scroll coverage", () => {
  it("landing: stats section and every track band reveal on scroll", async () => {
    const h = await render(createElement(Home));
    expect(h.querySelectorAll("main .reveal").length).toBeGreaterThanOrEqual(5);
    const bands = h.querySelectorAll(".track-bands .reveal .track-band");
    expect(bands).toHaveLength(4);
  });

  it("methodology: each of the four chapters is a .reveal section", async () => {
    const h = await render(createElement(Methodology));
    const sections = h.querySelectorAll("section.reveal");
    expect(sections.length).toBeGreaterThanOrEqual(4);
    for (const id of ["construct", "psychometrics", "judges", "modularity"]) {
      expect(h.querySelector(`section.reveal #${id}`)).not.toBeNull();
    }
  });

  it("exam start screen: rule rows reveal row-by-row via the Reveal li wrapper", () => {
    const s = src(join("exam", "page.tsx"));
    expect(s).toContain('<Reveal as="li"');
    expect(s).toContain('<Reveal as="section">');
  });

  it("report: identity, track cards and the export section reveal", () => {
    const s = src(join("report", "page.tsx"));
    expect(s).toContain('<Reveal as="div" className="card" key={t}');
    expect(s).toContain('<Reveal as="section" className="card ptype-card"');
    expect(s).toContain('<Reveal as="section">');
    // The "What the log says about you" cards are gone on purpose: they
    // restated <Diagnosis>'s "How you worked" notes, which are a superset.
    expect(s).not.toContain("narratives(");
  });

  it("validate: check rows and the explainer section reveal", () => {
    const s = src(join("validate", "page.tsx"));
    expect(s).toContain('<Reveal as="li"');
    expect(s).toContain('<Reveal as="section">');
    // showcase wave: checks render as reveal-wrapped cards in the 2-col grid
    expect(s).toContain('className="check-grid"');
    expect(s).toContain('className="check-card"');
  });

  it("rule rows carry per-row stagger vars for both reveal paths", () => {
    expect(css).toMatch(/\.rule-rows > li:nth-child\(2\).*--reveal-shift: 5%; --reveal-delay: 90ms;/);
    expect(css).toContain("animation-range: entry var(--reveal-shift, 0%) entry calc(42% + var(--reveal-shift, 0%))");
    expect(css).toContain("transition-delay: var(--reveal-delay, 0ms)");
  });
});

describe("expanding desk panel (full-bleed scrub)", () => {
  it("renders the desk image as decorative: empty alt, aria-hidden panel, lazy, sized (no CLS)", async () => {
    const h = await render(createElement(Home));
    const panel = h.querySelector(".desk-cinema .desk-panel");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("aria-hidden")).toBe("true");
    const img = panel!.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBe("1600");
    expect(img.getAttribute("height")).toBe("872");
    expect(panel!.querySelector(".desk-scrim")).not.toBeNull();
  });

  it("floats the quote and four track cards over the panel, each revealing on scroll", async () => {
    const h = await render(createElement(Home));
    const overlay = h.querySelector(".desk-cinema .desk-overlay")!;
    expect(overlay.querySelector(".desk-quote")).not.toBeNull();
    expect(overlay.querySelectorAll(".desk-card")).toHaveLength(4);
    expect(overlay.querySelectorAll(".reveal").length).toBeGreaterThanOrEqual(5);
  });

  it("gates the expand-to-full-bleed scrub and the sticky overlap behind @supports + motion", () => {
    const desk = css.slice(css.indexOf("scroll cinema: expanding desk panel"));
    const supportsAt = desk.indexOf("@supports (animation-timeline: view())");
    expect(supportsAt).toBeGreaterThan(-1);
    const base = desk.slice(0, supportsAt);
    expect(base).toContain("width: min(70%, 980px)"); // static rounded fallback
    expect(base).not.toContain("position: sticky");
    const gated = desk.slice(supportsAt);
    expect(gated).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(gated).toContain("view-timeline: --desk block");
    expect(gated).toContain("animation-timeline: --desk");
    expect(gated).toContain("position: sticky");
    expect(css).toContain("@keyframes deskExpand");
    expect(css).toMatch(/to \{ width: 100%; border-radius: 0; \}/);
  });

  it("quote backing keeps AA contrast for --fg even over a pure-black image pixel", () => {
    // The scrim + quote panel promise readability at every scrub position.
    // Worst case: quote's rgba backing composited over a black pixel.
    const m = css.match(/\.desk-quote \{[^}]*background: rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)/s);
    expect(m).not.toBeNull();
    const [r, g, b, a] = [Number(m![1]), Number(m![2]), Number(m![3]), Number(m![4])];
    const comp = [r * a, g * a, b * a]; // over black
    const lum = (rgb: number[]) => {
      const f = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    };
    const fg = [26, 26, 26]; // --fg
    const [hi, lo] = [lum(comp), lum(fg)].sort((x, y) => y - x);
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
