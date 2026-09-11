// @vitest-environment jsdom
/**
 * A REFUSAL IS AN ANSWER (TEN-234).
 *
 * The three end-of-sitting write panels used to collapse "the service was
 * reached and said no" and "nothing was reached at all" into one sentence,
 * and threw the status away: a 403, a 409 and a 429 all read as "That did not
 * reach the exam service … Try again in a moment.", so a candidate retried a
 * permanent answer for ever.
 *
 * `lib/data/serviceFetch.ts` already keeps the two apart for READS. These are
 * the WRITES — issue, revoke, create and publish — held to the same rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { sharePayloadFrom } from "@ailx/report";
import { CredentialPanel } from "../features/report/CredentialPanel";
import { ShareLink } from "../features/report/ShareLink";

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

const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(43);
const PAYLOAD = sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
  instrument: "ailx 2026.1",
});

let container: HTMLDivElement;
let root: Root;

async function mount(el: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
}

const button = (name: RegExp): HTMLButtonElement | undefined =>
  [...container.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));

/** A refusal the service worded itself, in the frozen envelope. */
const refusal = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  window.localStorage.clear();
  window.localStorage.setItem("foray:dev-user", "tester");
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stub(fn: (url: string, init: { method: string }) => Promise<Response>): void {
  const mock = vi.fn(fn);
  vi.stubGlobal("fetch", mock);
  window.fetch = mock as unknown as typeof fetch;
}

describe("CredentialPanel says which kind of failure it met (TEN-234)", () => {
  it("a 403 on issue prints the status and the reason, and offers no retry", async () => {
    stub(async (_u, init) =>
      init.method === "POST"
        ? refusal(403, "forbidden", "this sitting is not yours")
        : new Response("{}", { status: 404 }),
    );
    await mount(createElement(CredentialPanel, { attemptId: ATTEMPT }));
    await act(async () => {
      button(/Issue my credential/)!.click();
    });
    const text = container.textContent ?? "";
    expect(text).toContain("403");
    expect(text).toContain("this sitting is not yours");
    expect(text).not.toContain("Try again in a moment");
    expect(button(/Issue my credential/)!.disabled).toBe(true);
  });

  it("a 429 on issue is a refusal you may retry, and says so", async () => {
    stub(async (_u, init) =>
      init.method === "POST"
        ? refusal(429, "rate_limited", "too many requests, wait a minute")
        : new Response("{}", { status: 404 }),
    );
    await mount(createElement(CredentialPanel, { attemptId: ATTEMPT }));
    await act(async () => {
      button(/Issue my credential/)!.click();
    });
    const text = container.textContent ?? "";
    expect(text).toContain("429");
    expect(text).toContain("too many requests, wait a minute");
    expect(button(/Issue my credential/)!.disabled).toBe(false);
  });

  it("an unreachable service still reads as an unreachable service", async () => {
    stub(async (_u, init) => {
      if (init.method === "POST") throw new TypeError("Failed to fetch");
      return new Response("{}", { status: 404 });
    });
    await mount(createElement(CredentialPanel, { attemptId: ATTEMPT }));
    await act(async () => {
      button(/Issue my credential/)!.click();
    });
    const text = container.textContent ?? "";
    expect(text).toContain("did not reach the exam service");
    expect(text).not.toContain("HTTP");
  });
});

describe("ShareLink says which kind of failure it met (TEN-234)", () => {
  it("a 403 on create prints the status and the reason, and offers no retry", async () => {
    stub(async (_u, init) =>
      init.method === "POST"
        ? refusal(403, "forbidden", "this sitting is not yours")
        : new Response("{}", { status: 404 }),
    );
    await mount(createElement(ShareLink, { attemptId: ATTEMPT }));
    await act(async () => {
      button(/Create a share link/)!.click();
    });
    const text = container.textContent ?? "";
    expect(text).toContain("403");
    expect(text).toContain("this sitting is not yours");
    expect(text).not.toContain("Try again in a moment");
    expect(button(/Create a share link/)!.disabled).toBe(true);
  });

  it("a 409 on publish names the refusal rather than the network", async () => {
    stub(async (url, init) => {
      if (init.method === "GET") {
        return new Response(
          JSON.stringify({ share: { status: "unlisted", views: 1, id: "s1", token: TOKEN, payload: PAYLOAD, rejectedBy: null, rejectReason: null } }),
          { status: 200 },
        );
      }
      if (String(url).endsWith("/publish")) {
        return refusal(409, "already_published", "this card is already in the gallery");
      }
      return new Response("{}", { status: 200 });
    });
    await mount(createElement(ShareLink, { attemptId: ATTEMPT }));
    await act(async () => {
      button(/Publish to the gallery/)!.click();
    });
    const text = container.textContent ?? "";
    expect(text).toContain("409");
    expect(text).toContain("this card is already in the gallery");
    expect(text).not.toContain("That did not reach the gallery");
  });
});
