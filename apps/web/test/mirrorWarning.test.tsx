// @vitest-environment jsdom
/**
 * TEN-123 — a hosted sitting that is not being mirrored says so.
 *
 * `browserApiOptions()` declared `onSyncError` and passed none, so every
 * mirror failure during a sitting was swallowed: a candidate could sit a full
 * run whose event log never reached the exam service and find out only when
 * the report could not find their attempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { append, ATTEMPT_KEY, type SessionConfig } from "@ailx/session";
import { withQueryClient } from "./helpers/clientPage";
import { MIRROR_WARNING_LABEL } from "../features/exam/MirrorWarning";
import { getAttemptPersistence } from "../lib/data/persistence";
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

const ATTEMPT = "att-mirror";

function seedSitting() {
  const log = append([], { type: "attempt_started", attemptId: ATTEMPT, config, ts: Date.now() - 60_000 });
  window.localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ formatVersion: 1, rev: 1, log }));
  return log;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
/** Every mirror POST fails until this is turned off. */
let failing = true;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  failing = true;
  const fetchFn = (async () => {
    if (failing) throw new TypeError("network down");
    return { ok: true, status: 201, json: async () => ({ attempt: { id: ATTEMPT } }) } as Response;
  }) as typeof fetch;
  vi.stubGlobal("fetch", fetchFn);
  Object.defineProperty(window, "fetch", { value: fetchFn, configurable: true });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(withQueryClient(createElement(ExamPage))); });
  await act(async () => { await getAttemptPersistence().flush(); });
  return host;
}

describe("a sitting whose mirror is failing", () => {
  it("raises a persistent indicator in the exam chrome", async () => {
    seedSitting();
    const el = await render();
    const banner = el.querySelector('[data-testid="mirror-warning"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain(MIRROR_WARNING_LABEL);
    // Non-dismissable: nothing on it turns it off.
    expect(banner!.querySelector("button")).toBeNull();
  });

  it("clears on the next sync that lands", async () => {
    const log = seedSitting();
    const el = await render();
    expect(el.querySelector('[data-testid="mirror-warning"]')).not.toBeNull();
    failing = false;
    await act(async () => {
      getAttemptPersistence().save(log);
      await getAttemptPersistence().flush();
    });
    expect(el.querySelector('[data-testid="mirror-warning"]')).toBeNull();
  });

  it("says nothing while the mirror is landing", async () => {
    failing = false;
    seedSitting();
    const el = await render();
    expect(el.querySelector('[data-testid="mirror-warning"]')).toBeNull();
  });
});
