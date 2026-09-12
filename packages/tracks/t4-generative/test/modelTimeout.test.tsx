// @vitest-environment jsdom
/**
 * A T4 image call must be bounded and stoppable (TEN-212).
 *
 * Same defect as T1's assist: `requestImage` carried no signal and no
 * deadline, so an endpoint that accepted the request and then said nothing
 * left `genBusy` true for the rest of the track — Generate disabled, clock
 * running, nothing to press. A `fetch` that never settles never rejects, so
 * the transport cannot be the thing that ends the wait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import { LLM_BASE_URL_STORAGE, ImageGenError, buildImageRequest, requestImage } from "../src/imagegen.js";

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

/** Never settles, and records the init it was handed (for the signal). */
function hungFetch() {
  const inits: RequestInit[] = [];
  const impl = (_url: string, init?: RequestInit) => {
    inits.push(init ?? {});
    return new Promise<never>(() => {});
  };
  return { impl: impl as never, inits };
}

const payload = buildImageRequest("a boat", "google/gemini-3.1-flash-image");

describe("requestImage — deadline and cancel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects with an explicit 'did not answer' state when the endpoint never answers", async () => {
    const { impl, inits } = hungFetch();
    const call = requestImage(impl, payload, "https://x/v1", { timeoutMs: 1000 });
    // The handler goes on BEFORE the clock moves: a rejection that lands with
    // nothing attached is an unhandled rejection in the runner, not a caught one.
    const assertion = expect(call).rejects.toThrow(/did not answer/i);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(inits[0]?.signal?.aborted).toBe(true);
  });

  it("honours the caller's cancel control before the deadline", async () => {
    const { impl } = hungFetch();
    const controller = new AbortController();
    const call = requestImage(impl, payload, "https://x/v1", { signal: controller.signal });
    controller.abort();
    await expect(call).rejects.toBeInstanceOf(ImageGenError);
  });
});

describe("T4 runner — a hung image call does not burn the track", () => {
  let root: Root | null = null;
  let host: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    lsStore.clear();
    lsStore.set(LLM_BASE_URL_STORAGE, "https://ailx-shared-demo.vercel.app/api/v1");
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    vi.useRealTimers();
  });

  function button(match: (label: string) => boolean): HTMLButtonElement | undefined {
    return [...host.querySelectorAll("button")].find((b) => match(b.textContent ?? "")) as
      | HTMLButtonElement
      | undefined;
  }

  function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        createElement(Runner, {
          attemptId: "a-1",
          locale: "en" as const,
          config: {},
          onEvent: () => {},
          onComplete: () => {},
          secondsRemaining: 3600,
          modelFetch: hungFetch().impl as never,
        }),
      ),
    );
  }

  async function generate() {
    const ta = host.querySelector('textarea[aria-label="Image prompt"]') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(ta, "three boats on a storm wave");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button((l) => l.startsWith("Generate draft"))!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("renders 'the model did not answer' and re-enables Generate after the deadline", async () => {
    mount();
    await generate();
    expect(button((l) => l === "Generating…")?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(91_000);
    });
    expect(host.querySelector('[role="alert"]')?.textContent ?? "").toMatch(/did not answer/i);
    expect(button((l) => l.startsWith("Generate draft"))?.disabled).toBe(false);
  });

  it("offers a stop control while the call is in flight", async () => {
    mount();
    await generate();
    const stop = button((l) => l === "Stop");
    expect(stop, "a cancel control while generating").toBeTruthy();
    await act(async () => {
      stop!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(button((l) => l.startsWith("Generate draft"))?.disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent ?? "").toMatch(/stopped/i);
  });
});
