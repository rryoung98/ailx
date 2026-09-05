// @vitest-environment jsdom
/**
 * `lib/data/serviceFetch.ts` — the ONE path a page takes to the exam service.
 *
 * Seven pages share it, so every rule it enforces is enforced seven times or
 * not at all: the URL comes from the seam, identity is a HEADER and only when
 * asked for, a non-200 keeps its status so a page can tell "unknown token"
 * from "not you", and a thrown fetch becomes a sentence rather than a blank.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { apiPath, DEV_USER_HEADER, type ApiPath } from "@ailx/contract";
import {
  SERVICE_ERROR_COPY,
  firstValueQuery,
  firstValues,
  serviceFetch,
  serviceRefusedCopy,
  useService,
  type ServiceState,
} from "../lib/data/serviceFetch";
import { setAuthTokenSource } from "../lib/data/authHeaders";
import { publishIdentity, resetIdentity } from "../lib/auth/identityState";
import {
  flushAsync,
  installMemoryStorage,
  renderClient,
  renderClientPending,
  withQueryClient,
} from "./helpers/clientPage";

installMemoryStorage();

const SERVICE = "https://ailx-backend.example";

interface Seen {
  url: string;
  headers: Record<string, string>;
  cache: string | undefined;
}

let seen: Seen[] = [];

function stub(status: number, body: unknown = { ok: true }): void {
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    seen.push({ url: String(url), headers, cache: init?.cache });
    return new Response(JSON.stringify(body), { status });
  });
}

beforeEach(() => {
  seen = [];
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  window.localStorage.setItem("foray:dev-user", "player-9");
});
afterEach(() => {
  setAuthTokenSource(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("where it asks", () => {
  it("hangs the path off apiBase() — same-origin, basePath included", async () => {
    stub(200);
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/ailx");
    await serviceFetch(apiPath("progress"));
    expect(seen[0].url).toBe("/ailx/api/progress");
  });

  it("follows the seam to the exam service's /v1 prefix", async () => {
    stub(200);
    vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", SERVICE);
    await serviceFetch(apiPath("gallery", {}, "?type=MSVD"));
    expect(seen[0].url).toBe(`${SERVICE}/v1/gallery?type=MSVD`);
  });

  it("never caches: a revocation must be visible the moment it lands", async () => {
    stub(200);
    await serviceFetch(apiPath("shareView", { token: "abc" }));
    expect(seen[0].cache).toBe("no-store");
  });
});

describe("identity", () => {
  it("sends nothing at all unless the caller asks for it", async () => {
    stub(200);
    await serviceFetch(apiPath("gallery"));
    expect(seen[0].headers[DEV_USER_HEADER]).toBeUndefined();
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it("sends the asserted dev id as a HEADER — the Lax cookie cannot cross an origin", async () => {
    stub(200);
    await serviceFetch(apiPath("progress"), { identity: "required" });
    expect(seen[0].headers[DEV_USER_HEADER]).toBe("player-9");
  });

  it("prefers a proven token, and never sends both", async () => {
    stub(200);
    setAuthTokenSource(async () => "jwt-7");
    await serviceFetch(apiPath("progress"), { identity: "required" });
    expect(seen[0].headers.authorization).toBe("Bearer jwt-7");
    expect(seen[0].headers[DEV_USER_HEADER]).toBeUndefined();
  });

  /**
   * The third mode, and the reason it exists: `/gallery` and `/world` are
   * public pages behind routes that are all authenticated today (TEN-107).
   * They send what the browser HAS and never make one up, so the page works
   * for a returning reader under the current policy and fails honestly for a
   * first-time visitor instead of inventing a caller.
   */
  it("optional identity forwards an id the browser already has", async () => {
    stub(200);
    await serviceFetch(apiPath("gallery"), { identity: "optional" });
    expect(seen[0].headers[DEV_USER_HEADER]).toBe("player-9");
  });

  it("optional identity MINTS nothing, and leaves storage untouched", async () => {
    stub(200);
    window.localStorage.removeItem("foray:dev-user");
    await serviceFetch(apiPath("gallery"), { identity: "optional" });
    expect(seen[0].headers[DEV_USER_HEADER]).toBeUndefined();
    expect(window.localStorage.getItem("foray:dev-user")).toBeNull();
  });

  it("required identity DOES mint one — the question is meaningless without it", async () => {
    stub(200);
    window.localStorage.removeItem("foray:dev-user");
    await serviceFetch(apiPath("progress"), { identity: "required" });
    expect(seen[0].headers[DEV_USER_HEADER]).toMatch(/^web-/);
  });

  it("optional identity still prefers a proven token", async () => {
    stub(200);
    setAuthTokenSource(async () => "jwt-7");
    await serviceFetch(apiPath("gallery"), { identity: "optional" });
    expect(seen[0].headers.authorization).toBe("Bearer jwt-7");
  });
});

describe("what a page is told", () => {
  it("returns the parsed body on 200", async () => {
    stub(200, { progress: { streak: 3 } });
    const state = await serviceFetch<{ progress: { streak: number } }>(apiPath("progress"));
    expect(state).toEqual({ state: "ready", data: { progress: { streak: 3 } } });
  });

  it("keeps the STATUS of a refusal, so 404 and 403 stay different answers", async () => {
    for (const status of [400, 401, 403, 404, 500]) {
      seen = [];
      stub(status, {});
      expect(await serviceFetch(apiPath("aggregates"))).toEqual({ state: "missing", status });
    }
  });

  /**
   * A refusal is an ANSWER, and the page has to be able to repeat it. Only
   * the frozen envelope is quoted: a proxy's HTML page is not a sentence we
   * put in front of a reader as the service's own (TEN-107).
   */
  it("carries the reason the service gave, collapsed onto one line", async () => {
    stub(400, { error: { code: "bad_request", message: "Invalid option\n  → at sort" } });
    expect(await serviceFetch(apiPath("gallery"))).toEqual({
      state: "missing",
      status: 400,
      reason: "Invalid option → at sort",
    });
  });

  it("quotes NO reason when the body is not the refusal envelope", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>502 upstream</html>", { status: 502 }));
    expect(await serviceFetch(apiPath("gallery"))).toEqual({ state: "missing", status: 502 });
  });

  it("truncates a refusal that is a document rather than a message", async () => {
    stub(400, { error: { code: "bad_request", message: "x".repeat(1000) } });
    const state = await serviceFetch(apiPath("gallery"));
    expect(state.state === "missing" && state.reason!.length).toBe(200);
  });
});

/**
 * Three failures, three sentences. "We could not reach the service" for a
 * status the service itself sent is false, and a public page saying it to a
 * visitor blames their connection for our policy (TEN-107).
 */
describe("what a failure is CALLED", () => {
  it("says nothing was reached only when nothing was reached", () => {
    expect(SERVICE_ERROR_COPY).toContain("did not answer");
    expect(SERVICE_ERROR_COPY).not.toMatch(/refused|HTTP/);
  });

  it("says a refusal was reached, and repeats what it said", () => {
    const copy = serviceRefusedCopy(500, "no such lane");
    expect(copy).toContain("was reached and refused");
    expect(copy).toContain("HTTP 500");
    expect(copy).toContain("It said: no such lane");
    expect(copy).not.toContain("did not answer");
  });

  it("names 401 and 403 on a public page as ours, not the reader's", () => {
    for (const status of [401, 403]) {
      const copy = serviceRefusedCopy(status);
      expect(copy).toContain(`HTTP ${status}`);
      expect(copy).toContain("meant to be public");
      expect(copy).not.toContain("Check your connection");
    }
  });

  it("says nothing about a reason when there was none", () => {
    expect(serviceRefusedCopy(404)).not.toContain("It said");
  });

  it("turns a thrown fetch into an honest sentence, never an empty success", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await serviceFetch(apiPath("aggregates"))).toEqual({ state: "error", message: SERVICE_ERROR_COPY });
  });

  it("treats an unparseable 200 body as an error rather than as data", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>gateway</html>", { status: 200 }));
    expect((await serviceFetch(apiPath("aggregates"))).state).toBe("error");
  });

  it("stays in loading when its own abort fired — a torn-down page shows nothing", async () => {
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", async () => {
      ctrl.abort();
      throw new DOMException("aborted", "AbortError");
    });
    expect(await serviceFetch(apiPath("aggregates"), { signal: ctrl.signal })).toEqual({ state: "loading" });
  });
});

describe("firstValueQuery", () => {
  it("keeps only the first value of a repeated parameter", () => {
    expect(firstValueQuery(new URLSearchParams("lane=decided&lane=pending&offset=25"))).toBe(
      "?lane=decided&offset=25",
    );
  });

  it("is empty for an empty, null or undefined query", () => {
    expect(firstValueQuery(new URLSearchParams())).toBe("");
    expect(firstValueQuery(null)).toBe("");
    expect(firstValueQuery(undefined)).toBe("");
  });

  it("re-encodes rather than passing a raw value through", () => {
    expect(firstValueQuery(new URLSearchParams([["type", "a b&c"]]))).toBe("?type=a+b%26c");
  });

  /**
   * The same rule as a record, which is what the contract's parsers take.
   * `Object.fromEntries` keeps the LAST value of a repeated key — the
   * opposite rule from the rest of this seam.
   */
  it("firstValues keeps the FIRST value, not the last", () => {
    expect(firstValues(new URLSearchParams("lane=decided&lane=pending"))).toEqual({
      lane: "decided",
    });
    expect(firstValues(null)).toEqual({});
    expect(firstValues(undefined)).toEqual({});
  });
});

describe("useService", () => {
  function Probe({ path }: { path: ApiPath | null }) {
    const state: ServiceState<{ ok: boolean }> = useService(path, { identity: "required" });
    return createElement("p", null, JSON.stringify(state));
  }

  it("is loading while the call is in flight, and ready once it lands", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    expect(await renderClientPending(createElement(Probe, { path: apiPath("aggregates") }))).toContain('"loading"');
    stub(200, { ok: true });
    expect(await renderClient(createElement(Probe, { path: apiPath("aggregates") }))).toContain('"ready"');
  });

  it("asks for nothing at all when there is nothing to ask for", async () => {
    stub(200);
    const html = await renderClient(createElement(Probe, { path: null }));
    expect(html).toContain('"loading"');
    expect(seen).toHaveLength(0);
  });
});

/**
 * The staging defect this guard exists for: /progress rendered "We do not
 * know who you are" to a signed-in candidate, and STAYED there through a
 * reload. `ClerkTokenBridge` registers the token source in an effect, so a
 * read fired on mount found none, `identity: "required"` MINTED a dev id, and
 * the service answered for that stranger — which TanStack then cached.
 */
describe("useService waits for an identity", () => {
  function Probe({ path }: { path: ApiPath | null }) {
    const state: ServiceState<{ ok: boolean }> = useService(path, { identity: "required" });
    return createElement("p", null, JSON.stringify(state));
  }

  /** Mount and KEEP mounted, so an identity can resolve under a live tree. */
  async function mountProbe(path: ApiPath): Promise<{ html: () => string; unmount: () => void }> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(withQueryClient(createElement(Probe, { path })));
    });
    await flushAsync();
    return {
      html: () => host.innerHTML,
      unmount: () => {
        act(() => root.unmount());
        host.remove();
      },
    };
  }

  /** A build that really mounts Clerk, which is the only one that can be pending. */
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_stub");
    window.localStorage.removeItem("foray:dev-user");
    resetIdentity();
    stub(200, { ok: true });
  });
  afterEach(() => resetIdentity());

  it("asks NOTHING while the identity is pending, and mints no dev id for somebody who has an account", async () => {
    const mounted = await mountProbe(apiPath("progress"));
    expect(seen).toHaveLength(0);
    expect(window.localStorage.getItem("foray:dev-user")).toBeNull();
    expect(mounted.html()).toContain('"loading"');
    mounted.unmount();
  });

  it("PENDING then SIGNED-IN asks once, carrying the Bearer token", async () => {
    setAuthTokenSource(async () => "jwt-7");
    const mounted = await mountProbe(apiPath("progress"));
    expect(seen).toHaveLength(0);
    await act(async () => {
      publishIdentity({ status: "signed-in", userId: "user_1" });
    });
    await flushAsync();
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.authorization).toBe("Bearer jwt-7");
    expect(seen[0].headers[DEV_USER_HEADER]).toBeUndefined();
    expect(mounted.html()).toContain('"ready"');
    mounted.unmount();
  });

  it("a RESOLVED anonymous visitor is asked for as before — pending is not anonymous", async () => {
    const mounted = await mountProbe(apiPath("progress"));
    await act(async () => {
      publishIdentity({ status: "anonymous", userId: null });
    });
    await flushAsync();
    expect(seen).toHaveLength(1);
    expect(seen[0].headers[DEV_USER_HEADER]).toBeTruthy();
    mounted.unmount();
  });

  it("a build with NO Clerk never waits: the static export asks as promptly as before", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    const mounted = await mountProbe(apiPath("progress"));
    expect(seen).toHaveLength(1);
    mounted.unmount();
  });
});
