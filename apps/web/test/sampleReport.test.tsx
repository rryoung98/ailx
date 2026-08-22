// @vitest-environment jsdom
/**
 * Report empty state offers a read-only sample report: the bundled fixture
 * renders with a clear sample banner, writes nothing to storage, and can be
 * exited back to the empty state.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReportPage from "../app/report/page";

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

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  store.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

function clickByText(text: string) {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.includes(text));
  expect(b, `button ${text}`).toBeTruthy();
  act(() => b!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("sample report", () => {
  it("renders the fixture read-only with a banner and exits cleanly", () => {
    act(() => root!.render(createElement(ReportPage)));
    expect(host.textContent).toContain("No run in this browser yet.");
    clickByText("Peek at a sample report");
    expect(host.textContent).toContain("not your play. Nothing was saved.");
    expect(host.textContent).toContain("Track breakdown");
    expect(store.size).toBe(0); // nothing persisted
    // The fixture's T2 artifact answers the FIXED default deck; scoring it
    // must not rotate to a per-attempt deck and lapse everything (T2 > 0).
    const t2Card = [...host.querySelectorAll("h3")].find((h) => h.textContent?.includes("Authenticity"))?.closest("div.card");
    expect(t2Card, "T2 card").toBeTruthy();
    expect(t2Card!.textContent).not.toContain("0.0 / 100");
    // The MBTI-style player profile renders from the same scored sample.
    const profile = host.querySelector('[data-testid="player-profile"]');
    expect(profile, "player profile").toBeTruthy();
    expect(profile!.textContent).toMatch(/[KT][CB][VA][IO]/);
    clickByText("Exit sample");
    expect(host.textContent).toContain("No run in this browser yet.");
  });
});
