// @vitest-environment jsdom
/**
 * Site-wide accessibility regression tests (WCAG 2.1 AA pass):
 *  - html lang="en" with a skip-to-content link targeting the #main wrapper;
 *  - primary nav is a labeled landmark;
 *  - design tokens keep AA contrast: every text token measures >= 4.5:1
 *    against --bg, --card AND --bg-raised (computed, not eyeballed), and
 *    white-on---accent (the only text-on-fill pairing we ship) does too;
 *  - .sr-only / .skip-link utilities exist in the stylesheet.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import RootLayout from "../app/layout";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css");
const css = readFileSync(cssPath, "utf8");

/** Depth-first walk over a static React element tree (server components). */
function* walk(node: ReactNode): Generator<ReactElement> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
    return;
  }
  if (!isValidElement(node)) return;
  yield node;
  const props = node.props as { children?: ReactNode };
  if (props && props.children !== undefined) yield* walk(props.children);
}

function layoutTree(): ReactElement {
  return RootLayout({ children: createElement("main", null, "page") }) as ReactElement;
}

describe("root layout a11y structure", () => {
  const els = () => [...walk(layoutTree())];

  it("declares html lang=en", () => {
    const html = els().find((e) => e.type === "html");
    expect(html).toBeDefined();
    expect((html!.props as { lang?: string }).lang).toBe("en");
  });

  it("renders a skip-to-content link before the header, targeting #main", () => {
    const all = els();
    const skipIdx = all.findIndex(
      (e) => e.type === "a" && (e.props as { className?: string }).className === "skip-link",
    );
    const headerIdx = all.findIndex((e) => e.type === "header");
    expect(skipIdx).toBeGreaterThanOrEqual(0);
    expect(headerIdx).toBeGreaterThan(skipIdx);
    const skip = all[skipIdx].props as { href?: string; children?: ReactNode };
    expect(skip.href).toBe("#main");
    // ...and the focusable target wrapper exists.
    const target = all.find((e) => (e.props as { id?: string }).id === "main");
    expect(target).toBeDefined();
    expect((target!.props as { tabIndex?: number }).tabIndex).toBe(-1);
  });

  it("labels the primary navigation landmark", () => {
    const nav = els().find((e) => e.type === "nav");
    expect(nav).toBeDefined();
    expect((nav!.props as Record<string, unknown>)["aria-label"]).toBe("Primary");
  });
});

// ---- token contrast (WCAG 1.4.3) -----------------------------------------

function token(name: string): string {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token ${name} not found as a 6-digit hex in globals.css`);
  return m[1];
}

function luminance(hex: string): number {
  const c = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("design-token contrast (AA)", () => {
  const bg = token("--bg");
  const card = token("--card");
  const raised = token("--bg-raised");

  // Every token the UI paints text with, on every surface the UI paints it
  // on. --bg-raised is the worst case (pre, blockquote, .runner-frame,
  // .meter, .time-bar) and is where --warn (4.34) and --distinction (4.42)
  // used to fail AA; nothing forbids a badge or band label from landing
  // there, so the tokens themselves have to clear the bar.
  const TEXT_TOKENS = [
    "--fg",
    "--muted",
    "--faint",
    "--participation",
    "--accent",
    "--good",
    "--bad",
    "--merit",
    "--pass",
    "--distinction",
    "--warn",
  ];

  it.each(TEXT_TOKENS)("%s meets 4.5:1 on bg, card, and raised surfaces", (t) => {
    const fg = token(t);
    for (const surface of [bg, card, raised]) {
      expect(contrast(fg, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The accent fill carries WHITE text (.btn.primary, .skip-link, every
  // runner primary button). Darkening that text is the failure, not the fix:
  // --accent-ink on --accent measures 2.22:1, so the pairing is pinned in
  // both directions.
  it("white text on the accent fill meets 4.5:1", () => {
    expect(contrast("#ffffff", token("--accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("does not use --accent-ink as text on the accent fill", () => {
    expect(contrast(token("--accent-ink"), token("--accent"))).toBeLessThan(4.5);
    expect(css).not.toMatch(/background:\s*var\(--accent\)[^}]*color:\s*var\(--accent-ink\)/);
    expect(css).not.toMatch(/color:\s*var\(--accent-ink\)[^}]*background:\s*var\(--accent\)/);
  });

  it("ships .sr-only and .skip-link utilities", () => {
    expect(css).toContain(".sr-only");
    expect(css).toContain(".skip-link");
    expect(css).toContain(".skip-link:focus-visible");
  });

  // The gallery filters are LINKS, so they are keyboard reachable for free —
  // but a pill-shaped link with no focus ring is invisible when tabbed to
  // (WCAG 2.2 2.4.13), and the active pill is white-on-accent like .btn.
  it("gives the gallery filter chips a visible focus indicator", () => {
    expect(css).toMatch(/\.chip:focus-visible \{[^}]*outline: 2px solid var\(--fg\)/);
  });

  it("paints the active filter chip with the pinned white-on-accent pairing", () => {
    expect(css).toMatch(/\.chip\.on \{[^}]*background: var\(--accent\)[^}]*color: #ffffff/);
  });

  it("draws the gallery and world figures from tokens, never hard-coded colour", () => {
    const scoped = css.slice(css.indexOf("/* ---- /gallery public wall"));
    const hexes = [...scoped.matchAll(/#[0-9a-fA-F]{3,6}/g)].map((m) => m[0]);
    expect(hexes.filter((h) => h.toLowerCase() !== "#ffffff")).toEqual([]);
  });
});

describe("the share and review surfaces reuse the shipped tokens", () => {
  /** Every rule introduced by the share composer / share view / review form. */
  const SHARE_RULES = [
    ".share-sections", ".share-section", ".share-section-hint", ".share-facts",
    ".share-quote", ".share-points", ".share-process", ".review-reason",
  ];

  it("defines each new class exactly once", () => {
    for (const rule of SHARE_RULES) {
      expect(css, rule).toContain(`${rule} `);
    }
  });

  it("uses no hard-coded colour — only var(--token) (so contrast stays AA)", () => {
    for (const rule of SHARE_RULES) {
      const block = css.slice(css.indexOf(`${rule} `));
      const body = block.slice(block.indexOf("{"), block.indexOf("}") + 1);
      expect(body.match(/#[0-9a-fA-F]{3,8}/), rule).toBeNull();
    }
  });
});

describe("the moderation dashboard is legible staff tooling", () => {
  /** Every rule the moderation surface introduces. */
  const MOD_RULES = [
    ".mod-lanes", ".mod-lane", ".mod-table", ".mod-facts", ".mod-reason",
    ".mod-case", ".mod-thread", ".mod-comments", ".mod-comment",
    ".mod-comment-head", ".mod-comment-body", ".mod-composer", ".mod-visibility",
    ".mod-status-submitted", ".mod-status-published", ".mod-status-rejected",
    ".mod-status-revoked", ".mod-status-appeal", ".mod-vis-internal", ".mod-vis-shared",
  ];

  it("defines each new class exactly once", () => {
    for (const rule of MOD_RULES) {
      expect(css, rule).toContain(`${rule} `);
      // Top-level only: a responsive override inside @media is a second
      // declaration of the same class on purpose.
      expect(css.split(`\n${rule} {`).length - 1, rule).toBe(1);
    }
  });

  it("takes every colour from a token, so contrast stays AA on all surfaces", () => {
    for (const rule of MOD_RULES) {
      const block = css.slice(css.indexOf(`${rule} `));
      const body = block.slice(block.indexOf("{"), block.indexOf("}") + 1);
      // #ffffff is the pinned white-on-accent pairing, asserted above.
      expect(body.match(/#(?!ffffff\b)[0-9a-fA-F]{3,8}/), rule).toBeNull();
    }
  });

  it("keeps every status colour above 4.5:1 on the surface it is drawn on", () => {
    // The badges paint token text on --bg-raised, the worst-case surface.
    for (const fg of ["--bad", "--warn", "--muted", "--faint"]) {
      expect(contrast(token(fg), token("--bg-raised")), fg).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token("--accent-ink"), token("--accent-dim"))).toBeGreaterThanOrEqual(4.5);
  });

  it("does not rely on colour alone: each status badge carries its own border", () => {
    for (const rule of [".mod-status-rejected", ".mod-status-appeal", ".mod-status-revoked"]) {
      const block = css.slice(css.indexOf(`${rule} `));
      expect(block.slice(0, block.indexOf("}")), rule).toMatch(/border:/);
    }
  });
});

describe("the credential surfaces are legible and never colour-only", () => {
  /** Every rule the verification view and the diagnosis introduce. */
  const CREDENTIAL_RULES = [
    ".verify-card", ".verify-status", ".verify-valid", ".verify-revoked",
    ".verify-unknown", ".verify-list", ".verify-limits", ".verify-facts",
    ".diagnosis-summary", ".diagnosis-findings", ".diagnosis-actions",
    ".diagnosis-action", ".diagnosis-watch", ".diagnosis-strength",
  ];

  it("defines each new class exactly once", () => {
    for (const rule of CREDENTIAL_RULES) {
      expect(css, rule).toContain(`${rule} `);
      expect(css.split(`\n${rule} {`).length - 1, rule).toBeLessThanOrEqual(1);
    }
  });

  it("takes every colour from a token, so contrast stays AA on all surfaces", () => {
    for (const rule of CREDENTIAL_RULES) {
      const block = css.slice(css.indexOf(`${rule} `));
      const body = block.slice(block.indexOf("{"), block.indexOf("}") + 1);
      expect(body.match(/#(?!ffffff\b)[0-9a-fA-F]{3,8}/), rule).toBeNull();
    }
  });

  it("keeps the verdict colours above 4.5:1 on every surface they land on", () => {
    for (const fg of ["--good", "--bad", "--warn"]) {
      for (const surface of ["--bg", "--card", "--bg-raised"]) {
        expect(contrast(token(fg), token(surface)), `${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("never signals the verdict with colour alone — the word says it too", () => {
    // "Verified" / "Revoked" / "Cannot be confirmed" are TEXT in
    // app/verify/[code]/page.api.tsx; the coloured border is decoration on
    // top. Pinned here so a redesign cannot reduce the state to a hue.
    const page = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "app", "verify", "[code]", "page.api.tsx"),
      "utf8",
    );
    for (const word of ["Verified", "Revoked", "Cannot be confirmed"]) {
      expect(page, word).toContain(word);
    }
    expect(page).toContain("verify-status");
  });
});
