// @vitest-environment jsdom
/**
 * A PARTIAL SITTING IS OFFERED NO SHARE CARD (TEN-233).
 *
 * The panel promised a card carrying "the tracks you sat", and no such card
 * exists: `SharePayload` requires a band, a player type and all four track
 * scores, `buildSharePayload` returns null for a run that is not fully
 * scored, and `ShareView` renders every field unconditionally. So the create
 * was refused by the service, or — worse — a stranger's `/s/<token>` would
 * throw and the unfurl would break.
 *
 * The panel is the one place that knows the shape, so the panel refuses. The
 * OTHER arm of the fix — a partial arm on `SharePayload` that the view and
 * `generateMetadata` both branch on — was not taken, because it means
 * changing `packages/report`, which is vendored into the private backend
 * repo and compared byte for byte, for a card nobody has asked for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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

let container: HTMLDivElement;
let root: Root;
let calls: string[];

async function mount(sat: readonly ("t1" | "t2" | "t3" | "t4")[]): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(ShareLink, { attemptId: ATTEMPT, sat }));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  window.localStorage.clear();
  window.localStorage.setItem("foray:dev-user", "player-9");
  container = document.createElement("div");
  document.body.append(container);
  calls = [];
  const mock = vi.fn(async (url: string) => {
    calls.push(String(url));
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", mock);
  window.fetch = mock as unknown as typeof fetch;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the share panel over PART of the instrument", () => {
  it("offers no create button, because there is no payload to create", async () => {
    await mount(["t2", "t3"]);
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(buttons).toHaveLength(0);
    expect(container.textContent).not.toContain("Create a share link");
  });

  it("says which three things are missing, and why", async () => {
    await mount(["t2", "t3"]);
    const said = container.querySelector("[data-testid='share-not-offered']")!.textContent ?? "";
    expect(said).toContain("T2 · T3");
    expect(said).toContain("four-letter type, your character and your band");
    expect(said).toContain("read over the whole instrument");
    expect(said).toContain("there is no card to make");
  });

  it("asks the service for nothing: there is no link to look for", async () => {
    await mount(["t2", "t3"]);
    expect(calls).toEqual([]);
  });

  it("still offers the whole thing for a FULL sitting", async () => {
    await mount(["t1", "t2", "t3", "t4"]);
    expect(container.textContent).toContain("Create a share link");
    expect(container.querySelector("[data-testid='share-not-offered']")).toBeNull();
  });
});
