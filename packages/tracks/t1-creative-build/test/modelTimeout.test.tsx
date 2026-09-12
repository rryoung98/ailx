// @vitest-environment jsdom
/**
 * A model call must be bounded and stoppable (TEN-212).
 *
 * A provider that accepts the connection and then says nothing used to leave
 * the assist panel busy for the rest of the track: the busy flag cleared in a
 * `finally` that never ran, so Send stayed disabled behind a clock running to
 * zero and there was nothing to press. The stall is charged to the candidate,
 * and TEN-116 already settled that our own stalls may not be.
 *
 * These tests use a fetch that NEVER SETTLES, which is the case a transport
 * timeout does not cover: a `fetch` that never settles never rejects either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import {
  LLM_BASE_URL_STORAGE,
  OpenRouterError,
  buildVibeRequest,
  requestVibeCompletion,
} from "../src/openrouter.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
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

const payload = buildVibeRequest({ model: "m", brief: "b", currentHtml: "<html></html>", userPrompt: "p" });

describe("requestVibeCompletion — deadline and cancel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects with an explicit 'did not answer' state when the endpoint never answers", async () => {
    const { impl } = hungFetch();
    const call = requestVibeCompletion(impl, payload, "https://x/v1", { timeoutMs: 1000 });
    const assertion = expect(call).rejects.toThrow(/did not answer/i);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("aborts the underlying request rather than leaving it in flight", async () => {
    const { impl, inits } = hungFetch();
    const call = requestVibeCompletion(impl, payload, "https://x/v1", { timeoutMs: 1000 });
    // The handler goes on BEFORE the clock moves: a rejection that lands with
    // nothing attached is an unhandled rejection in the runner, not a caught one.
    const assertion = expect(call).rejects.toBeInstanceOf(OpenRouterError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(inits[0]?.signal?.aborted).toBe(true);
  });

  it("honours the caller's cancel control before the deadline", async () => {
    const { impl, inits } = hungFetch();
    const controller = new AbortController();
    const call = requestVibeCompletion(impl, payload, "https://x/v1", {
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(call).rejects.toThrow(/stopped/i);
    expect(inits[0]?.signal?.aborted).toBe(true);
  });
});

describe("T1 runner — a hung model call does not burn the track", () => {
  let root: Root | null = null;
  let host: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    store.clear();
    store.set(LLM_BASE_URL_STORAGE, "https://ailx-shared-demo.vercel.app/api/v1");
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

  async function sendPrompt() {
    const ta = host.querySelector('textarea[aria-label="Assist prompt"]') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(ta, "make it bolder");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button((l) => l === "Send")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
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
          secondsRemaining: 600,
          modelFetch: hungFetch().impl as never,
        }),
      ),
    );
  }

  it("renders 'the model did not answer' and re-enables Send after the deadline", async () => {
    mount();
    await sendPrompt();
    expect(button((l) => l === "Asking…")?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent ?? "").toMatch(/did not answer/i);
    expect(button((l) => l === "Send")?.disabled).toBe(false);
  });

  it("offers a stop control while the call is in flight", async () => {
    mount();
    await sendPrompt();
    const stop = button((l) => l === "Stop");
    expect(stop, "a cancel control while asking").toBeTruthy();
    await act(async () => {
      stop!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(button((l) => l === "Send")?.disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent ?? "").toMatch(/stopped/i);
  });
});
