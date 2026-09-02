// @vitest-environment jsdom
/**
 * THE OAUTH CALLBACK, AND THE FOUR DEFECTS TEN-64 LISTED.
 *
 * The `?code=` exchange used to hand-roll a cancellation flag, a promise
 * chain and cleanup in `.finally()`. What is asserted here is the behaviour
 * that changed, not the library: the code and the verifier leave the browser
 * BEFORE the request, so a StrictMode second pass spends nothing and an
 * unmount leaves nothing behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OPENROUTER_KEY_STORAGE, PKCE_VERIFIER_STORAGE, claimPkceCallback } from "@ailx/track-t1";
import { ConnectPanel } from "../features/exam/ConnectPanel";
import { QueryProvider } from "../lib/QueryProvider";
import { flushAsync } from "./helpers/clientPage";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
  configurable: true,
});

let root: Root | null = null;
let host: HTMLElement;

/** Mount inside StrictMode, which runs every effect TWICE in development. */
async function mountStrict() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(StrictMode, null, createElement(QueryProvider, null, createElement(ConnectPanel))),
    );
  });
  await flushAsync();
}

function callbackUrl(code = "auth-code-1") {
  window.history.replaceState(null, "", `/exam?code=${code}&other=keep`);
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

describe("claimPkceCallback", () => {
  it("takes both single-use halves out of the browser as it reads them", () => {
    callbackUrl();
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    expect(claimPkceCallback()).toEqual({ code: "auth-code-1", verifier: "v1" });
    // Defect 2: neither may survive the read.
    expect(store.has(PKCE_VERIFIER_STORAGE)).toBe(false);
    expect(window.location.search).toBe("?other=keep");
  });

  it("claims nothing the second time — defect 1, the StrictMode double-invoke", () => {
    callbackUrl();
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    expect(claimPkceCallback()).not.toBeNull();
    expect(claimPkceCallback()).toBeNull();
  });

  it("still clears the code when there is no verifier — defect 3", () => {
    callbackUrl();
    expect(claimPkceCallback()).toBeNull();
    expect(window.location.search).toBe("?other=keep");
  });

  it("does nothing at all on a page that is not a callback", () => {
    expect(claimPkceCallback()).toBeNull();
    expect(window.location.search).toBe("");
  });
});

describe("the panel's exchange", () => {
  it("spends the code ONCE under StrictMode, and stores the key it gets", async () => {
    callbackUrl();
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: unknown) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ key: "sk-or-v1-abc" }), { status: 200 });
    });
    await mountStrict();
    expect(calls.length).toBe(1);
    expect(store.get(OPENROUTER_KEY_STORAGE)).toBe("sk-or-v1-abc");
    expect(store.has(PKCE_VERIFIER_STORAGE)).toBe(false);
    expect(window.location.search).toBe("?other=keep");
    expect(host.innerHTML).toContain("Connected");
  });

  it("says what OpenRouter said when the exchange is refused", async () => {
    callbackUrl();
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    vi.stubGlobal("fetch", async () => new Response("no", { status: 403 }));
    await mountStrict();
    expect(host.innerHTML).toContain("OpenRouter sign-in failed (HTTP 403)");
    expect(store.has(OPENROUTER_KEY_STORAGE)).toBe(false);
  });

  it("asks for nothing when the page is not a callback", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: unknown) => {
      calls.push(String(url));
      return new Response("{}", { status: 200 });
    });
    await mountStrict();
    expect(calls).toEqual([]);
  });

  it("leaves no secret behind when the panel unmounts mid-flight — defect 2", async () => {
    callbackUrl();
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    await mountStrict();
    // The request is still hanging, and both single-use halves are already gone.
    expect(store.has(PKCE_VERIFIER_STORAGE)).toBe(false);
    expect(window.location.search).toBe("?other=keep");
    await act(async () => root?.unmount());
    root = null;
    expect(store.has(PKCE_VERIFIER_STORAGE)).toBe(false);
  });
});
