// @vitest-environment jsdom
/**
 * AN ERROR STATE IS NOT AN EMPTY STATE (TEN-221).
 *
 * The report reads the answer key for a hosted sitting from the exam service
 * (the review phase; docs/ARCHITECTURE.md §4). When that read failed, `review`
 * stayed null and the page fell back to this build's bundled practice keys,
 * which match no operational item id — so every calibration bin was empty and
 * the section rendered NOTHING. The TEN-68 withheld-item disclosure went with
 * it, because it is gated on the same value.
 *
 * A shortened deck reported at its shortened length with no mark is exactly
 * what TEN-68 forbids, and it was silent, so nobody reported it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearAttempt, saveAttempt } from "@ailx/session";
import { completedLog, memoryStorage } from "./helpers/completedAttempt";
import { syncKey } from "../lib/data/persistence";
import ReportPage from "../app/report/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  clearAttempt(window.localStorage);
  saveAttempt(window.localStorage, completedLog());
  window.localStorage.setItem("foray:dev-user", "tester");
  /* The review read only fires for an attempt the SERVICE holds; without a
     server attempt id `fetchServerDeck` returns null before any request. */
  window.localStorage.setItem(
    syncKey("att-fixture-0001"),
    JSON.stringify({ serverAttemptId: "srv-1", syncedThrough: 0, finalized: true }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearAttempt(window.localStorage);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function renderReport(): Promise<void> {
  await act(async () => {
    root.render(createElement(ReportPage));
  });
  // Let the review read settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Everything answers, except the review read. */
function stubService(itemsResponse: () => Promise<Response>): void {
  const mock = vi.fn(async (url: string) =>
    String(url).includes("/items") ? await itemsResponse() : new Response("{}", { status: 404 }),
  );
  vi.stubGlobal("fetch", mock);
  window.fetch = mock as unknown as typeof fetch;
}

const SAID = "The answer key for this deck could not be read";

describe("the review read has a failure state (TEN-221)", () => {
  it("says the answer key could not be read when the service refuses", async () => {
    stubService(async () => new Response("{}", { status: 500 }));
    await renderReport();
    const text = host.textContent ?? "";
    expect(text).toContain(SAID);
    // And nothing is drawn from keys the page does not have.
    expect(host.querySelector("[data-testid='calibration-curve']")).toBeNull();
    expect(host.querySelector("[data-testid='t2-withheld']")).toBeNull();
  });

  it("says it when the service cannot be reached at all", async () => {
    stubService(async () => {
      throw new TypeError("Failed to fetch");
    });
    await renderReport();
    expect(host.textContent ?? "").toContain(SAID);
  });

  it("says nothing of the kind when the read simply does not apply", async () => {
    /* A sitting still in its `sitting` phase serves no key by design, and the
       static demo has bundled keys of its own. Neither is a failure, and
       neither may carry a sentence that says one. */
    stubService(async () =>
      new Response(JSON.stringify({ phase: "sitting", deckDigest: null, released: true, items: [] }), {
        status: 200,
      }),
    );
    await renderReport();
    expect(host.textContent ?? "").not.toContain(SAID);
  });
});
