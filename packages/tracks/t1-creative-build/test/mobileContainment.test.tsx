// @vitest-environment jsdom
/**
 * Mobile containment — regression for the live-dogfood report:
 * at 390x844 the design-rationale textarea overflowed its card and the
 * "Submit final artifact" button ESCAPED the conversation card, landing
 * under the preview pane's tab bar (which then swallowed the tap).
 *
 * Root cause: the pane height cap (max-height: 78vh) was an INLINE style,
 * so the phone layout could not lift it, and the pane overflow is visible.
 * The cap now lives in the .t1-pane CSS class with a max-width: 900px
 * override that removes it on phones.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const lsStore = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, String(v)),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
  },
});

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  lsStore.clear();
});

function mount() {
  const c = document.createElement("div");
  document.body.appendChild(c);
  root = createRoot(c);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: {},
        onEvent: () => {},
        onComplete: () => {},
        secondsRemaining: 900,
        onCheckpoint: () => {},
      }),
    ),
  );
  return c;
}

describe("T1 mobile containment", () => {
  it("panes carry NO inline height cap (the cap lives in CSS so phones can lift it)", () => {
    const c = mount();
    const panes = c.querySelectorAll("section.t1-pane");
    expect(panes.length).toBe(2); // conversation + live page
    for (const pane of panes) {
      const style = (pane as HTMLElement).style;
      expect(style.maxHeight).toBe("");
      // panel base style keeps flex min-height: 0; the 480px cap is gone.
      expect(style.minHeight).not.toBe("480px");
    }
  });

  it("stylesheet pins the pane cap on desktop and REMOVES it on phones", () => {
    const c = mount();
    const css = c.querySelector("style")!.textContent!;
    expect(css).toMatch(/\.t1-pane \{\s*\n?\s*max-height: 78vh; min-height: 480px;/);
    const mobile = css.slice(css.indexOf("@media (max-width: 900px)"));
    expect(mobile).toContain(".t1-pane { max-height: none; min-height: 0; }");
    // Grid children must be shrinkable or long content forces page scroll.
    expect(css).toContain(".t1-grid > .t1-pane { min-width: 0; }");
  });

  it("inputs render >= 16px on phones (stops iOS Safari zoom-jump on focus)", () => {
    const c = mount();
    const css = c.querySelector("style")!.textContent!;
    const mobile = css.slice(css.indexOf("@media (max-width: 900px)"));
    expect(mobile).toMatch(/\.t1-shell textarea, \.t1-shell input, \.t1-shell select \{ font-size: 16px !important; \}/);
  });

  it("buttons and tabs are >= 44px touch targets on coarse pointers", () => {
    const c = mount();
    const css = c.querySelector("style")!.textContent!;
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain(".t1-shell .t1-btn, .t1-shell .t1-tab { min-height: 44px; }");
  });

  it("resizable textareas are clamped (drag handle cannot pull them past the card)", () => {
    const c = mount();
    const css = c.querySelector("style")!.textContent!;
    expect(css).toContain(".t1-shell textarea { max-height: 60vh; }");
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain(".t1-shell textarea { resize: none !important; }");
  });

  it("the prompt textarea is shrinkable (min-width: 0) and box-sized so it cannot overflow the card", () => {
    const c = mount();
    const ta = c.querySelector('textarea[aria-label="Assist prompt"]') as HTMLTextAreaElement;
    expect(ta.style.minWidth).toBe("0");
    expect(ta.style.boxSizing).toBe("border-box");
    expect(ta.style.width).toBe("100%");
  });

  it("capped pane scrolls internally instead of spilling (mid-width overlap bug)", () => {
    const src = readFileSync(join(here, "../src/Runner.tsx"), "utf8");
    const m = /\.t1-pane \{[^}]*max-height[^}]*\}/s.exec(src);
    expect(m, ".t1-pane rule").toBeTruthy();
    expect(m![0]).toContain("overflow-y: auto");
  });

  it("phone layout stacks the chat controls to full-width lines, desktop keeps rows", () => {
    const src = readFileSync(join(here, "../src/Runner.tsx"), "utf8");
    // The stacking must live in the 900px media block, never inline: an
    // unconditional flex-basis wraps buttons on mid-width desktops too.
    const mobile = src.slice(src.indexOf("@media (max-width: 900px)"), src.indexOf("/* Resizable textareas"));
    expect(mobile).toContain(".t1-shell .t1-row-prompt { flex-wrap: wrap; }");
    expect(mobile).toContain("flex-basis: 100% !important;");
    expect(src).toContain('className="t1-row-prompt"');
    expect(src).toContain('className="t1-row-model"');
    // Inline styles stay basis-0 so desktop rows never wrap.
    expect(src).not.toMatch(/flex: "1 1 \d+px"/);
  });
});
