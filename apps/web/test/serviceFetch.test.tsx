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
import { createElement } from "react";
import { apiPath, DEV_USER_HEADER, type ApiPath } from "@ailx/contract";
import {
  SERVICE_ERROR_COPY,
  firstValueQuery,
  serviceFetch,
  useService,
  type ServiceState,
} from "../lib/data/serviceFetch";
import { setAuthTokenSource } from "../lib/data/authHeaders";
import { installMemoryStorage, renderClient, renderClientPending } from "./helpers/clientPage";

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
  window.localStorage.setItem("ailx:dev-user", "player-9");
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
    await serviceFetch(apiPath("progress"), { identified: true });
    expect(seen[0].headers[DEV_USER_HEADER]).toBe("player-9");
  });

  it("prefers a proven token, and never sends both", async () => {
    stub(200);
    setAuthTokenSource(async () => "jwt-7");
    await serviceFetch(apiPath("progress"), { identified: true });
    expect(seen[0].headers.authorization).toBe("Bearer jwt-7");
    expect(seen[0].headers[DEV_USER_HEADER]).toBeUndefined();
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
});

describe("useService", () => {
  function Probe({ path }: { path: ApiPath | null }) {
    const state: ServiceState<{ ok: boolean }> = useService(path, { identified: true });
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
