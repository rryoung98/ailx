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
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PillCTA } from "../components/ui/PillCTA";

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

type ROCallback = () => void;
let resizeObservers: ROCallback[] = [];

class FakeRO {
  constructor(cb: ROCallback) {
    resizeObservers.push(cb);
  }
  observe() {}
  disconnect() {}
}

/** The document box changed under the component; no scroll, no window resize. */
function fireResizeObserver() {
  act(() => {
    for (const cb of resizeObservers) cb();
  });
}

/**
 * Set the page geometry. Height is per-test: the defect this file missed for
 * a release was a page that does not scroll at all, and a `scrollHeight`
 * pinned in `beforeEach` cannot see one.
 */
function setPage({
  scrollHeight,
  innerHeight = 800,
  scrollY = 0,
}: {
  scrollHeight: number;
  innerHeight?: number;
  scrollY?: number;
}) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
  Object.defineProperty(window, "scrollY", { configurable: true, value: scrollY });
}

/** Put the reader `remaining` px above the bottom of a 5000px document. */
function scrollTo(remaining: number) {
  setPage({ scrollHeight: 5000, scrollY: 5000 - 800 - remaining });
  act(() => window.dispatchEvent(new Event("scroll")));
}

let root: Root | null = null;
let host: HTMLElement;
let marked: HTMLElement;

beforeEach(() => {
  observers = [];
  resizeObservers = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("ResizeObserver", FakeRO);
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
    act(() => root!.render(<PillCTA href="/exam">Play</PillCTA>));
    expect(pill().className).not.toContain("pill-cta-cleared");
    expect(pill().getAttribute("aria-hidden")).toBeNull();
  });

  it("clears a marked control at desktop width, not only on a phone", () => {
    act(() => root!.render(<PillCTA href="/exam">Play</PillCTA>));
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
    act(() => root!.render(<PillCTA href="/exam">Play</PillCTA>));
    scrollTo(60);
    expect(pill().className).toContain("pill-cta-cleared");
    scrollTo(3000);
    expect(pill().className).not.toContain("pill-cta-cleared");
  });

  it("leaves no hidden tab stop or announced link behind", () => {
    act(() => root!.render(<PillCTA href="/exam">Play</PillCTA>));
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
    act(() => root!.render(<PillCTA onClick={() => {}}>Play</PillCTA>));
    scrollTo(60);
    expect(pill().className).toContain("pill-cta-cleared");
    expect(pill().getAttribute("style")).toBeNull();
  });

  it("stays on a page that does not scroll — there is no footer to clear", () => {
    // A 2560x1440 monitor, or a zoomed-out browser, against a start screen
    // barely taller than the viewport. This is /exam, and the pill is the
    // only Start control.
    setPage({ scrollHeight: 1250, innerHeight: 1200, scrollY: 0 });
    act(() => root!.render(<PillCTA href="/exam">Play</PillCTA>));
    expect(pill().className).not.toContain("pill-cta-cleared");
    expect(pill().getAttribute("aria-hidden")).toBeNull();
    expect(pill().getAttribute("tabindex")).toBeNull();
  });

  it("stays on a page that fits the viewport exactly", () => {
    setPage({ scrollHeight: 1200, innerHeight: 1200, scrollY: 0 });
    act(() => root!.render(<PillCTA href="/exam">Play</PillCTA>));
    expect(pill().className).not.toContain("pill-cta-cleared");
  });

  it("still clears a marked control on a page that does not scroll", () => {
    setPage({ scrollHeight: 1250, innerHeight: 1200, scrollY: 0 });
    act(() => root!.render(<PillCTA href="/exam">Play</PillCTA>));
    fire(marked, true);
    expect(pill().className).toContain("pill-cta-cleared");
  });

  it("still clears at the bottom of a page that does scroll", () => {
    setPage({ scrollHeight: 5000, innerHeight: 800, scrollY: 4200 });
    act(() => root!.render(<PillCTA href="/exam">Play</PillCTA>));
    expect(pill().className).toContain("pill-cta-cleared");
  });

  it("re-measures when the content grows past the viewport, and when it shrinks back", () => {
    setPage({ scrollHeight: 1250, innerHeight: 1200, scrollY: 0 });
    act(() => root!.render(<PillCTA href="/exam">Play</PillCTA>));
    expect(pill().className).not.toContain("pill-cta-cleared");
    // The page grows and the reader is already at its bottom: footer in play.
    setPage({ scrollHeight: 3000, innerHeight: 1200, scrollY: 1750 });
    fireResizeObserver();
    expect(pill().className).toContain("pill-cta-cleared");
    // And back: the content collapses, the document stops scrolling.
    setPage({ scrollHeight: 1250, innerHeight: 1200, scrollY: 0 });
    fireResizeObserver();
    expect(pill().className).not.toContain("pill-cta-cleared");
  });

  it("works as a button too, and keeps aria-disabled independent of clearing", () => {
    act(() => root!.render(<PillCTA onClick={() => {}} disabled>Play</PillCTA>));
    expect(pill().tagName).toBe("BUTTON");
    expect(pill().getAttribute("aria-disabled")).toBe("true");
    scrollTo(60);
    expect(pill().getAttribute("aria-disabled")).toBe("true");
    expect(pill().className).toContain("pill-cta-cleared");
  });
});
