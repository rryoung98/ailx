// @vitest-environment jsdom
/**
 * THE HANG, at the four call sites a candidate actually touches.
 *
 * TEN-210: nothing in `apps/web` bounded a fetch, so a socket that opened and
 * then stalled never rejected. Every careful `catch` in this app was dead on
 * that path, and the surfaces below sat on "Loading…", "Checking…" or
 * "Sending…" for as long as the tab was open.
 *
 * Each test here stubs `fetch` with a promise that NEVER SETTLES ON ITS OWN.
 * It settles for exactly one reason: the request carried an `AbortSignal` and
 * something aborted it. That is the whole point — a call site with no bound
 * hangs this test rather than failing it, and a call site with a bound ends
 * in the visible failure state its own copy describes.
 *
 * The clock is vitest's, so nothing here waits ten real seconds; the numbers
 * come from `CALL_TIMEOUT_MS`, never from a literal spelled again here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PRACTICE_BANK, PRACTICE_DECK_SIZE } from "@ailx/report";
import { CALL_TIMEOUT_MS } from "../lib/data/deadline";

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

/**
 * A request that behaves like a stalled socket: the response never comes, and
 * the promise settles ONLY when the caller's own signal aborts. A call site
 * that passes no signal never gets an answer at all — which is what this file
 * exists to catch.
 */
function stallOn(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    if (signal == null) return; // no bound: hang, exactly as production did
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Advance past a class's bound and let React settle the state it produces. */
async function pastBound(cls: keyof typeof CALL_TIMEOUT_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS[cls] + 1);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

let root: Root | null = null;
let host: HTMLElement;

function mountHost(): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
}

beforeEach(() => {
  vi.useFakeTimers();
  store.clear();
  window.localStorage.setItem("foray:dev-user", "tester");
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const alertText = (): string =>
  [...host.querySelectorAll('[role="alert"]')].map((el) => el.textContent ?? "").join(" ");

// ---------------------------------------------------------------------------
// The model gateway
// ---------------------------------------------------------------------------

describe("the model gateway, when the service stalls", () => {
  it("gives up on the control plane and reports a failure the panel can print", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => stallOn(init?.signal)));
    const { readKeyStatus, statusFailureCopy } = await import("../lib/data/modelGateway");
    const pending = readKeyStatus();
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS.read + 1);
    const result = await pending;
    expect(result.ok).toBe(false);
    // Zero is "the call never landed", which is what the panel prints.
    expect(result.ok === false ? result.httpStatus : -1).toBe(0);
    expect(statusFailureCopy(0)).toMatch(/did not answer/);
    expect(statusFailureCopy(0)).toMatch(/what it holds is unknown/);
  });

  it("bounds a generation, and still lets a runner's cancel win first", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => stallOn(init?.signal)));
    const { modelGatewayFetch } = await import("../lib/data/modelGateway");

    // The runner's own cancel button, pressed before the bound is reached.
    const cancel = new AbortController();
    const cancelled = modelGatewayFetch("https://model.example/v1/chat/completions", {
      signal: cancel.signal,
    }).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(10);
    cancel.abort(new DOMException("the candidate stopped it", "AbortError"));
    const stopped = (await cancelled) as { name?: string };
    expect(stopped.name).toBe("AbortError");

    // And with nobody cancelling, the bound itself ends the wait.
    const bounded = modelGatewayFetch("https://model.example/v1/chat/completions").catch(
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS.model + 1);
    const timedOut = (await bounded) as { name?: string };
    expect(timedOut.name).toBe("TimeoutError");
  });
});

// ---------------------------------------------------------------------------
// The practice drill's submit
// ---------------------------------------------------------------------------

describe("the practice drill, when the submit stalls", () => {
  it("ends in the visible 'not recorded' state and says the service was slow", async () => {
    const SESSION = "11111111-2222-3333-4444-555555555555";
    const dealt = PRACTICE_BANK.slice(0, PRACTICE_DECK_SIZE).map((i) => i.id);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        // The deal lands. Only the submit stalls, so the round on screen is
        // real work a candidate just did.
        if (String(url).endsWith("/api/practice")) {
          return Promise.resolve(
            new Response(JSON.stringify({ session: { id: SESSION, itemIds: dealt } }), {
              status: 201,
            }),
          );
        }
        return stallOn(init?.signal);
      }),
    );
    if (typeof crypto.randomUUID !== "function") {
      Object.defineProperty(crypto, "randomUUID", { value: () => SESSION, configurable: true });
    }
    const { PracticeDrill } = await import("../features/practice/PracticeDrill");
    mountHost();
    await act(async () => {
      root!.render(createElement(PracticeDrill, {}));
    });
    const click = async (match: RegExp): Promise<void> => {
      const btn = [...host.querySelectorAll("button")].find((b) => match.test(b.textContent ?? ""));
      expect(btn, `button ${match}`).toBeTruthy();
      await act(async () => {
        btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    for (let i = 0; i < PRACTICE_DECK_SIZE; i++) {
      await click(/AI-generated/);
      await click(/Next card|Finish the round/);
    }
    // The round is over and the send is in flight: nothing says it failed yet.
    expect(alertText()).not.toMatch(/not recorded yet/);
    await pastBound("write");
    expect(alertText()).toMatch(/not recorded yet/);
    expect(alertText()).toMatch(/slow rather than down/);
    // The work is still on screen, and the retry is offered.
    expect([...host.querySelectorAll("button")].some((b) => /Try sending it again/.test(b.textContent ?? ""))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The wall
// ---------------------------------------------------------------------------

describe("/wall, when the shared demo service stalls", () => {
  it("stops saying 'Loading the wall…' and offers the retry", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => stallOn(init?.signal)));
    const WallPage = (await import("../app/wall/page")).default;
    mountHost();
    await act(async () => {
      root!.render(createElement(WallPage));
    });
    expect(host.textContent).toContain("Loading the wall…");
    await pastBound("read");
    expect(host.textContent).not.toContain("Loading the wall…");
    expect(alertText()).toMatch(/did not answer in time/);
    expect(host.querySelector('a[href="/gallery"]')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The report's credential and share panels
// ---------------------------------------------------------------------------

describe("the credential panel, when the exam service stalls", () => {
  it("stops saying 'Checking…' and shows the offer with the slow-service line", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => stallOn(init?.signal));
    vi.stubGlobal("fetch", fetchMock);
    window.fetch = fetchMock as unknown as typeof fetch;
    const { CredentialPanel } = await import("../features/report/CredentialPanel");
    mountHost();
    await act(async () => {
      root!.render(
        createElement(CredentialPanel, { attemptId: "11111111-1111-4111-8111-111111111111" }),
      );
    });
    expect(host.textContent).toContain("Checking…");
    await pastBound("read");
    expect(host.textContent).not.toContain("Checking…");
    expect(alertText()).toMatch(/did not answer in time/);
    expect(alertText()).toMatch(/your sitting is saved/i);
  });
});

describe("the share panel, when the exam service stalls", () => {
  it("stops saying 'Checking…' and says the service was too slow", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => stallOn(init?.signal));
    vi.stubGlobal("fetch", fetchMock);
    window.fetch = fetchMock as unknown as typeof fetch;
    const { ShareLink } = await import("../features/report/ShareLink");
    mountHost();
    await act(async () => {
      root!.render(
        createElement(ShareLink, { attemptId: "11111111-1111-4111-8111-111111111111" }),
      );
    });
    expect(host.textContent).toContain("Checking…");
    await pastBound("read");
    expect(host.textContent).not.toContain("Checking…");
    expect(alertText()).toMatch(/did not answer in time/);
    expect(alertText()).toMatch(/your run is saved/i);
  });

  it("bounds the CREATE too, so a stalled write is not a button stuck on 'Working…'", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET"
        ? Promise.resolve(new Response("{}", { status: 404 }))
        : stallOn(init?.signal),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.fetch = fetchMock as unknown as typeof fetch;
    const { ShareLink } = await import("../features/report/ShareLink");
    mountHost();
    await act(async () => {
      root!.render(
        createElement(ShareLink, { attemptId: "11111111-1111-4111-8111-111111111111" }),
      );
    });
    const create = [...host.querySelectorAll("button")].find((b) =>
      /Create a share link/i.test(b.textContent ?? ""),
    );
    expect(create, "a create button").toBeTruthy();
    await act(async () => {
      create!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await pastBound("write");
    expect(alertText()).toMatch(/did not answer in time/);
  });
});
