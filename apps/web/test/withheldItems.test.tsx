// @vitest-environment jsdom
/**
 * The withheld arm on the report — TEN-68.
 *
 * Two rules, and both are the point of the component. A dealt item the bank
 * later lost is SHOWN, with its reason and the candidate's own status, so a
 * review never quietly reports a shorter deck than the one that was sat
 * (TEN-61). And none of the item's material may appear, because none of it
 * reached the browser: a withheld entry carries no stem, no options, no key
 * and no rationale.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WithheldItem } from "@ailx/contract";
import { WithheldItems } from "../features/report/WithheldItems";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render(dealt: number, withheld: readonly WithheldItem[]): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(WithheldItems, { dealt, withheld }));
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const withdrawn: WithheldItem = {
  phase: "withheld",
  id: "itm-withdrawn",
  withheld: "withdrawn",
  yourChoice: 1,
};

describe("WithheldItems", () => {
  it("renders a withdrawn item, its reason and the answer status", () => {
    const el = render(6, [withdrawn]);
    expect(el.querySelector("[data-testid='t2-withheld']")).not.toBeNull();
    const line = el.querySelector("[data-withheld-item='itm-withdrawn']")!.textContent!;
    expect(line).toContain("withdrawn from the bank");
    expect(line).toContain("your answer is recorded");
    expect(el.textContent).toContain("1 of the 6 items you were dealt is no longer in the item bank");
    expect(el.textContent).toContain("still counts toward this score");
  });

  it("keeps the DEALT count, not the count that survived", () => {
    const el = render(6, [withdrawn]);
    expect(el.querySelector("[data-testid='withheld-count']")!.textContent).toBe(
      "6 items dealt · 1 withheld · 5 in the bank",
    );
  });

  it("says the plural, and does not dress an unexplained gap as a withdrawal", () => {
    const el = render(
      6,
      [withdrawn, { phase: "withheld", id: "itm-gone", withheld: "unavailable" }],
    );
    expect(el.textContent).toContain("2 of the 6 items you were dealt are no longer");
    expect(el.textContent).toContain("still count toward this score");
    const gap = el.querySelector("[data-withheld-item='itm-gone']")!.textContent!;
    expect(gap).toContain("missing from the bank; the ledger does not record why");
    expect(gap).not.toContain("withdrawn");
    // No choice was recorded for this one, and it says so rather than implying one.
    expect(gap).toContain("no answer was recorded");
  });

  it("leaks NO material: no stem, no options, no key, no rationale", () => {
    // The component is handed the whole entry; a future field that carried
    // content would have to be printed deliberately to appear here.
    const el = render(6, [
      {
        ...withdrawn,
        stem: "Camera-captured or AI-generated?",
        options: ["Authentic", "AI-generated"],
        key: 1,
        rationale: "the hands have six fingers",
      } as unknown as WithheldItem,
    ]);
    const text = el.textContent ?? "";
    for (const secret of [
      "Camera-captured",
      "AI-generated",
      "Authentic",
      "six fingers",
      "rationale",
      "Answer:",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(el.innerHTML).not.toContain("six fingers");
  });

  it("renders nothing when the review withheld nothing", () => {
    const el = render(6, []);
    expect(el.textContent).toBe("");
  });
});
