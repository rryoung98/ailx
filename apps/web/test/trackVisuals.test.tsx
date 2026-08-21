// @vitest-environment jsdom
/**
 * CSS track visuals (now the non-WebGL fallback behind lib/track3d):
 * smoke-renders the four animated mini-previews
 * and pins their contracts — each card links to /exam, the T2 preview uses
 * REAL snapshot media with REAL/AI stamps, T3 shows the strike-through
 * correction, T4 shows the FINAL frame and quota pips.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TrackCards, t2VisualMedia } from "../lib/TrackVisuals";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(createElement(TrackCards)); });
  return host;
}

describe("t2VisualMedia", () => {
  it("returns 3 real snapshot images with a real/AI mix", () => {
    const media = t2VisualMedia();
    expect(media).toHaveLength(3);
    for (const m of media) expect(m.src).toMatch(/\/t2-media\/[0-9a-f]{12}\.jpg$/);
    expect(media.some((m) => m.real)).toBe(true);
    expect(media.some((m) => !m.real)).toBe(true);
  });
});

describe("track visual cards", () => {
  it("renders four cards, all linking to /exam", () => {
    const h = render();
    const links = [...h.querySelectorAll("a")];
    expect(links).toHaveLength(4);
    for (const a of links) expect(a.getAttribute("href")).toBe("/exam");
    for (const id of ["T1", "T2", "T3", "T4"]) expect(h.textContent).toContain(id);
  });

  it("each card has a mini-preview visual area and a one-line caption", () => {
    const h = render();
    expect(h.querySelectorAll(".tviz")).toHaveLength(4);
    expect(h.textContent).toContain("Can you spot the fakes?");
    expect(h.textContent).toContain("The assistant lies twice. Catch it.");
    expect(h.textContent).toContain("Six shots. Make them count.");
  });

  it("T2 preview shows real snapshot media with REAL/AI stamps", () => {
    const h = render();
    const imgs = [...h.querySelectorAll(".tv2 img")];
    expect(imgs.length).toBe(3);
    for (const img of imgs) expect(img.getAttribute("src")).toMatch(/\/t2-media\//);
    const stamps = [...h.querySelectorAll(".tv2-stamp")].map((s) => s.textContent);
    expect(stamps).toContain("REAL");
    expect(stamps).toContain("AI");
  });

  it("T3 shows the struck claim and correction; T4 shows FINAL + 3 quota pips", () => {
    const h = render();
    expect(h.querySelector(".tv3-strike")).not.toBeNull();
    expect(h.textContent).toContain("61 months");
    expect(h.textContent).toContain("38 months");
    expect(h.querySelector(".tv4-final")?.textContent).toBe("FINAL");
    expect(h.querySelectorAll(".tv4-pips i")).toHaveLength(3);
  });

  it("previews are decorative for AT (aria-hidden), captions carry the meaning", () => {
    const h = render();
    for (const viz of h.querySelectorAll(".tviz")) {
      expect(viz.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
