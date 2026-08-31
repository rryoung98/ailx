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
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Mount, flush effects and their microtasks, return the served HTML. */
export async function renderClient(element: ReactElement): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  // A second empty act lets the fetch promise chain settle before we look.
  await act(async () => {});
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
    root.render(element);
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
