// @vitest-environment jsdom
/**
 * Report empty state offers a read-only sample report: the bundled fixture
 * renders with a clear sample banner, writes nothing to storage, and can be
 * exited back to the empty state.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AXES } from "@ailx/report";
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
    // ONE identity: the player-type card, with its four measured axes inside
    // it. The old second code space (KCVI-shaped) is gone.
    const axes = host.querySelector('[data-testid="player-axes"]');
    expect(axes, "player axes").toBeTruthy();
    expect(host.querySelector(".ptype-card")!.textContent).toMatch(/[MP][ST][VA][DE]/);
    expect(host.querySelector('[data-testid="player-profile"]'), "second identity").toBeNull();
    clickByText("Exit sample");
    expect(host.textContent).toContain("No run in this browser yet.");
  });

  /**
   * The report used to print the SAME four AXES sentences twice on one page:
   * once as the player type's "Where you played strong", and again as the
   * diagnosis findings. Both read `AXES` in @ailx/report, so they could never
   * disagree — they could only waste the reader's attention.
   */
  it("says each strength/watch-out in one place, the diagnosis", () => {
    act(() => root!.render(createElement(ReportPage)));
    clickByText("Peek at a sample report");
    const typeCard = host.querySelector(".ptype-card")!.textContent!;
    const diagnosis = host.querySelector('[aria-labelledby="diagnosis-heading"]')!.textContent!;
    for (const axis of AXES) {
      for (const sentence of [axis.strength, axis.watchout]) {
        expect(typeCard, sentence).not.toContain(sentence);
      }
    }
    // One of the two per track, so all four tracks still speak — just once.
    const shown = AXES.filter(
      (a) => diagnosis.includes(a.strength) || diagnosis.includes(a.watchout),
    );
    expect(shown).toHaveLength(AXES.length);
  });

  it("identity leads, and its evidence follows it", () => {
    act(() => root!.render(createElement(ReportPage)));
    clickByText("Peek at a sample report");
    const type = host.querySelector(".ptype-card");
    const profile = host.querySelector('[data-testid="player-axes"]');
    const diagnosis = host.querySelector('[aria-labelledby="diagnosis-heading"]');
    for (const [name, el] of [["type", type], ["profile", profile], ["diagnosis", diagnosis]] as const) {
      expect(el, name).toBeTruthy();
    }
    // The evidence lives INSIDE the identity card — one card, not two.
    expect(type!.contains(profile!)).toBe(true);
    // Node.DOCUMENT_POSITION_FOLLOWING === 4.
    expect(type!.compareDocumentPosition(profile!) & 4).toBe(4);
    expect(profile!.compareDocumentPosition(diagnosis!) & 4).toBe(4);
  });

  it("does not restate the process notes a second time", () => {
    act(() => root!.render(createElement(ReportPage)));
    clickByText("Peek at a sample report");
    expect(host.textContent).toContain("How you worked");
    expect(host.textContent).not.toContain("What the log says about you");
  });
});
