// @vitest-environment jsdom
/**
 * The front door: the GAME leads, the graded run is the graduation.
 *
 * What is asserted here is the ORDER of the funnel and the honesty of what
 * it promises, in BOTH builds:
 *  - a real practice card is playable inside the hero, before any other call
 *    to action, and it is drawn from the practice corpus (never the bank);
 *  - the first call to action on the page is the free drill, not the graded
 *    run, and /exam is still one obvious click from the hero;
 *  - the funnel reads play -> come back -> take the run -> keep what it
 *    leaves you, and the store-backed steps only promise what the build can
 *    do (the static export records nothing and has no /progress);
 *  - nothing on the page states a score, a band, a percentile or a norm.
 */
import { TOTAL_POINTS } from "@ailx/core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CHARACTER_CAST, PRACTICE_BANK, PRACTICE_OPTIONS } from "@ailx/report";
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

describe("the hero is playable", () => {
  it("puts a real practice card, with both calls, inside the hero", async () => {
    const h = await render();
    const play = h.querySelector(".hero .hero-play")!;
    expect(play).not.toBeNull();
    const calls = [...play.querySelectorAll("button")].map((b) => b.textContent);
    expect(calls).toEqual([...PRACTICE_OPTIONS]);
    // The picture is a bundled practice image, so it plays in the export too.
    const img = play.querySelector("img")!;
    const srcs = PRACTICE_BANK.map((i) => i.material.src);
    expect(srcs.some((s) => img.getAttribute("src")!.endsWith(s))).toBe(true);
    expect(img.getAttribute("alt")).not.toBe("");
  });

  it("answers a card in place: right or wrong plus the tell, no navigation", async () => {
    const h = await render();
    const play = h.querySelector(".hero .hero-play")!;
    await act(async () => {
      (play.querySelector("button") as HTMLButtonElement).click();
    });
    const verdict = play.querySelector("[role='status']")!;
    expect(verdict.textContent).toMatch(/Right\.|Missed it\./);
    // the teaching, not just the verdict
    expect(play.textContent).toContain("Next card");
  });

  it("leads with the drill: the hero call to action is /practice, then /exam", async () => {
    const h = await render();
    const cta = h.querySelector(".hero-cta")!;
    const links = [...cta.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/practice", "/exam"]);
    expect(links[0].className).toContain("primary");
    expect(links[1].className).not.toContain("primary");
    // ...and the graded run is still obvious: it is in the first screenful.
    expect(links[1].textContent).toContain("credential");
  });

  it("the first link on the page is never the graded run", async () => {
    const h = await render();
    const all = hrefs(h);
    expect(all.indexOf("/practice")).toBeLessThan(all.indexOf("/exam"));
  });

  it("the floating pill plays rather than starting the graded run", async () => {
    const h = await render();
    const pill = h.querySelector("a.pill-cta")!;
    expect(pill.getAttribute("href")).toBe("/practice");
  });
});

describe("funnel order", () => {
  it("reads play, come back, run, keep — with the run third, not first", async () => {
    const h = await render();
    const steps = [...h.querySelectorAll(".wyg-step")];
    expect(steps).toHaveLength(4);
    const stepHrefs = steps.map((s) => s.querySelector("a")!.getAttribute("href"));
    expect(stepHrefs[0]).toBe("/practice");
    expect(stepHrefs[2]).toBe("/exam");
    expect(stepHrefs[3]).toBe("/report");
  });

  it("static export: the streak step is there, and never links /progress", async () => {
    const h = await render();
    const step = h.querySelectorAll(".wyg-step")[1];
    // The static export keeps a streak too — in the visitor's own browser —
    // so the step is no longer a different promise in the two builds.
    expect(step.querySelector(".wyg-title")!.textContent).toBe("Come back tomorrow.");
    expect(step.textContent).toContain("kept in this browser");
    expect(step.querySelector("a")!.getAttribute("href")).toBe("/practice");
    expect(hrefs(h)).not.toContain("/progress");
  });

  it("hosted build: the same step, linking /progress", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const h = await render();
    const step = h.querySelectorAll(".wyg-step")[1];
    expect(step.querySelector(".wyg-title")!.textContent).toBe("Come back tomorrow.");
    expect(step.querySelector("a")!.getAttribute("href")).toBe("/progress");
  });

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

  /**
   * The denominator is READ from the allocation table (TEN-80 moved it from
   * 400 to 375), so this asserts the live total rather than a literal.
   */
  it("shows the instrument's point scale without inventing a result", async () => {
    const h = await render();
    const mini = h.querySelector(".mini-card-score")!;
    expect(TOTAL_POINTS).toBe(375);
    expect(mini.textContent).toContain(`?/${TOTAL_POINTS}`);
    expect(mini.textContent).not.toMatch(/\d+\.\d\s*\/\s*\d/);
  });

  it("says plainly that the credential is not a grade", async () => {
    const h = await render();
    expect(h.textContent).toContain("never a grade");
  });
});

/**
 * The identity payoff. The card the sixteen characters belong to is the most
 * shareable thing the product makes, so the front door shows the faces; what
 * it must never do is turn a playful reading into a verdict.
 *
 * jsdom answers "is the right thing rendered, with text beside every
 * picture"; whether the row fits a phone without scrolling sideways is a
 * layout question and lives in apps/web/e2e/visual.spec.ts.
 */
describe("the sixteen characters are on the front door", () => {
  it("draws the whole cast, each face with its code as text", async () => {
    const h = await render();
    const tiles = [...h.querySelectorAll(".cast .cast-tile")];
    expect(tiles).toHaveLength(CHARACTER_CAST.length);
    expect(CHARACTER_CAST.length).toBe(16);
    expect(tiles.map((t) => t.querySelector(".cast-code")!.textContent)).toEqual(
      CHARACTER_CAST.map((c) => c.code),
    );
    for (const [i, tile] of tiles.entries()) {
      const img = tile.querySelector("img")!;
      expect(img.getAttribute("src")).toContain(CHARACTER_CAST[i].src);
      // The picture is never the only carrier: alt describes the drawing.
      expect(img.getAttribute("alt")).toBe(CHARACTER_CAST[i].alt);
    }
  });

  it("sends the visitor to the sample card, and never to the graded run", async () => {
    const h = await render();
    const cast = h.querySelector("section.cast")!;
    const links = [...cast.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/report"]);
  });

  it("calls the type fun, not a grade", async () => {
    const h = await render();
    const text = h.querySelector("section.cast")!.textContent!;
    expect(text).toContain("for fun, never a grade");
    // No verdict vocabulary: the same ban the rest of the page lives under.
    expect(text).not.toMatch(/rank|score|percentile|better than/i);
  });

  it("clears the fixed pill, which would otherwise print across the faces", async () => {
    const h = await render();
    expect(h.querySelector(".cast .cast-row")!.hasAttribute("data-pill-clear")).toBe(true);
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

  it("the fixed pill clears the drill instead of printing across its calls", async () => {
    const h = await render();
    const play = h.querySelector(".hero-play")!;
    expect(play.hasAttribute("data-pill-clear")).toBe(true);
    expect(play.querySelector("button")).not.toBeNull();
  });
});
