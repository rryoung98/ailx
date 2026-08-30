// @vitest-environment jsdom
/**
 * Site showcase wave regression tests:
 *  - landing proof showcase: two Zero-style split rows (script-accented serif
 *    headers, hand notes, pastoral panels with floating minis), each linking
 *    to /methodology and /validate; quiet demo-spec caption survives;
 *  - parallax drift is @supports + reduced-motion gated in CSS (static base);
 *  - methodology + validate carry the page-hero band; validate renders the
 *    checks as a 2-col card grid with pass pills and a floating run card;
 *  - favicon assets exist (app/icon.svg green square + mint X, apple-icon.png);
 *  - header nav swaps the plain Play link for a compact pill (ink bg, green
 *    dot) while other links stay plain;
 *  - mobile pill guard: teaser + connect panel are [data-pill-clear] zones
 *    and the CSS hides .pill-cta-cleared under 640px.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import Home from "../app/page";
import Methodology from "../app/methodology/page";
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
  it("renders two split rows with script-accented serif headers and hand notes", async () => {
    const h = await render(createElement(Home));
    const rows = [...h.querySelectorAll(".showcase .showcase-row")];
    expect(rows).toHaveLength(2);
    const titles = rows.map((r) => r.querySelector(".showcase-title")!.textContent);
    expect(titles).toEqual(["Read the methodology.", "Watch it prove itself."]);
    for (const r of rows) expect(r.querySelector(".showcase-title .script-accent")).not.toBeNull();
    const notes = rows.map((r) => r.querySelector(".annotation")!.textContent);
    expect(notes[0]).toContain("no black boxes");
    expect(notes[1]).toContain("runs in your browser");
    // second row flips the panel to the left
    expect(rows[1].classList.contains("showcase-row-flip")).toBe(true);
  });

  it("each row's panel shows the pastoral backdrop with floating minis, decorative only", async () => {
    const h = await render(createElement(Home));
    const panels = [...h.querySelectorAll(".showcase-panel")];
    expect(panels).toHaveLength(2);
    const hrefs = panels.map((p) => p.getAttribute("href"));
    expect(hrefs).toEqual(["/methodology", "/validate"]);
    for (const p of panels) {
      expect(p.getAttribute("aria-hidden")).toBe("true");
      expect(p.getAttribute("tabindex")).toBe("-1");
      expect(p.querySelector("img")!.getAttribute("src")).toContain("/media/pastoral.jpg");
      expect(p.querySelector("img")!.getAttribute("alt")).toBe("");
      expect(p.querySelector(".showcase-scrim")).not.toBeNull();
      const minis = p.querySelectorAll(".mini-card");
      expect(minis.length).toBeGreaterThanOrEqual(2);
      expect(minis.length).toBeLessThanOrEqual(3);
    }
    // the three mini motifs all appear somewhere in the section
    expect(h.querySelector(".mini-card-score")!.textContent).toContain("206.6");
    expect(h.querySelector(".mini-card-score")!.textContent).toContain("Merit");
    const checks = h.querySelector(".mini-card-checks")!;
    for (const s of ["sha256 verified", "replay = live", "export matches"]) {
      expect(checks.textContent).toContain(s);
    }
    expect(h.querySelector(".mini-card-report")).not.toBeNull();
  });

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
    expect(h1.textContent).toBe("What is measured, how it is scored, and what is honestly not yet known");
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
  const els = (): ReactElement[] => {
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

  it("nav renders Play as the trailing pill with a green dot; other links stay plain", () => {
    const nav = els().find((e) => e.type === "nav")!;
    const links: { href?: string; className?: string }[] = [];
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!isValidElement(node)) return;
      const props = node.props as { href?: string; className?: string; children?: ReactNode };
      if (props?.href) links.push({ href: props.href, className: props.className });
      if (props?.children !== undefined) walk(props.children);
    };
    walk((nav.props as { children?: ReactNode }).children);
    // Static export: the share gallery needs a database, so the nav links the
    // T4 community wall instead of a route that cannot exist here.
    // Static export: the share gallery and the personal progress page both
    // need a database, so the nav links the T4 community wall and the drill
    // itself instead of routes that cannot exist here.
    expect(links.map((l) => l.href)).toEqual([
      "/methodology", "/report", "/wall", "/practice", "/validate", "/exam",
    ]);
    expect(links[links.length - 1].className).toBe("nav-pill");
    for (const l of links.slice(0, -1)) expect(l.className).toBeUndefined();
    // dot span inside the pill
    const pill = els().find((e) => (e.props as { className?: string }).className === "nav-pill")!;
    const kids = (pill.props as { children?: ReactNode }).children as ReactNode[];
    const dot = (Array.isArray(kids) ? kids : [kids]).find(
      (k) => isValidElement(k) && (k.props as { className?: string }).className === "dot",
    );
    expect(dot).toBeDefined();
  });

  it("links the share gallery and the world page only in the hosted build", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    try {
      const nav = els().find((e) => e.type === "nav")!;
      const hrefs: string[] = [];
      const walk = (node: ReactNode): void => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!isValidElement(node)) return;
        const props = node.props as { href?: string; children?: ReactNode };
        if (props?.href) hrefs.push(props.href);
        if (props?.children !== undefined) walk(props.children);
      };
      walk((nav.props as { children?: ReactNode }).children);
      expect(hrefs).toEqual([
        "/methodology", "/report", "/gallery", "/world", "/progress", "/validate", "/exam",
      ]);
      expect(hrefs).not.toContain("/wall");
      expect(hrefs).not.toContain("/practice");
    } finally {
      vi.unstubAllEnvs();
    }
  });

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
  it("teaser, connect panel and the landing CTAs are marked [data-pill-clear]", () => {
    const teaser = readFileSync(join(appDir, "..", "lib", "Teaser.tsx"), "utf8");
    const connect = readFileSync(join(appDir, "..", "lib", "ConnectPanel.tsx"), "utf8");
    expect(teaser).toContain("data-pill-clear");
    expect(connect).toContain("data-pill-clear");
    // The landing page is where the fixed pill actually sat on top of copy.
    const landing = readFileSync(join(appDir, "page.tsx"), "utf8");
    expect(landing).toContain('className="hero-cta hero-fade" data-pill-clear=""');
    expect(landing).toContain('className="wyg-steps" data-pill-clear=""');
    const pill = readFileSync(join(appDir, "..", "lib", "PillCTA.tsx"), "utf8");
    expect(pill).toContain("[data-pill-clear]");
    expect(pill).toContain("pill-cta-cleared");
    // The guard is deliberately NOT width-gated any more: a fixed pill covers
    // a desktop heading exactly as hard as a phone button.
    expect(pill).not.toContain("max-width: 640px");
  });

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
  it("methodology construct definition reads 'applied AI literacy: a person's ability'", async () => {
    const h = await render(createElement(Methodology));
    const text = h.textContent!;
    expect(text).toContain("applied AI literacy: a person's ability");
    // declaude-pass artifacts closed: no strong/em run-ons left
    for (const artifact of [
      "literacy A person's",
      "direct Measurement",
      "are... proxy",
      "examinee dataThe bookmark",
      "itemTranslation",
      "superseded_byThe stored",
      "pure The main constraint",
      "before The exam includes",
    ]) {
      expect(text).not.toContain(artifact);
    }
  });

  it("nav links render through NavLink, which sets aria-current on the active page", () => {
    const layoutSrc = readFileSync(join(appDir, "layout.tsx"), "utf8");
    // 3 always-on links + Play, plus the two mode-gated hosted links
    // (/gallery, /world), the static-export /wall that replaces them, and the
    // one slot that is /progress in the hosted build and /practice in the export.
    expect((layoutSrc.match(/<NavLink /g) ?? []).length).toBe(8);
    const navSrc = readFileSync(join(appDir, "..", "lib", "NavLink.tsx"), "utf8");
    expect(navSrc).toContain("usePathname");
    expect(navSrc).toContain('aria-current={current ? "page" : undefined}');
    expect(css).toMatch(/\.site-nav a\[aria-current="page"\] \{[^}]*var\(--accent\)/s);
  });
});
