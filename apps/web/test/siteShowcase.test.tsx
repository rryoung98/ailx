// @vitest-environment jsdom

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, } from "vitest";
import { act, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import Methodology from "../app/methodology/page";
import ValidatePage from "../app/validate/page";
import RootLayout from "../app/layout";

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

describe("landing proof showcase", () => {

  it("CSS: mini drift is gated behind @supports(animation-timeline) + no-preference", () => {
    const at = css.indexOf(".showcase-panel .mini-card {\n      animation:");
    const gate = css.lastIndexOf("@supports (animation-timeline: view())", at);
    expect(at).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    const between = css.slice(gate, at);
    expect(between).toContain("@media (prefers-reduced-motion: no-preference)");
    // three distinct drift rates
    for (const k of ["showcaseDrift1", "showcaseDrift2", "showcaseDrift3"]) {
      expect(css).toContain(`@keyframes ${k}`);
    }
    // base .mini-card declaration carries no animation (static fallback)
    const base = css.match(/\n\.mini-card \{[^}]*\}/s);
    expect(base).not.toBeNull();
    expect(base![0]).not.toContain("animation");
  });
});

describe("interior page heroes", () => {
  it("methodology renders the hero band with script accent, chips, and keeps its section ids", async () => {
    const h = await render(createElement(Methodology));
    const hero = h.querySelector(".page-hero")!;
    expect(hero).not.toBeNull();
    expect(hero.querySelector(".page-hero-media")!.getAttribute("aria-hidden")).toBe("true");
    expect(hero.querySelector("img")!.getAttribute("src")).toContain("/media/pastoral.jpg");
    expect(hero.querySelector(".page-hero-scrim")).not.toBeNull();
    const h1 = hero.querySelector("h1")!;
    expect(h1.textContent).toBe("What we measure, and what we still need to learn");
    expect(h1.querySelector(".script-accent")).not.toBeNull();
    // content ids untouched; each intro gains a paper chip
    for (const id of ["construct", "psychometrics", "judges", "modularity"]) {
      expect(h.querySelector(`#${id}`)).not.toBeNull();
    }
    expect(h.querySelectorAll(".paper-chip")).toHaveLength(4);
    for (const chip of h.querySelectorAll(".paper-chip")) {
      expect(chip.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("validate explains what passing checks can and cannot show", async () => {
    const h = await render(createElement(ValidatePage));
    expect(h.querySelector("h1")?.textContent).toBe("Check the scoring code");
    expect(h.textContent).toContain("They test the code, not your AI skills.");
    expect(h.textContent).toContain("It does not prove that scores measure real-world skill");
    expect(h.textContent).toContain("asking a model to judge again may give a different result");
    expect(h.textContent).toContain("score records do not store the runtime version");
    const rerun = h.querySelector<HTMLButtonElement>(".run-card button");
    expect(rerun?.textContent).toBe("Run again");
    await act(async () => { rerun?.click(); });
    expect(h.querySelector(".run-card .badge")?.textContent).toMatch(/^ALL \d+ CHECKS PASS$/);
  });

  it("validate page source uses the hero band, run card, and 2-col check-card grid", () => {
    // /validate is a client page with effects; assert on source structure.
    const src = readFileSync(join(appDir, "validate", "page.tsx"), "utf8");
    expect(src).toContain('className="page-hero"');
    expect(src).toContain("/media/hero-desk.jpg");
    expect(src).toContain('className="run-card"');
    expect(src).toContain('className="check-grid"');
    expect(src).toContain('className="check-card"');
    expect(src).toContain("check-pill");
    expect(src).not.toContain("checklist rule-stagger");
    expect(css).toMatch(/\.check-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
    expect(css).toMatch(/\.check-pill\.pass-check/);
  });
});

describe("favicon", () => {
  it("app/icon.svg is the cream rounded square with the traced green script X", () => {
    const svg = readFileSync(join(appDir, "icon.svg"), "utf8");
    expect(svg).toContain('rx="22"');
    expect(svg).toContain('fill="#f7f4f2"');
    expect(svg).toContain('fill="#438028"');
    expect(svg).toContain("<path d=");
  });

  it("app/apple-icon.png exists (180px raster committed for iOS)", () => {
    const p = join(appDir, "apple-icon.png");
    expect(existsSync(p)).toBe(true);
    const buf = readFileSync(p);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    // IHDR width/height at offsets 16/20
    expect(buf.readUInt32BE(16)).toBe(180);
    expect(buf.readUInt32BE(20)).toBe(180);
  });
});

describe("header play pill", () => {
  const _els = (): ReactElement[] => {
    const out: ReactElement[] = [];
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!isValidElement(node)) return;
      out.push(node);
      const props = node.props as { children?: ReactNode };
      if (props?.children !== undefined) walk(props.children);
    };
    walk(RootLayout({ children: null }) as ReactElement);
    return out;
  };

  it("CSS styles .nav-pill like the pill-cta (ink bg, rounded-full, pointer, hover lift)", () => {
    const m = css.match(/\.nav-pill \{[^}]*\}/s);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("background: #1a1a1a");
    expect(m![0]).toContain("border-radius: 999px");
    expect(css).toMatch(/\.nav-pill \{ cursor: pointer; \}/);
    expect(css).toMatch(/\.site-nav a\.nav-pill:hover \{[^}]*translateY\(-2px\)/s);
    expect(css).toMatch(/\.nav-pill:focus-visible \{[^}]*outline: 3px solid var\(--accent\)/s);
    expect(css).toMatch(/\.nav-pill \.dot \{[^}]*#34d399/s);
  });
});

describe("pill guard + scrub shortening", () => {

  it("CSS owns the whole cleared state, at every width", () => {
    const mob = css.slice(css.indexOf("mobile compatibility"));
    // The rule is no longer nested in `@media (max-width: 640px)`: that gate
    // was the reason PillCTA duplicated the same three declarations inline.
    expect(mob).toMatch(/^\.pill-cta-cleared \{[^}]*pointer-events: none/m);
    expect(mob).not.toMatch(/@media \(max-width: 640px\) \{\s*\.pill-cta-cleared/s);
    const scrub = mob.indexOf("@media (prefers-reduced-motion: no-preference) and (max-width: 640px)");
    expect(scrub).toBeGreaterThan(-1);
    const gated = mob.slice(scrub);
    expect(gated).toContain(".hero-cinema { height: 140vh; }");
    expect(gated).toContain("margin-top: max(-72vh, -620px)");
  });
});

describe("parent dogfood follow-ups", () => {
  it("methodology defines the construct in one grammatical sentence", async () => {
    const h = await render(createElement(Methodology));
    const text = h.textContent!;
    expect(text).toContain("Applied AI literacy means using AI to do useful work while keeping your own judgment");
    // declaude-pass artifacts closed: no strong/em run-ons, no dropped subject
    // and no capitalised mid-sentence verb left behind.
    for (const artifact of [
      "literacy A person's",
      "direct Measurement",
      "are... proxy",
      "examinee dataThe bookmark",
      "itemTranslation",
      "superseded_byThe stored",
      "pure The main constraint",
      "before The exam includes",
      "Math.random Throw",
    ]) {
      expect(text).not.toContain(artifact);
    }
  });

  /**
   * §09's claim, not a paraphrase of it. An automated copy pass once turned
   * the spec's "Person ability logits are *not* reported as scores" into
   * "person abilities are in logits", which says the opposite thing about
   * what the report publishes. The wording may change; the claim may not.
   */
  it("methodology keeps the spec's person-ability claim, not a paraphrase", async () => {
    const h = await render(createElement(Methodology));
    const text = h.textContent!;
    expect(text).toContain("Person-ability logits are not reported as scores");
    expect(text).not.toContain("person abilities are in logits");
    expect(text).toContain("not yet validated as a predictor");
    expect(text).toContain("Re-scoring is reproducible; re-judging is not.");
    expect(text).toContain("Score records do not yet store that version");
    expect(text).toContain("Inputs sent to a connected model leave this page");
    expect(text).toContain("The figures below are not measurements of Foray judges");
  });
});
