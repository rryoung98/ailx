// @vitest-environment jsdom
/**
 * Report visual-polish regression tests: with a complete persisted attempt
 * in localStorage, the report must render
 *   (a) the T2 calibration curve computed from PERSISTED responses only
 *       (bin counts must equal the answered responses in the artifact), and
 *   (b) the share-card per-track bars driven by the real track scores.
 * No invented numbers: both assertions recompute expectations from the same
 * fixture log the page reads.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { project, saveAttempt, clearAttempt } from "@ailx/session";
import { calibrationBins, t2ResponsesFromArtifact } from "@ailx/report";
import { t2Items } from "../lib/instrument";
import { completedLog, memoryStorage } from "./helpers/completedAttempt";
import ReportPage from "../app/report/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  clearAttempt(window.localStorage);
  saveAttempt(window.localStorage, completedLog());
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
  await act(async () => {
    root.render(createElement(ReportPage));
  });
}

describe("report visual polish", () => {
  it("renders the T2 calibration curve from the persisted artifact (no invented data)", async () => {
    await renderReport();
    const fig = host.querySelector('[data-testid="calibration-curve"]');
    expect(fig).toBeTruthy();

    // Recompute the expected total from the SAME persisted log.
    const state = project(completedLog());
    const keys: Record<string, number> = {};
    for (const it of t2Items("en")) keys[it.id] = it.key;
    const responses = t2ResponsesFromArtifact(state.tracks.t2.artifact);
    const answered = responses.filter((r) => r.choice !== -1 && keys[r.itemId] !== undefined);
    expect(answered.length).toBeGreaterThan(0);
    const bins = calibrationBins(responses, keys);
    expect(bins.reduce((a, b) => a + b.n, 0)).toBe(answered.length);

    const svg = fig!.querySelector("svg")!;
    expect(svg.getAttribute("aria-label")).toContain(`${answered.length} answered responses`);
    // one plotted point pair (halo + dot) per non-empty bin
    const nonEmpty = bins.filter((b) => b.n > 0).length;
    // circles: 2 per plotted bin
    expect(svg.querySelectorAll("circle").length).toBe(nonEmpty * 2);
  });

  it("renders share-card track bars matching the real per-track scores", async () => {
    await renderReport();
    const bars = host.querySelector('[data-testid="share-track-bars"]');
    expect(bars).toBeTruthy();
    const rows = bars!.querySelectorAll(".row");
    expect(rows.length).toBe(4);
    const state = project(completedLog());
    for (const tid of ["t1", "t2", "t3", "t4"] as const) {
      const scaled = state.tracks[tid].score!.scaled;
      expect(bars!.textContent).toContain(scaled.toFixed(1));
    }
  });

  it("keeps the calibration figure absent when there is no attempt", async () => {
    clearAttempt(window.localStorage);
    await renderReport();
    expect(host.querySelector('[data-testid="calibration-curve"]')).toBeNull();
  });
});
