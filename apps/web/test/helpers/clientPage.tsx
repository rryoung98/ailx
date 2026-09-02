/**
 * Render a CLIENT component the way the browser does, and wait.
 *
 * The seven database-reading pages are client components now: they fetch on
 * mount, so `renderToStaticMarkup` only ever sees their loading state. These
 * two helpers are the whole difference — mount under `act` so effects and
 * their promises flush, then read the DOM.
 *
 * One copy, because six suites need exactly this and a private copy in each
 * would drift on the day React changes how effects flush.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { QueryProvider } from "../../lib/QueryProvider";

/**
 * Every client page reads the service through `useService`, which is a
 * TanStack Query `useQuery` and needs a client in context — the app mounts one
 * in `app/layout.tsx`, so a test that mounts a page without one is testing a
 * tree the browser never renders. A FRESH provider per render, because a
 * shared cache would let one test answer another test's fetch.
 */
export function withQueryClient(element: ReactElement): ReactElement {
  return createElement(QueryProvider, null, element);
}

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Let a page's data arrive. One empty `act` was enough while the seam was a
 * bare effect; TanStack Query notifies through its own scheduler, so the
 * update lands a MACROTASK later and a microtask flush alone leaves the
 * second render in a suite stuck on "Loading…". Three timer turns, which is
 * what a browser does in about a millisecond.
 */
export async function flushAsync(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Mount, flush effects and their microtasks, return the served HTML. */
export async function renderClient(element: ReactElement): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(withQueryClient(element));
  });
  await flushAsync();
  const html = host.innerHTML;
  await act(async () => {
    root.unmount();
  });
  host.remove();
  return html;
}

/** The first paint, before any fetch resolves — the loading state. */
export async function renderClientPending(element: ReactElement): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(withQueryClient(element));
  });
  const html = host.innerHTML;
  await act(async () => {
    root.unmount();
  });
  host.remove();
  return html;
}

export interface StubbedCall {
  url: string;
  headers: Record<string, string>;
}

/**
 * Answer every `fetch` with one JSON body and status, recording what was
 * asked for — the URL a page builds and the identity headers it sent are
 * both part of its contract now.
 */
export function stubJsonFetch(
  reply: () => { status: number; body: unknown },
): StubbedCall[] {
  const calls: StubbedCall[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    calls.push({ url: String(url), headers });
    const { status, body } = reply();
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return calls;
}

/** Every `fetch` throws, the way an offline tab, a DNS failure or CORS does. */
export function stubFailingFetch(message = "network down"): void {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError(message);
  });
}

/** Every `fetch` hangs — the page must stay in its loading state. */
export function stubHangingFetch(): void {
  vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
}

/** jsdom here does not always expose localStorage; identity needs one. */
export function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => void store.delete(k),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
    },
    configurable: true,
  });
  return store;
}
