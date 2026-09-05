// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { NavStrip } from "../components/ui/NavStrip";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * From the deployed sweep: on /gallery at 320px the "Gallery" link sat at
 * x=315 while the visible strip ended at x=203, so the phone header showed
 * NO current-page marker. The strip also hides its scrollbar, so its right
 * edge sliced a link mid-word with nothing saying "swipe".
 */
/** jsdom lays nothing out, so the overflow the component reads is faked. */
function fakeWidths(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(Element.prototype, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(Element.prototype, "clientWidth", { value: clientWidth, configurable: true });
}

describe("NavStrip", () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
  });

  const render = () =>
    act(() => {
      root = createRoot(host);
      root.render(
        createElement(
          NavStrip,
          null,
          createElement("a", { href: "/exam", key: "a" }, "Full run"),
          createElement("a", { href: "/gallery", key: "b", "aria-current": "page" }, "Gallery"),
        ),
      );
    });

  it("scrolls the current page's link into view when the row overflows", () => {
    const seen: unknown[] = [];
    // jsdom has no scrollIntoView; record the call instead.
    Element.prototype.scrollIntoView = function (arg?: unknown) { seen.push(arg); } as never;
    fakeWidths(563, 198); // the measured /gallery strip at 320px
    render();
    expect(seen).toEqual([{ inline: "center", block: "nearest" }]);
  });

  it("leaves a non-overflowing row alone and marks it as fully scrolled", () => {
    const seen: unknown[] = [];
    Element.prototype.scrollIntoView = function (arg?: unknown) { seen.push(arg); } as never;
    fakeWidths(198, 198);
    render();
    expect(seen).toEqual([]);
    const strip = host.querySelector<HTMLElement>(".nav-links")!;
    // Nothing further right, so the edge fade must be off.
    expect(strip.dataset.scrollEnd).toBe("1");
  });

  it("turns the edge fade off only once the row is scrolled to its end", () => {
    Element.prototype.scrollIntoView = function () {} as never;
    fakeWidths(563, 198);
    render();
    const strip = host.querySelector<HTMLElement>(".nav-links")!;
    expect(strip.dataset.scrollEnd).toBe("0");

    strip.scrollLeft = 365;
    act(() => { strip.dispatchEvent(new Event("scroll")); });
    expect(strip.dataset.scrollEnd).toBe("1");

    strip.scrollLeft = 40;
    act(() => { strip.dispatchEvent(new Event("scroll")); });
    expect(strip.dataset.scrollEnd).toBe("0");
  });

  it("keeps every child link in the strip", () => {
    Element.prototype.scrollIntoView = function () {} as never;
    render();
    expect(host.querySelectorAll(".nav-links a").length).toBe(2);
  });
});
