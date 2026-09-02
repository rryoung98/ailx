// @vitest-environment jsdom
/**
 * The T1 runner's own OAuth callback, under StrictMode.
 *
 * `ConnectPanel` in apps/web has this covered (apps/web/test/pkceCallback.test.tsx).
 * The runner takes the SAME callback and had the same four defects TEN-64
 * listed, so it needs the same proof. React 18/19 StrictMode runs every
 * effect twice in development, an authorization code is single-use, and the
 * second exchange used to paint an error over a sign-in that had worked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import { OPENROUTER_KEY_STORAGE } from "../src/openrouter.js";
import { OPENROUTER_KEY_EXCHANGE_URL, PKCE_VERIFIER_STORAGE } from "../src/sso.js";

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

const props = {
  attemptId: "a-1",
  locale: "en" as const,
  config: {},
  onEvent: () => {},
  onComplete: () => {},
  secondsRemaining: 600,
};

let root: Root | null = null;
let host: HTMLElement;

/** Mount inside StrictMode, which double-invokes every effect. */
async function mountStrict() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(StrictMode, null, createElement(Runner, props)));
  });
  await act(async () => await Promise.resolve());
}

/** Only the key exchange; the runner also polls GET /models in real mode. */
function exchangeCalls(urls: ReadonlyArray<string>): ReadonlyArray<string> {
  return urls.filter((u) => u === OPENROUTER_KEY_EXCHANGE_URL);
}

beforeEach(() => {
  store.clear();
  window.history.replaceState(null, "", "/exam");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("the T1 runner's ?code= exchange", () => {
  it("spends the code once under StrictMode and keeps the key it gets", async () => {
    window.history.replaceState(null, "", "/exam?code=auth-code-1&keep=1");
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: unknown) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ key: "sk-or-v1-abc" }) };
    });

    await mountStrict();

    expect(exchangeCalls(urls).length).toBe(1);
    expect(store.get(OPENROUTER_KEY_STORAGE)).toBe("sk-or-v1-abc");
    expect(store.has(PKCE_VERIFIER_STORAGE)).toBe(false);
    expect(window.location.search).toBe("?keep=1");
    expect(host.textContent).not.toContain("OpenRouter sign-in failed");
  });

  it("reports a refused exchange in the runner's own error line", async () => {
    window.history.replaceState(null, "", "/exam?code=auth-code-1");
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 403, json: async () => ({}) }));

    await mountStrict();

    expect(host.textContent).toContain("OpenRouter sign-in failed (HTTP 403)");
    expect(store.has(OPENROUTER_KEY_STORAGE)).toBe(false);
  });

  it("asks for nothing, and clears the URL, when there is no verifier", async () => {
    window.history.replaceState(null, "", "/exam?code=auth-code-1");
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: unknown) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ key: "sk-or-v1-abc" }) };
    });

    await mountStrict();

    expect(exchangeCalls(urls)).toEqual([]);
    expect(window.location.search).toBe("");
  });

  it("leaves neither secret behind when the runner unmounts mid-flight", async () => {
    window.history.replaceState(null, "", "/exam?code=auth-code-1");
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    vi.stubGlobal("fetch", () => new Promise(() => {}));

    await mountStrict();
    expect(store.has(PKCE_VERIFIER_STORAGE)).toBe(false);
    expect(window.location.search).toBe("");

    await act(async () => root?.unmount());
    root = null;
    expect(store.has(PKCE_VERIFIER_STORAGE)).toBe(false);
  });
});
