// @vitest-environment jsdom
/**
 * Landing 3D scene layer regression tests:
 *  - SSR safety: no module reachable from the landing page's static import
 *    graph may import `three` or `@react-three/fiber`; the WebGL code is
 *    only reachable through the dynamic `loadSceneModule()` boundary;
 *  - presence hooks: IntersectionObserver pause/resume + reduced motion;
 *  - TrackScene: in a non-WebGL environment (jsdom) it renders the CSS
 *    fallback, stays aria-hidden, and keeps its per-scene data-testid;
 *  - TrackBands: four alternating editorial rows, all linking to /exam,
 *    numerals T1–T4 as anchors, one supporting line each (from TRACK_META).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SCENE_IDS } from "../lib/track3d/registry";
import { usePrefersReducedMotion, useSceneVisibility } from "../lib/track3d/presence";
import { TrackScene } from "../lib/track3d/TrackScene";
import { TrackBands, supportLine } from "../lib/track3d/TrackBands";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel: string) => readFileSync(join(webRoot, rel), "utf8");

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(el); });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  delete (globalThis as Record<string, unknown>).IntersectionObserver;
  vi.restoreAllMocks();
});

// ---- perf/SSR guard: three stays behind the lazy boundary ----------------

describe("lazy-import boundary (no three in the server graph)", () => {
  const STATIC_THREE = /^\s*import\s[^;]*from\s+["'](three|@react-three\/[^"']+)["']/m;

  it.each([
    "app/page.tsx",
    "lib/track3d/TrackBands.tsx",
    "lib/track3d/CampusJourney.tsx",
    "lib/track3d/TrackScene.tsx",
    "lib/track3d/registry.ts",
    "lib/track3d/presence.ts",
    "lib/TrackVisuals.tsx",
  ])("%s never statically imports three/@react-three", (rel) => {
    expect(src(rel)).not.toMatch(STATIC_THREE);
  });

  it("scenes.tsx is reached only via a dynamic import in registry.ts", () => {
    const registry = src("lib/track3d/registry.ts");
    expect(registry).toContain('import("./scenes")');
    expect(registry).not.toMatch(/^\s*import\s[^;]*from\s+["']\.\/scenes["']/m);
    // no other landing module short-circuits the boundary
    for (const rel of ["app/page.tsx", "lib/track3d/TrackBands.tsx", "lib/track3d/CampusJourney.tsx", "lib/track3d/TrackScene.tsx"]) {
      expect(src(rel)).not.toMatch(/from\s+["'][^"']*scenes["']/);
    }
    // and the scenes module is the one place three is allowed
    expect(src("lib/track3d/scenes.tsx")).toMatch(/from\s+["']three["']/);
  });

  it("registry lists exactly the four track scenes", () => {
    expect(SCENE_IDS).toEqual(["T1", "T2", "T3", "T4"]);
  });
});

// ---- anti-grain guard (user-reported: "grainy as hell") ------------------

describe("scene render quality", () => {
  const scenes = () => src("lib/track3d/scenes.tsx");

  it("renders at the device pixel ratio up to 2 (no sub-DPR upscaling grain)", () => {
    expect(scenes()).toContain("dpr={[1, 2]}");
    expect(scenes()).not.toMatch(/dpr=\{\[1, 1\.5\]\}/);
  });

  it("textures are sRGB + mipmapped + anisotropic (no tilted-plane shimmer)", () => {
    expect(scenes()).toContain("SRGBColorSpace");
    expect(scenes()).toContain("LinearMipmapLinearFilter");
    expect(scenes()).toContain("getMaxAnisotropy");
  });

  it("uses thick geometry for edges — 1px GL lines alias at any DPR", () => {
    for (const banned of ["lineSegments", "lineBasicMaterial", "EdgesGeometry", "wireframe"]) {
      expect(scenes()).not.toContain(banned);
    }
  });

  // paper-realism pass (user-reported: "flat dark boxes on cream")
  it("builds scenes from lit paper surfaces, not flat unlit dark slabs", () => {
    const s = scenes();
    expect(s).toContain("meshStandardMaterial");
    expect(s).toContain("directionalLight");
    expect(s).toContain("ambientLight");
    expect(s).toContain('"#fdfcfa"'); // paper white base
    expect(s).not.toContain("#242220"); // old flat dark slab fill
    expect(s).not.toContain("0.055, 0.075, 0.106"); // old dark T4 shader base
  });

  it("cards float over soft blurred shadow planes", () => {
    const s = scenes();
    expect(s).toContain("makeShadowTexture");
    expect(s).toContain("ShadowBlob");
  });

  it("T3 flips the wrong claim card to its corrected face with a spring check", () => {
    const s = scenes();
    expect(s).toContain("easeOutBack");
    expect(s).toMatch(/rotation\.y = flip \* Math\.PI/);
  });
});

// ---- presence hooks ------------------------------------------------------

function VisProbe() {
  const { ref, visible } = useSceneVisibility<HTMLDivElement>();
  return createElement("div", { ref, "data-visible": String(visible) });
}

function MotionProbe() {
  return createElement("div", { "data-reduced": String(usePrefersReducedMotion()) });
}

describe("useSceneVisibility", () => {
  it("starts hidden and follows IntersectionObserver entries (pause offscreen)", () => {
    let cb: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    (globalThis as Record<string, unknown>).IntersectionObserver = vi
      .fn()
      .mockImplementation((c: IntersectionObserverCallback) => {
        cb = c;
        return { observe: vi.fn(), disconnect };
      });
    const h = render(createElement(VisProbe));
    const el = () => h.querySelector("div")!;
    expect(el().getAttribute("data-visible")).toBe("false");
    act(() => cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(el().getAttribute("data-visible")).toBe("true");
    act(() => cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(el().getAttribute("data-visible")).toBe("false");
    act(() => root!.unmount());
    expect(disconnect).toHaveBeenCalled();
    root = null;
  });

  it("defaults to visible when IntersectionObserver is unavailable (jsdom)", () => {
    const h = render(createElement(VisProbe));
    expect(h.querySelector("div")!.getAttribute("data-visible")).toBe("true");
  });
});

describe("usePrefersReducedMotion", () => {
  it("reflects the media query and tracks changes", () => {
    const savedMatchMedia = window.matchMedia;
    let change: ((e: { matches: boolean }) => void) | null = null;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { change = fn; },
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    const h = render(createElement(MotionProbe));
    const el = () => h.querySelector("div")!;
    expect(el().getAttribute("data-reduced")).toBe("true");
    act(() => change!({ matches: false }));
    expect(el().getAttribute("data-reduced")).toBe("false");
    window.matchMedia = savedMatchMedia;
  });
});

// ---- TrackScene fallback -------------------------------------------------

describe("TrackScene (non-WebGL environment)", () => {
  it("renders the CSS fallback viz, aria-hidden, with its data-testid", () => {
    const h = render(createElement(TrackScene, { id: "T3" }));
    const scene = h.querySelector('[data-testid="scene-t3"]')!;
    expect(scene).not.toBeNull();
    expect(scene.getAttribute("aria-hidden")).toBe("true");
    // jsdom has no WebGL context -> no canvas, CSS preview instead
    expect(scene.querySelector("canvas")).toBeNull();
    expect(scene.querySelector(".tviz")).not.toBeNull();
  });
});

// ---- TrackBands layout ---------------------------------------------------

describe("TrackBands", () => {
  it("renders four bands, each a link to /exam with a scene testid", () => {
    const h = render(createElement(TrackBands));
    const links = [...h.querySelectorAll("a")];
    expect(links).toHaveLength(4);
    for (const a of links) expect(a.getAttribute("href")).toBe("/exam");
    for (const id of ["t1", "t2", "t3", "t4"]) {
      expect(h.querySelector(`[data-testid="scene-${id}"]`)).not.toBeNull();
    }
  });

  it("alternates sides: bands 2 and 4 are flipped (editorial rhythm, not a grid)", () => {
    const h = render(createElement(TrackBands));
    const bands = [...h.querySelectorAll(".track-band")];
    expect(bands.map((b) => b.classList.contains("flip"))).toEqual([false, true, false, true]);
  });

  it("shows oversized numerals + name + one supporting line per band", () => {
    const h = render(createElement(TrackBands));
    const nums = [...h.querySelectorAll(".track-band-num")].map((n) => n.textContent);
    expect(nums).toEqual(["T1", "T2", "T3", "T4"]);
    expect(h.textContent).toContain("Creative Build");
    expect(h.textContent).toContain("Can you spot the fakes?");
    expect(h.textContent).toContain("The assistant plants three errors. Catch them.");
    expect([...h.querySelectorAll(".track-band-line")]).toHaveLength(4);
  });

  it("numerals are decorative; the link label carries the meaning for AT", () => {
    const h = render(createElement(TrackBands));
    for (const n of h.querySelectorAll(".track-band-num")) {
      expect(n.getAttribute("aria-hidden")).toBe("true");
    }
    const first = h.querySelector("a")!;
    expect(first.getAttribute("aria-label")).toMatch(/^T1 Creative Build: /);
  });
});

describe("supportLine", () => {
  it("strips the numeral prefix and capitalizes", () => {
    expect(supportLine("T2 — can you spot the fakes?")).toBe("Can you spot the fakes?");
    expect(supportLine("No prefix here")).toBe("No prefix here");
  });
});
