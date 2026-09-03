// @vitest-environment jsdom
/**
 * The browser's model-gateway client (TEN-62).
 *
 * Three properties are worth a test each, because each one is a claim the
 * panel's copy makes on this module's behalf:
 *
 *  1. every URL comes from the frozen manifest and `apiBase()`, so a browser
 *     cannot call a route the deployed service does not have;
 *  2. every call carries IDENTITY and nothing else — there is no key to send,
 *     and the module has no parameter that could carry one;
 *  3. a callback is claimable exactly once, and the code leaves the address
 *     bar whether or not it can be redeemed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_ROUTES, MODEL_ROOT } from "@ailx/contract";
import {
  callbackFailureCopy,
  claimModelCallback,
  connectFailureCopy,
  disconnectKey,
  finishConnect,
  modelGatewayAvailable,
  modelGatewayBase,
  modelGatewayFetch,
  readKeyStatus,
  readStatusBody,
  safeCallerHeaders,
  resetClaimedCallbacks,
  startConnect,
} from "../lib/data/modelGateway";

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

let calls: Array<{ url: string; init: RequestInit | undefined }> = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

let currentUrl = "http://localhost/exam";

function stub(status: number, body: unknown) {
  reply = { status, body };
}

beforeEach(() => {
  store.clear();
  resetClaimedCallbacks();
  calls = [];
  stub(200, {});
  currentUrl = "http://localhost/exam";
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", "https://exam.example");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { status: reply.status, json: async () => reply.body } as unknown as Response;
    }),
  );
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get href() {
        return currentUrl;
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the URLs come from the manifest, never from here", () => {
  it("the gateway base is the manifest root under the versioned root", () => {
    expect(modelGatewayBase()).toBe(`https://exam.example/v1${MODEL_ROOT}`);
  });

  it("every model route hangs off that same root, so the two cannot drift", () => {
    for (const key of ["modelCatalog", "modelChat", "modelKey", "startModelConnect"] as const) {
      expect(API_ROUTES[key].path.startsWith(`${MODEL_ROOT}/`)).toBe(true);
    }
  });

  it.each([
    ["readKeyStatus", () => readKeyStatus(), "GET", "/v1/model/key"],
    ["disconnectKey", () => disconnectKey(), "DELETE", "/v1/model/key"],
    ["startConnect", () => startConnect(), "POST", "/v1/model/connect/start"],
    ["finishConnect", () => finishConnect({ code: "c", state: "s" }), "POST", "/v1/model/connect/callback"],
  ])("%s calls %s %s", async (_name, run, method, path) => {
    await run();
    expect(calls[0].url).toBe(`https://exam.example${path}`);
    expect(calls[0].init?.method ?? "GET").toBe(method);
  });

  it("is unavailable in the static export, where no service answers", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    expect(modelGatewayAvailable()).toBe(false);
  });
});

describe("what a call carries", () => {
  it("sends the identity header and no credential", async () => {
    store.set("ailx:dev-user", "web-abc");
    await readKeyStatus();
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["x-ailx-dev-user"]).toBe("web-abc");
    expect(headers.authorization).toBeUndefined();
  });

  it("modelFetch adds identity to a runner's own request without touching its body", async () => {
    store.set("ailx:dev-user", "web-abc");
    await modelGatewayFetch("https://exam.example/v1/model/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const init = calls[0].init!;
    expect(init.body).toBe("{}");
    // toEqual, not toMatchObject: a review pointed out that a forwarded
    // provider `Authorization` would have passed the looser assertion.
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-ailx-dev-user": "web-abc",
    });
  });

  it("DROPS a credential header a runner tried to set", async () => {
    store.set("ailx:dev-user", "web-abc");
    await modelGatewayFetch("https://exam.example/v1/model/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-or-should-not-travel",
        "X-Api-Key": "sk-or-neither-should-this",
      },
    });
    expect(calls[0].init?.headers).toEqual({
      "Content-Type": "application/json",
      "x-ailx-dev-user": "web-abc",
    });
  });

  it("takes headers in every shape fetch accepts, and filters all three", () => {
    expect(safeCallerHeaders(new Headers({ accept: "a", authorization: "b" }))).toEqual({ accept: "a" });
    expect(safeCallerHeaders([["Accept", "a"], ["Authorization", "b"]])).toEqual({ Accept: "a" });
    expect(safeCallerHeaders(undefined)).toEqual({});
  });

  it.each([
    ["a local model server", "http://localhost:11434/v1/chat/completions"],
    ["the standalone demo proxy", "https://ailx-shared-demo.vercel.app/api/v1/chat/completions"],
    ["a look-alike origin", "https://exam.example.evil/v1/model/chat/completions"],
  ])("sends NO identity to %s — it is a third party", async (_what, url) => {
    store.set("ailx:dev-user", "web-abc");
    await modelGatewayFetch(url, { method: "POST", body: "{}" });
    expect(calls[0].init?.headers).toEqual({});
  });

  it("sends no identity anywhere in the static export, where every endpoint is a third party", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    store.set("ailx:dev-user", "web-abc");
    await modelGatewayFetch("https://exam.example/v1/model/chat/completions", { method: "POST" });
    expect(calls[0].init?.headers).toEqual({});
  });
});

describe("what a refusal is reported as", () => {
  it("401 asks for a sign-in rather than blaming the key", async () => {
    stub(401, { error: { code: "unauthorized" } });
    const result = await startConnect();
    expect(result).toEqual({ ok: false, message: connectFailureCopy(401) });
    expect(connectFailureCopy(401)).toContain("Sign in");
    // It names WHY identity matters here, and never blames a key the browser
    // does not have.
    expect(connectFailureCopy(401)).toContain("against your identity");
    expect(connectFailureCopy(401)).not.toContain("Check the key");
  });

  it("each status a candidate can hit says a different thing", () => {
    const said = [401, 404, 410, 502, 500].map((s) => callbackFailureCopy(s));
    expect(new Set(said).size).toBe(said.length);
    expect(callbackFailureCopy(404)).toContain("already used");
    expect(callbackFailureCopy(410)).toContain("expired");
  });

  it("a body that is not the promised shape is a failure, not a fake success", async () => {
    stub(200, { provider: "openrouter" }); // no authorizeUrl, no state
    expect(await startConnect()).toMatchObject({ ok: false });
  });

  it("a non-200 key status is a REFUSAL, not 'there is no key'", async () => {
    stub(401, {});
    expect(await readKeyStatus()).toEqual({ ok: false, httpStatus: 401 });
  });

  it("a refused DELETE never reports a deletion that may not have happened", async () => {
    stub(500, {});
    expect(await disconnectKey()).toEqual({ ok: false, httpStatus: 500 });
  });

  it("a thrown fetch is a refusal with no status, not a silent disconnect", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));
    expect(await readKeyStatus()).toEqual({ ok: false, httpStatus: 0 });
  });

  it("a 200 whose body is not a status is refused, not cast", async () => {
    stub(200, { nope: 1 });
    expect(await readKeyStatus()).toMatchObject({ ok: false });
  });
});

describe("the status body, read rather than cast", () => {
  it("keeps a 12-hex fingerprint and DROPS anything else claiming to be one", () => {
    expect(readStatusBody({ connected: true, provider: "openrouter", fingerprint: "a1b2c3d4e5f6" }))
      .toMatchObject({ fingerprint: "a1b2c3d4e5f6" });
    // The page says it only ever shows a fingerprint. This is what makes that
    // true of the BROWSER rather than a hope about the service.
    for (const bad of ["sk-or-v1-deadbeef", "A1B2C3D4E5F6", "a1b2c3", "", null, 12]) {
      expect(readStatusBody({ connected: true, fingerprint: bad })?.fingerprint).toBeUndefined();
    }
  });

  it("refuses a body with no boolean `connected`", () => {
    expect(readStatusBody({ provider: "openrouter" })).toBeNull();
    expect(readStatusBody(null)).toBeNull();
    expect(readStatusBody("connected")).toBeNull();
  });
});

describe("claiming the callback", () => {
  it("returns code and state ONCE and strips both from the URL", () => {
    currentUrl = "http://localhost/exam?code=c-1&state=st-1&keep=yes";
    expect(claimModelCallback()).toEqual({ code: "c-1", state: "st-1" });
    expect(currentUrl).not.toContain("code=");
    expect(currentUrl).not.toContain("state=");
    // Anything else on the URL is not ours to remove.
    expect(currentUrl).toContain("keep=yes");
    expect(claimModelCallback()).toBeNull();
  });

  it("a code with NO state redeems nothing but still leaves the URL", () => {
    currentUrl = "http://localhost/exam?code=c-1";
    expect(claimModelCallback()).toBeNull();
    expect(currentUrl).not.toContain("code=");
  });

  it("no callback at all is null and rewrites nothing", () => {
    currentUrl = "http://localhost/exam";
    expect(claimModelCallback()).toBeNull();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });

  it("stores no verifier and no state: there is nothing here to redeem with", () => {
    currentUrl = "http://localhost/exam?code=c-1&state=st-1";
    claimModelCallback();
    expect([...store.keys()]).toEqual([]);
  });

  it("stays one-shot when history refuses to rewrite (the code stays in the URL)", () => {
    // A review found this hole: the URL was the ONLY record of the claim, so
    // a browser that refuses `replaceState` let StrictMode's second pass
    // redeem the same single-use code again.
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new Error("blocked");
    });
    currentUrl = "http://localhost/exam?code=c-1&state=st-1";
    expect(claimModelCallback()).toEqual({ code: "c-1", state: "st-1" });
    expect(currentUrl).toContain("code=c-1");
    expect(claimModelCallback()).toBeNull();
  });
});
