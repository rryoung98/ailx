// @vitest-environment jsdom
/**
 * Site-wide accessibility regression tests (WCAG 2.1 AA pass):
 *  - html lang="en" with a skip-to-content link targeting the #main wrapper;
 *  - primary nav is a labeled landmark;
 *  - design tokens keep AA contrast: --fg, --muted and --faint body text
 *    measure >= 4.5:1 against --bg, --card AND --bg-raised (computed, not
 *    eyeballed), and --accent link colour >= 4.5:1 on --bg;
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

  it.each(["--fg", "--muted", "--faint"])("%s meets 4.5:1 on bg, card, and raised surfaces", (t) => {
    const fg = token(t);
    for (const surface of [bg, card, raised]) {
      expect(contrast(fg, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("accent link color meets 4.5:1 on bg", () => {
    expect(contrast(token("--accent"), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("ships .sr-only and .skip-link utilities", () => {
    expect(css).toContain(".sr-only");
    expect(css).toContain(".skip-link");
    expect(css).toContain(".skip-link:focus-visible");
  });
});
