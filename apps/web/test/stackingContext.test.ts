import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Stacking-layer regression, from a founder screenshot: with the account
 * menu open on /exam, the page H1 ("Four tracks. One run.") painted straight
 * THROUGH the popover and its "Sign out" row was unreadable behind the
 * glyphs.
 *
 * The cause was not the popover. `body > * { position: relative; z-index: 1 }`
 * existed only to lift our shell above a paper-grain pseudo-element parked at
 * z-index 0, and it also caught the portal root a third party appends to
 * <body>. That clamped the portal into a z-index:1 stacking context, and
 * `#main { z-index: 2 }` out-ranked the whole thing no matter how large the
 * portal's own z-index was.
 *
 * The same clamp trapped our OWN fixed overlays: the covering loader
 * (z-index 100) and the bottom pill (z-index 30) live inside #main, so they
 * could never rise above the sticky header (z-index 20).
 *
 * The rule these tests hold: the document has ONE stacking context, the root
 * one. The grain sits below everything at z-index -1, and no direct child of
 * <body> is given a z-index that would trap what is nested inside it.
 */
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../app/globals.css"),
  "utf8",
);

/** Declaration blocks as [selector, body] pairs, comments stripped. */
function rules(): Array<[string, string]> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<[string, string]> = [];
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push([m[1].trim().replace(/\s+/g, " "), m[2]]);
  }
  return out;
}

function declaration(body: string, prop: string): string | undefined {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : undefined;
}

describe("globals.css stacking layers", () => {
  it("no blanket rule gives every direct child of <body> a z-index", () => {
    const offenders = rules().filter(
      ([sel, body]) =>
        /body\s*>\s*\*/.test(sel) && declaration(body, "z-index") !== undefined,
    );
    expect(offenders.map(([sel]) => sel)).toEqual([]);
  });

  it("#main is positioned but creates no stacking context", () => {
    const main = rules().filter(([sel]) => sel.split(",").some((s) => s.trim() === "#main"));
    expect(main.length).toBeGreaterThan(0);
    // A z-index here re-traps every fixed overlay rendered inside #main.
    for (const [, body] of main) expect(declaration(body, "z-index")).toBeUndefined();
    // position: relative alone does NOT create a stacking context, and
    // descendants position against it.
    expect(main.some(([, body]) => declaration(body, "position") === "relative")).toBe(true);
  });

  it("the paper grain sits below the document instead of being out-ranked", () => {
    const grain = rules().find(([sel]) => sel === "body::before");
    expect(grain).toBeDefined();
    expect(Number(declaration(grain![1], "z-index"))).toBeLessThan(0);
  });

  it("the page background is on <html>, so the grain is not covered by <body>", () => {
    // body::before at z-index -1 paints ABOVE the canvas but BELOW every
    // in-flow background box, <body>'s included. The background therefore
    // has to be on the element that paints the canvas.
    const htmlBackgrounds = rules()
      .filter(([sel]) => sel.split(",").some((s) => s.trim() === "html"))
      .map(([, body]) => declaration(body, "background"))
      .filter(Boolean);
    expect(htmlBackgrounds).toContain("var(--bg)");
    const bodyBackgrounds = rules()
      .filter(([sel]) => sel.split(",").some((s) => s.trim() === "body"))
      .map(([, body]) => declaration(body, "background"))
      .filter(Boolean);
    expect(bodyBackgrounds).toEqual([]);
  });

  /**
   * With one stacking context these numbers are directly comparable, which
   * is the point of the change. Written down so a future edit that reorders
   * them has to say so.
   */
  it("the overlay order is loader > pill > header", () => {
    const z = (selector: string) => {
      const rule = rules().find(
        ([sel, body]) =>
          sel.split(",").some((s) => s.trim() === selector) &&
          declaration(body, "z-index") !== undefined,
      );
      expect(rule, selector).toBeDefined();
      return Number(declaration(rule![1], "z-index"));
    };
    const header = z(".site-header");
    const pill = z(".pill-cta");
    const loader = z(".loader");
    expect(header).toBeLessThan(pill);
    expect(pill).toBeLessThan(loader);
  });
});
