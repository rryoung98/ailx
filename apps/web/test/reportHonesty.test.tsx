// @vitest-environment jsdom
/**
 * Report honesty regression (dogfood F13 / finding 8).
 *
 * The top of /report used to print "composite · mean 50 · SD 15 · P78.9",
 * "run … · n = 45" and a 45-dot strip, while the SAME page (its diagnosis)
 * and /world both state there is no percentile and no judged result here.
 * A percentile-shaped number is screenshotted and quoted without the small
 * "demo cohort" pill, so it is gone: what remains is a composite standardized
 * on a cohort that names itself synthetic, at a glance, in a caption.
 *
 * These tests assert the RENDERED report and the COPIED summary.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { saveAttempt, clearAttempt } from "@ailx/session";
import { candidateComposite } from "@ailx/report";
import { completedLog, completedState, memoryStorage } from "./helpers/completedAttempt";
import ReportPage from "../app/report/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let copied: string[];

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  clearAttempt(window.localStorage);
  saveAttempt(window.localStorage, completedLog());
  copied = [];
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t: string) => { copied.push(t); return Promise.resolve(); } },
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearAttempt(window.localStorage);
});

async function renderReport() {
  await act(async () => { root.render(createElement(ReportPage)); });
}

/** "P78.9", "P45.6 of 45", "78.9th percentile" — anything read as a rank. */
const PERCENTILE_SHAPED = [
  /\bP\s?\d+(\.\d+)?\b/,
  /\d+(\.\d+)?\s*(st|nd|rd|th)\s+percentile/i,
  /\btop\s+\d+\s?%/i,
  /percentile of\b/i,
  /\bP\d+(\.\d+)? of \d+/,
];
/** Page-wide: the player-type axes legitimately print "Prompter P 1.00". */
const RANK_CLAIM = PERCENTILE_SHAPED.slice(1);

describe("report honesty: no unqualified percentile-shaped number", () => {
  it("never renders a percentile-shaped number anywhere on the page", async () => {
    await renderReport();
    const text = host.textContent ?? "";
    expect(text).toContain("composite"); // the page really did render
    for (const re of RANK_CLAIM) expect(text).not.toMatch(re);
    // The score card at the top is where "P78.9" used to live.
    const card = host.querySelector(".share-card")!;
    for (const re of PERCENTILE_SHAPED) expect(card.textContent).not.toMatch(re);
  });

  it("keeps the composite, the standardization and the cohort-relative cutlines", async () => {
    await renderReport();
    const summary = candidateComposite(completedState())!;
    const card = host.querySelector(".share-card")!;
    // The composite itself counts up from 0, so assert the element and the
    // values that are not animated; the number is documented demo-relative.
    expect(card.querySelector(".composite-number")).toBeTruthy();
    expect(card.textContent).toContain("mean 50 · SD 15");
    expect(card.textContent).toContain(`Distinction ≥ ${summary.bandCutlines.Distinction!.toFixed(1)}`);
    expect(card.querySelector('[data-testid="dist-strip"] svg')!.querySelectorAll("circle").length)
      .toBe(summary.cohortComposites.length);
  });

  it("agrees with its own diagnosis, which denies a percentile", async () => {
    await renderReport();
    expect(host.textContent).toContain("No percentile, no cohort rank and no judged result");
  });

  it("copies a summary with no percentile and no cohort rank", async () => {
    await renderReport();
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("copy summary"));
    expect(btn, "copy summary button").toBeTruthy();
    await act(async () => { btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(copied).toHaveLength(1);
    const summary = candidateComposite(completedState())!;
    for (const re of PERCENTILE_SHAPED) expect(copied[0]).not.toMatch(re);
    expect(copied[0]).not.toMatch(new RegExp(`P\\d+(\\.\\d+)? of ${summary.cohortSize}`));
    expect(copied[0]).toContain(`synthetic demo cohort of ${summary.cohortSize} generated runs`);
    expect(copied[0]).toContain("no percentile, no judged result");
    expect(copied[0]).toContain(summary.composite.toFixed(1));
  });
});

describe("report honesty: the cohort is marked synthetic at a glance", () => {
  it("captions the distribution strip as synthetic generated runs, not people", async () => {
    await renderReport();
    const summary = candidateComposite(completedState())!;
    const fig = host.querySelector('[data-testid="dist-strip"]')!;
    expect(fig).toBeTruthy();
    const caption = fig.querySelector("figcaption")!;
    expect(caption).toBeTruthy();
    expect(caption.textContent).toContain(`Synthetic demo cohort — ${summary.cohortSize} generated runs`);
    expect(caption.textContent).toContain("not a person");
    expect(caption.textContent).toContain("not a percentile");
    // The caption is prose in the flow, not a decorative pill.
    expect(caption.textContent!.length).toBeGreaterThan(80);
  });

  it("tells a screen reader the same thing through the strip's label", async () => {
    await renderReport();
    const summary = candidateComposite(completedState())!;
    const svg = host.querySelector('[data-testid="dist-strip"] svg')!;
    expect(svg.getAttribute("aria-label")).toContain(`${summary.cohortSize} synthetic demo runs`);
    expect(svg.getAttribute("aria-label")).toContain("not a percentile");
  });

  it("qualifies n and the band cutlines in the header itself", async () => {
    await renderReport();
    const summary = candidateComposite(completedState())!;
    const eyebrow = host.querySelector(".share-card .eyebrow")!;
    expect(eyebrow.textContent).toContain(`synthetic demo cohort n = ${summary.cohortSize}`);
    const card = host.querySelector(".share-card")!;
    expect(card.textContent).toContain("standardized on the synthetic demo cohort");
    expect(card.textContent).toContain("band cutlines (this synthetic cohort)");
  });
});
