// @vitest-environment jsdom
/**
 * The run-start panel, in the two builds it must tell apart (TEN-62).
 *
 * HOSTED: the browser starts a connection, travels to the provider and comes
 * back with a code it hands to the exam service. It never receives a provider
 * key and never does the exchange. Everything asserted below about "connected"
 * is asserted about a FINGERPRINT.
 *
 * STATIC EXPORT: there is no service to hold a key against, so there is no key
 * affordance AT ALL — no sign-in, no paste box, not a hidden one. The panel
 * says so and offers the capped shared demo instead.
 *
 * The old file tested a pasted key persisted to `ailx:openrouter-key`. That
 * slot no longer exists, and a test that it never comes back is
 * `packages/tracks/t1-creative-build/test/runnerHooks.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectPanel, connectedCopy } from "../features/exam/ConnectPanel";
import { QueryProvider } from "../lib/QueryProvider";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// This vitest/jsdom combo exposes no window.localStorage — install a tiny
// in-memory shim (the component itself try/catches storage access anyway).
const store = new Map<string, string>();
const shim = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
};
Object.defineProperty(window, "localStorage", { value: shim, configurable: true });

const ENDPOINT_SLOT = "ailx:llm-base-url";

let root: Root | null = null;
let host: HTMLElement;
/** Where the panel tried to send the browser, without actually navigating. */
let navigated: string | null = null;
/** Every gateway call the panel made, in order. */
let calls: Array<{ url: string; method: string; body: unknown }> = [];

/** One canned reply per route, by the path fragment that identifies it. */
type Reply = { status: number; body: unknown };
let replies: Record<string, Reply> = {};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      const hit = Object.entries(replies).find(([fragment]) => url.includes(fragment));
      const reply = hit === undefined ? { status: 404, body: {} } : hit[1];
      return {
        status: reply.status,
        json: async () => reply.body,
      } as unknown as Response;
    }),
  );
}

/** Pretend to be the hosted build (or not), the way `mode.ts` reads it. */
function setHosted(hosted: boolean) {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", hosted ? "1" : "");
  vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", hosted ? "https://exam.example" : "");
}

/**
 * The URL the panel thinks it is on. jsdom refuses a real navigation, so
 * `location` is stubbed over a plain string: `land()` sets it, the panel's
 * `history.replaceState` rewrites it (which is how a claimed code leaves the
 * address bar), and assigning `href` records a navigation instead of making
 * one.
 */
let currentUrl = "http://localhost/exam";

/** Land on a URL, so the callback effect has something to claim. */
function land(search: string) {
  currentUrl = `http://localhost/exam${search}`;
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(QueryProvider, null, createElement(ConnectPanel)));
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;
}

async function click(label: string) {
  const btn = button(label);
  expect(btn, `button ${label} in: ${[...host.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`).toBeTruthy();
  await act(async () => {
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function setInput(aria: string, value: string) {
  const el = host.querySelector(`input[aria-label="${aria}"]`) as HTMLInputElement | null;
  expect(el, `input ${aria}`).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  calls = [];
  replies = {};
  navigated = null;
  land("");
  stubFetch();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get href() {
        return currentUrl;
      },
      set href(value: string) {
        navigated = value;
      },
      get search() {
        return new URL(currentUrl).search;
      },
    },
  });
  vi.spyOn(window.history, "replaceState").mockImplementation((_s, _t, url) => {
    currentUrl = new URL(String(url), currentUrl).toString();
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the static export has no key affordance at all", () => {
  beforeEach(() => setHosted(false));

  it("offers no sign-in and no paste box, and says why", async () => {
    await mount();
    expect(button("Connect OpenRouter")).toBeUndefined();
    expect(host.querySelector('input[aria-label="OpenRouter API key"]')).toBeNull();
    expect(host.querySelector('[data-testid="static-no-key"]')?.textContent).toContain(
      "no key to paste",
    );
  });

  it("opens no key box under manual setup either — only an endpoint", async () => {
    await mount();
    await click("Manual setup");
    expect(host.querySelector('input[aria-label="OpenRouter API key"]')).toBeNull();
    expect(host.querySelector('input[aria-label="API base URL"]')).toBeTruthy();
  });

  it("asks the exam service nothing: there is none", async () => {
    await mount();
    await click("Try the shared demo model");
    expect(calls).toEqual([]);
  });

  it("the shared demo sets the capped proxy endpoint, and stores no token", async () => {
    await mount();
    await click("Try the shared demo model");
    expect(window.localStorage.getItem(ENDPOINT_SLOT)).toBe(
      "https://ailx-shared-demo.vercel.app/api/v1",
    );
    expect(window.localStorage.getItem("ailx:openrouter-key")).toBeNull();
    expect(host.textContent).toContain("no key held");
    await click("Disconnect");
    expect(window.localStorage.getItem(ENDPOINT_SLOT)).toBeNull();
  });

  it("a local endpoint disconnects cleanly (no stuck real mode)", async () => {
    await mount();
    await click("Manual setup");
    setInput("API base URL", "http://localhost:11434/v1");
    expect(window.localStorage.getItem(ENDPOINT_SLOT)).toBe("http://localhost:11434/v1");
    await click("Disconnect");
    expect(window.localStorage.getItem(ENDPOINT_SLOT)).toBeNull();
  });

  it("disconnect leaves unrelated slots alone", async () => {
    window.localStorage.setItem("ailx:dev-user", "ui-worker-1");
    await mount();
    await click("Try the shared demo model");
    await click("Disconnect");
    expect(window.localStorage.getItem("ailx:dev-user")).toBe("ui-worker-1");
  });
});

describe("the hosted build connects through the service", () => {
  beforeEach(() => setHosted(true));

  it("asks the service what it holds, and offers a connection when it holds nothing", async () => {
    replies = { "/model/key": { status: 200, body: { connected: false, provider: "openrouter" } } };
    await mount();
    expect(calls[0].url).toBe("https://exam.example/v1/model/key");
    expect(button("Connect OpenRouter")).toBeTruthy();
    expect(host.querySelector('input[aria-label="OpenRouter API key"]')).toBeNull();
  });

  it("shows a FINGERPRINT and the three things that are true of it", async () => {
    replies = {
      "/model/key": {
        status: 200,
        body: { connected: true, provider: "openrouter", fingerprint: "a1b2c3d4e5f6" },
      },
    };
    await mount();
    const text = host.textContent ?? "";
    expect(text).toContain("a1b2c3d4e5f6");
    expect(text).toContain("this browser never received your key");
    expect(text).toContain("sealed against your account");
    expect(text).toContain("Disconnect deletes it");
    // The claim that stopped being true is gone.
    expect(text).not.toContain("key stays in this browser");
  });

  it("mirrors a held key into the ONE endpoint slot the runners read", async () => {
    replies = {
      "/model/key": { status: 200, body: { connected: true, provider: "openrouter", fingerprint: "ff00ff00ff00" } },
    };
    await mount();
    expect(window.localStorage.getItem(ENDPOINT_SLOT)).toBe("https://exam.example/v1/model");
  });

  it("sends the browser to the URL the SERVICE minted, holding no verifier", async () => {
    replies = {
      "/model/key": { status: 200, body: { connected: false, provider: "openrouter" } },
      "/model/connect/start": {
        status: 200,
        body: { provider: "openrouter", state: "st-1", authorizeUrl: "https://openrouter.ai/auth?x=1" },
      },
    };
    await mount();
    await click("Connect OpenRouter");
    expect(navigated).toBe("https://openrouter.ai/auth?x=1");
    // Nothing about the exchange is kept here: no verifier, no state, nothing.
    expect([...store.keys()]).not.toContain("ailx:openrouter-pkce-verifier");
    expect(JSON.stringify([...store.entries()])).not.toContain("st-1");
  });

  it("an UNAUTHENTICATED caller is told to sign in, not left guessing", async () => {
    replies = {
      "/model/key": { status: 401, body: { error: { code: "unauthorized" } } },
      "/model/connect/start": { status: 401, body: { error: { code: "unauthorized" } } },
    };
    await mount();
    await click("Connect OpenRouter");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Sign in before connecting");
    expect(navigated).toBeNull();
  });

  it("a deployment holding no keys says so rather than offering a dead button", async () => {
    replies = {
      "/model/key": { status: 200, body: { connected: false, provider: "openrouter" } },
      "/model/connect/start": { status: 501, body: { error: { code: "provider_connect_disabled" } } },
    };
    await mount();
    await click("Connect OpenRouter");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("holds no provider keys");
  });

  it("REVOKED: the service says it holds nothing, so the slot is cleared and connect is offered", async () => {
    window.localStorage.setItem(ENDPOINT_SLOT, "https://exam.example/v1/model");
    replies = { "/model/key": { status: 200, body: { connected: false, provider: "openrouter" } } };
    await mount();
    expect(window.localStorage.getItem(ENDPOINT_SLOT)).toBeNull();
    expect(button("Connect OpenRouter")).toBeTruthy();
  });

  it("Disconnect asks the service to forget the key and clears the endpoint", async () => {
    replies = {
      "/model/key": { status: 200, body: { connected: true, provider: "openrouter", fingerprint: "abc123abc123" } },
    };
    await mount();
    replies["/model/key"] = { status: 200, body: { connected: false, provider: "openrouter", removed: true } };
    await click("Disconnect");
    expect(calls.at(-1)).toMatchObject({ url: "https://exam.example/v1/model/key", method: "DELETE" });
    expect(window.localStorage.getItem(ENDPOINT_SLOT)).toBeNull();
    expect(button("Connect OpenRouter")).toBeTruthy();
  });
});

describe("the callback, which the SERVICE redeems", () => {
  beforeEach(() => setHosted(true));

  it("hands code and state over, and never sees a key come back", async () => {
    land("?code=c-1&state=st-1");
    replies = {
      "/model/key": { status: 200, body: { connected: false, provider: "openrouter" } },
      "/model/connect/callback": {
        status: 200,
        body: { connected: true, provider: "openrouter", fingerprint: "0f0f0f0f0f0f" },
      },
    };
    await mount();
    const callback = calls.find((c) => c.url.includes("/connect/callback"));
    expect(callback).toMatchObject({ method: "POST", body: { code: "c-1", state: "st-1" } });
    expect(host.textContent).toContain("0f0f0f0f0f0f");
    // The code is out of the address bar and out of history.
    expect(window.location.search).not.toContain("code=");
  });

  it("ARRIVING TWICE spends the code once: the second pass finds nothing", async () => {
    land("?code=c-1&state=st-1");
    replies = {
      "/model/key": { status: 200, body: { connected: false, provider: "openrouter" } },
      "/model/connect/callback": {
        status: 200,
        body: { connected: true, provider: "openrouter", fingerprint: "0f0f0f0f0f0f" },
      },
    };
    await mount();
    // A second mount is what StrictMode's second effect pass looks like from
    // the outside, and it is also a reload of the same URL.
    act(() => root?.unmount());
    host.remove();
    await mount();
    expect(calls.filter((c) => c.url.includes("/connect/callback"))).toHaveLength(1);
  });

  it("a callback with NO state redeems nothing, and still clears the URL", async () => {
    land("?code=c-1");
    replies = { "/model/key": { status: 200, body: { connected: false, provider: "openrouter" } } };
    await mount();
    expect(calls.filter((c) => c.url.includes("/connect/callback"))).toHaveLength(0);
    expect(window.location.search).not.toContain("code=");
  });

  it("a callback the service refuses is explained, not swallowed", async () => {
    land("?code=c-1&state=st-1");
    replies = {
      "/model/key": { status: 200, body: { connected: false, provider: "openrouter" } },
      "/model/connect/callback": { status: 404, body: { error: { code: "no_such_exchange" } } },
    };
    await mount();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("already used");
  });

  it("the STATIC export ignores a callback entirely: there is nobody to ask", async () => {
    setHosted(false);
    land("?code=c-1&state=st-1");
    await mount();
    expect(calls).toEqual([]);
  });
});

describe("the connected copy", () => {
  it("states three checkable facts and claims nothing about spending", () => {
    const copy = connectedCopy("a1b2c3d4e5f6");
    expect(copy).toContain("never received your key");
    expect(copy).toContain("sealed against your account");
    expect(copy).toContain("Disconnect deletes it");
    expect(copy).toContain("a1b2c3d4e5f6");
  });

  it("reads without a fingerprint too (a service that returned none)", () => {
    expect(connectedCopy(undefined)).toContain("never received your key");
    expect(connectedCopy(undefined)).not.toContain("undefined");
  });
});

describe("both builds", () => {
  it("promise a recoverable failure, not an automatic simulator takeover", async () => {
    setHosted(false);
    await mount();
    expect(host.textContent).toContain("you can retry it or switch to the free offline demo simulators");
  });
});
