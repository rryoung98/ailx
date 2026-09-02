// @vitest-environment jsdom
/**
 * HeroCanvas regression tests: the landing particle field must be purely
 * decorative (aria-hidden), must NOT start an animation loop under
 * prefers-reduced-motion (a single static frame only), must animate
 * otherwise, and must survive environments with no 2D context or no
 * IntersectionObserver (jsdom) without crashing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HeroCanvas } from "../features/landing/HeroCanvas";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let rafSpy: ReturnType<typeof vi.fn>;

function stubCtx() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
}

/**
 * Hand the component a 2D context. `getContext` is overloaded (2d, webgl,
 * webgpu, ...) and TypeScript resolves a spy against the LAST overload, so a
 * CanvasRenderingContext2D is rejected as "not a GPUCanvasContext". Cast once
 * here rather than at each of the call sites.
 */
function stubGetContext(ctx: CanvasRenderingContext2D) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
}

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

function mount() {
  act(() => {
    root.render(createElement(HeroCanvas));
  });
  return host.querySelector("canvas")!;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  rafSpy = vi.fn().mockReturnValue(1);
  window.requestAnimationFrame = rafSpy as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("HeroCanvas", () => {
  it("renders an aria-hidden, decorative canvas", () => {
    const canvas = mount();
    expect(canvas).toBeTruthy();
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.className).toContain("hero-canvas");
  });

  it("does not crash when 2D context is unavailable (jsdom default)", () => {
    // jsdom returns null from getContext("2d") without node-canvas.
    const canvas = mount();
    expect(canvas.getContext("2d")).toBeNull();
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("REGRESSION: never schedules an animation frame under prefers-reduced-motion", () => {
    const ctx = stubCtx();
    stubGetContext(ctx);
    stubMatchMedia(true);
    mount();
    expect(rafSpy).not.toHaveBeenCalled();
    // …but it still painted a static frame.
    expect((ctx.arc as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it("animates when motion is allowed, and cancels on unmount", () => {
    const ctx = stubCtx();
    stubGetContext(ctx);
    stubMatchMedia(false);
    mount();
    expect(rafSpy).toHaveBeenCalled();
    act(() => root.unmount());
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    // re-create root so afterEach unmount is a no-op on a fresh root
    root = createRoot(host);
  });

  it("pauses when the canvas leaves the viewport (IntersectionObserver)", () => {
    const ctx = stubCtx();
    stubGetContext(ctx);
    stubMatchMedia(false);
    let ioCallback: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    (globalThis as Record<string, unknown>).IntersectionObserver = vi
      .fn()
      .mockImplementation((cb: IntersectionObserverCallback) => {
        ioCallback = cb;
        return { observe: vi.fn(), disconnect };
      });
    const cancelSpy = window.cancelAnimationFrame as ReturnType<typeof vi.fn>;
    mount();
    expect(rafSpy).toHaveBeenCalled();
    act(() => {
      ioCallback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(cancelSpy).toHaveBeenCalled();
    delete (globalThis as Record<string, unknown>).IntersectionObserver;
  });
});
