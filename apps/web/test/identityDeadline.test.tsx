// @vitest-environment jsdom
/**
 * AN IDENTITY THAT NEVER RESOLVES (TEN-214).
 *
 * `pending` is only ever left by `ClerkTokenBridge`, and the bridge only
 * publishes once Clerk's `isSignedIn` stops being `undefined`. Block the
 * Clerk script — an extension, a CSP, a failed CDN — and nothing ever
 * publishes: every reader of `useIdentity()` waits for a frame that does not
 * come, so /report sat on "Checking what the exam service has issued for
 * this sitting…" with `cta: null` for ever.
 *
 * The deadline is what makes that finite. After it, the store publishes what
 * the browser ACTUALLY has: `authHeaders()` with no token source registered
 * sends the asserted dev id, which is `asserted`, not an account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { saveAttempt } from "@ailx/session";
import { buildSampleAttemptLog } from "../lib/instrument/sampleAttempt";
import { installMemoryStorage, withQueryClient } from "./helpers/clientPage";

/** Mount a client page with FAKE timers, then let `ms` of wall clock pass. */
async function renderAfter(element: ReturnType<typeof createElement>, ms: number): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(withQueryClient(element));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  const html = host.innerHTML;
  await act(async () => {
    root.unmount();
  });
  host.remove();
  return html;
}

beforeEach(async () => {
  vi.useFakeTimers();
  installMemoryStorage();
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_stub");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  window.localStorage.setItem("foray:dev-user", "player-9");
  saveAttempt(window.localStorage, buildSampleAttemptLog());
  // The service is there and answers; the point is that nobody ever asks.
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({}), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  );
  const { resetIdentity } = await import("../lib/auth/identityState");
  resetIdentity();
});

afterEach(async () => {
  const { resetIdentity } = await import("../lib/auth/identityState");
  resetIdentity();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the report when Clerk never answers", () => {
  it("stops waiting and says something a candidate can act on", async () => {
    const ReportPage = (await import("../app/report/page")).default;
    const html = await renderAfter(createElement(ReportPage), 30_000);
    expect(html).not.toContain("Checking what the exam service has issued");
    expect(html).toContain("Finish the run to see it");
    expect(html).toContain("Continue →");
  });
});

describe("the store's own deadline", () => {
  it("resolves a Clerk build to the identity the browser can actually send", async () => {
    const { readIdentity, subscribeIdentity, IDENTITY_DEADLINE_MS } = await import(
      "../lib/auth/identityState"
    );
    const stop = subscribeIdentity(() => undefined);
    expect(readIdentity().status).toBe("pending");
    await vi.advanceTimersByTimeAsync(IDENTITY_DEADLINE_MS + 1);
    // `asserted`, never `signed-in`: there is no account behind a dev id.
    expect(readIdentity()).toEqual({ status: "asserted", userId: null });
    stop();
  });

  it("does not overrule a bridge that answers before the deadline", async () => {
    const { publishIdentity, readIdentity, subscribeIdentity, IDENTITY_DEADLINE_MS } =
      await import("../lib/auth/identityState");
    const stop = subscribeIdentity(() => undefined);
    publishIdentity({ status: "signed-in", userId: "user_a" });
    await vi.advanceTimersByTimeAsync(IDENTITY_DEADLINE_MS + 1);
    expect(readIdentity()).toEqual({ status: "signed-in", userId: "user_a" });
    stop();
  });

  it("still lets a LATE bridge answer replace the fallback", async () => {
    const { publishIdentity, readIdentity, subscribeIdentity, IDENTITY_DEADLINE_MS } =
      await import("../lib/auth/identityState");
    const stop = subscribeIdentity(() => undefined);
    await vi.advanceTimersByTimeAsync(IDENTITY_DEADLINE_MS + 1);
    publishIdentity({ status: "signed-in", userId: "user_b" });
    expect(readIdentity()).toEqual({ status: "signed-in", userId: "user_b" });
    stop();
  });
});
