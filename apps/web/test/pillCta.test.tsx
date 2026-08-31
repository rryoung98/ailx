// @vitest-environment jsdom
/**
 * The floating pill is `position: fixed`, so anything it does not get out of
 * the way of, it sits on top of. Two guards, two failure modes:
 *
 *  - a marked control passes under it (the old guard, previously mobile-only);
 *  - the reader reaches the site footer, which lives in the layout and so can
 *    never mark itself.
 *
 * Both are asserted at DESKTOP width, because that is where the bug shipped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PillCTA } from "../lib/PillCTA";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type IOCallback = (entries: { target: Element; isIntersecting: boolean }[]) => void;
let observers: { cb: IOCallback; targets: Element[] }[] = [];

class FakeIO {
  targets: Element[] = [];
  constructor(private cb: IOCallback) {
    observers.push({ cb, targets: this.targets });
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  disconnect() {
    this.targets.length = 0;
  }
}

function fire(el: Element, isIntersecting: boolean) {
  act(() => {
    for (const o of observers) o.cb([{ target: el, isIntersecting }]);
  });
}

/** Put the reader `remaining` px above the bottom of the document. */
function scrollTo(remaining: number) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: 5000,
  });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 5000 - 800 - remaining });
  act(() => window.dispatchEvent(new Event("scroll")));
}

let root: Root | null = null;
let host: HTMLElement;
let marked: HTMLElement;

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  marked = document.createElement("div");
  marked.setAttribute("data-pill-clear", "");
  document.body.appendChild(marked);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  scrollTo(3000);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  marked.remove();
  vi.unstubAllGlobals();
});

const pill = () => host.querySelector("a.pill-cta, button.pill-cta") as HTMLElement;

describe("PillCTA clearance", () => {
  it("is visible and reachable in the middle of a long page", () => {
    act(() => root!.render(createElement(PillCTA, { href: "/exam", children: "Play" })));
    expect(pill().className).not.toContain("pill-cta-cleared");
    expect(pill().getAttribute("aria-hidden")).toBeNull();
  });

  it("clears a marked control at desktop width, not only on a phone", () => {
    act(() => root!.render(createElement(PillCTA, { href: "/exam", children: "Play" })));
    fire(marked, true);
    expect(pill().className).toContain("pill-cta-cleared");
    // One class, no inline twin: `.pill-cta-cleared` is styled at every
    // width in globals.css (pinned by a11y.test.tsx), so nothing has to be
    // written onto the element to hold at 1440px.
    expect(pill().getAttribute("style")).toBeNull();
    fire(marked, false);
    expect(pill().className).not.toContain("pill-cta-cleared");
  });

  it("clears at the end of the page, where the layout footer is", () => {
    act(() => root!.render(createElement(PillCTA, { href: "/exam", children: "Play" })));
    scrollTo(60);
    expect(pill().className).toContain("pill-cta-cleared");
    scrollTo(3000);
    expect(pill().className).not.toContain("pill-cta-cleared");
  });

  it("leaves no hidden tab stop or announced link behind", () => {
    act(() => root!.render(createElement(PillCTA, { href: "/exam", children: "Play" })));
    scrollTo(60);
    expect(pill().getAttribute("aria-hidden")).toBe("true");
    expect(pill().getAttribute("tabindex")).toBe("-1");
  });

  it("leaves the reduced-motion snap to the stylesheet, not to an inline style", () => {
    // The pill still gets out of the way under reduced motion; it just does
    // not slide. That is one media query in globals.css rather than a
    // hydration-sensitive matchMedia read here.
    const reduce = vi.fn((q: string) => ({
      matches: q.includes("prefers-reduced-motion"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal("matchMedia", reduce);
    Object.defineProperty(window, "matchMedia", { configurable: true, value: reduce });
    act(() => root!.render(createElement(PillCTA, { onClick: () => {}, children: "Play" })));
    scrollTo(60);
    expect(pill().className).toContain("pill-cta-cleared");
    expect(pill().getAttribute("style")).toBeNull();
  });

  it("works as a button too, and keeps aria-disabled independent of clearing", () => {
    act(() => root!.render(createElement(PillCTA, { onClick: () => {}, disabled: true, children: "Play" })));
    expect(pill().tagName).toBe("BUTTON");
    expect(pill().getAttribute("aria-disabled")).toBe("true");
    scrollTo(60);
    expect(pill().getAttribute("aria-disabled")).toBe("true");
    expect(pill().className).toContain("pill-cta-cleared");
  });
});
