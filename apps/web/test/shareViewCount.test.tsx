// @vitest-environment jsdom
/**
 * THE PER-LINK VIEW COUNTER, on the surface that posts it.
 *
 * Modelled on `funnelSurfaces.test.tsx`, and end to end through the REAL
 * share view and the REAL emitter for the same reason: what goes wrong with a
 * counter is not "the function was called", it is a count on a render nobody
 * asked for, a count of a card that never resolved, or two counts for one
 * open. A mock proves none of those.
 *
 * Every promise the module makes has a test here: resolved only, anonymous,
 * once per session, harmless when it fails, silent with no backend, and the
 * token in no log and no error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type FunctionComponent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushAsync, withQueryClient } from "./helpers/clientPage";
import { sharePayloadFrom } from "@ailx/report";
import { resetFunnel } from "../lib/data/funnel";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "c".repeat(43);
const VIEWS_PATH = `/v1/share/${TOKEN}/views`;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}

/** Every request the page made, in order. */
const calls: { url: string; init: RequestInit }[] = [];
/** The POSTs to the view counter, which is what these tests are about. */
const counted = (): { url: string; init: RequestInit }[] =>
  calls.filter((c) => c.init.method === "POST" && c.url.includes("/views"));

const share = {
  status: "unlisted",
  createdAt: "2026-02-03T10:00:00.000Z",
  views: 4,
  payload: sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
    instrument: "ailx 2026.1",
  }),
};

/** The share read answers `status`; everything else (funnel, count) is 204. */
function stubFetch(status: number, body: unknown = { share }): void {
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes("/views") || String(url).includes("/events")) {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(body), { status });
  });
}

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render<P extends object>(node: FunctionComponent<P>, props?: P): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(withQueryClient(createElement(node, props)));
  });
  await flushAsync();
  return host;
}

async function renderShare(): Promise<HTMLElement> {
  const { ShareView } = await import("../features/share/ShareView");
  return render(ShareView);
}

beforeEach(() => {
  calls.length = 0;
  resetFunnel();
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: true });
  vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", "https://api.example");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  vi.doMock("next/navigation", () => ({
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    useParams: () => ({ token: TOKEN }),
  }));
  stubFetch(200);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  resetFunnel();
  vi.doUnmock("next/navigation");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("counting a view of a share card", () => {
  it("posts once to the route the manifest spells, for a card that resolved", async () => {
    await renderShare();
    expect(counted()).toHaveLength(1);
    expect(counted()[0]!.url).toBe(`https://api.example${VIEWS_PATH}`);
    expect(counted()[0]!.init.method).toBe("POST");
  });

  it("sends no identity, no cookie and no body", async () => {
    await renderShare();
    const init = counted()[0]!.init;
    expect(init.credentials).toBe("omit");
    expect(init.body ?? null).toBeNull();
    // No header at all: not an identity, not a trace, not even a content
    // type — which is also what keeps the request CORS-simple.
    expect(init.headers ?? null).toBeNull();
  });

  it("counts nothing while the card is still loading", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes("/events")) return new Response(null, { status: 204 });
      await gate;
      return new Response(JSON.stringify({ share }), { status: 200 });
    });
    const el = await renderShare();
    expect(el.textContent).toContain("Opening this card");
    expect(counted()).toHaveLength(0);
    await act(async () => { release!(); await flushAsync(); });
  });

  it("counts nothing when the link 404s", async () => {
    stubFetch(404, {});
    await expect(renderShare()).rejects.toThrow();
    expect(counted()).toHaveLength(0);
  });

  it("counts nothing when the service refuses the read", async () => {
    stubFetch(403, { error: { code: "forbidden", message: "no" } });
    const el = await renderShare();
    expect(el.textContent).toContain("Opening this card");
    expect(counted()).toHaveLength(0);
  });

  it("counts nothing when the service cannot be reached at all", async () => {
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes("/events")) return new Response(null, { status: 204 });
      throw new TypeError("network down");
    });
    const el = await renderShare();
    expect(el.textContent).toContain("did not answer");
    expect(counted()).toHaveLength(0);
  });
});

describe("once per token per browsing session", () => {
  it("does not count twice when the component is mounted twice (strict mode)", async () => {
    const { ShareViewCount } = await import("../components/ShareViewCount");
    // The emitter needs a session before the counter can claim a key, which
    // a mounted share view already has; here the double mount IS the test.
    await render(ShareViewCount, { token: TOKEN });
    await render(ShareViewCount, { token: TOKEN });
    expect(counted()).toHaveLength(1);
  });

  it("does not count twice when the page re-renders", async () => {
    await renderShare();
    const { ShareView } = await import("../features/share/ShareView");
    await act(async () => { root!.render(withQueryClient(createElement(ShareView))); });
    await flushAsync();
    expect(counted()).toHaveLength(1);
  });

  it("does not count twice when the reader reloads the same tab", async () => {
    await renderShare();
    act(() => root!.unmount());
    host!.remove();
    // A reload keeps sessionStorage and rebuilds the singleton, exactly as a
    // real one does.
    resetFunnel();
    await renderShare();
    expect(counted()).toHaveLength(1);
  });

  it("counts a DIFFERENT card in the same session", async () => {
    const { ShareViewCount } = await import("../components/ShareViewCount");
    await render(ShareViewCount, { token: TOKEN });
    await render(ShareViewCount, { token: "d".repeat(43) });
    expect(counted()).toHaveLength(2);
  });
});

describe("it can never hurt the page", () => {
  it("renders the whole card when the count is refused", async () => {
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes("/views")) return new Response("nope", { status: 500 });
      if (String(url).includes("/events")) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ share }), { status: 200 });
    });
    const el = await renderShare();
    expect(counted()).toHaveLength(1);
    expect(el.textContent).toContain("How the run was shaped");
    expect(el.textContent).toContain("4 views");
  });

  it("renders the whole card when the count THROWS", async () => {
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes("/views")) throw new TypeError("blocked by the browser");
      if (String(url).includes("/events")) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ share }), { status: 200 });
    });
    const el = await renderShare();
    expect(el.textContent).toContain("How the run was shaped");
  });

  it("never writes the token to a log or an error", async () => {
    const said: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        said.push(args.map((a) => (a instanceof Error ? `${a.message}${a.stack ?? ""}` : String(a))).join(" "));
      });
    }
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes("/views")) throw new TypeError("blocked by the browser");
      if (String(url).includes("/events")) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ share }), { status: 200 });
    });
    await renderShare();
    expect(said.join("\n")).not.toContain(TOKEN);
    // Nor is the capability left sitting in the dedupe record: the key is a
    // digest of the token, not the token.
    expect(JSON.stringify(window.sessionStorage.getItem("ailx.funnel.session.v1"))).not.toContain(TOKEN);
    expect(JSON.stringify(window.localStorage)).not.toContain(TOKEN);
  });
});

describe("silence with no backend", () => {
  it("posts nothing at all, and claims no dedupe key", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", "");
    const { ShareViewCount } = await import("../components/ShareViewCount");
    await render(ShareViewCount, { token: TOKEN });
    expect(calls).toEqual([]);
    expect(window.sessionStorage.getItem("ailx.funnel.session.v1")).toBeNull();
  });
});
