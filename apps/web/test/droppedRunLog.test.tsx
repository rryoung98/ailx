// @vitest-environment jsdom
/**
 * TEN-220, end to end on the exam page: a stored run that this build cannot
 * replay AT ALL is still the candidate's work, and losing it is a fact they
 * are told out loud.
 *
 * The truncation notice (TEN-160) covered the partial case only. A log whose
 * FIRST entry fails to replay dropped everything and returned `null`, which
 * the page could not tell from "this browser never sat anything" — so the
 * candidate silently started over.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { withQueryClient } from "./helpers/clientPage";
import { ATTEMPT_KEY, type SessionConfig } from "@ailx/session";
import ExamPage from "../app/exam/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

const config: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 }, demo: true,
};

/** A log that opens on an entry the machine refuses: no run ever started. */
function seedUnreplayableFromZero(): void {
  const t0 = Date.now() - 600_000;
  const log = [
    { type: "track_started", trackId: "t2", ts: t0, seq: 0 },
    { type: "attempt_started", attemptId: "att-lost", config, ts: t0 + 1_000, seq: 1 },
  ];
  window.localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ formatVersion: 1, rev: 1, log }));
}

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(withQueryClient(createElement(ExamPage))); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

describe("a stored run that replays from nowhere", () => {
  it("is announced, not silently discarded", async () => {
    seedUnreplayableFromZero();
    const el = await render();
    const banner = el.querySelector('[data-testid="persist-warning"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("Saved run damaged");
    expect(banner!.textContent).toContain("None of it replayed");
  });

  /**
   * The ADJACENT path of the same class: an attempt whose BYTES are
   * unreadable loses the same work and used to be the same silent null.
   */
  it("says the same for a stored run whose bytes cannot be read", async () => {
    window.localStorage.setItem(ATTEMPT_KEY, "{not json");
    const el = await render();
    const banner = el.querySelector('[data-testid="persist-warning"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("None of it replayed");
  });

  it("stays silent for a browser that has never sat anything", async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="persist-warning"]')).toBeNull();
  });
});
