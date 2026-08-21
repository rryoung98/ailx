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
import { append, project, saveAttempt, clearAttempt, type SequencedEntry, type TrackId } from "@ailx/session";
import { buildSampleAttemptLog } from "../lib/sampleAttempt";
import { scoreTrack } from "../lib/registry";
import { calibrationBins, t2ResponsesFromArtifact } from "../lib/calibration";
import { t2Items } from "../lib/instrument";
import ReportPage from "../app/report/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

/**
 * The sample fixture stops at between_tracks (validate scores it itself);
 * the report needs a SCORED, completed attempt — extend the fixture through
 * the same real scoring path the exam page uses (registry → plugin.score).
 */
function completedLog(): SequencedEntry[] {
  let log = buildSampleAttemptLog();
  const lastTs = log[log.length - 1].ts;
  const completions = log.filter(
    (e): e is Extract<SequencedEntry, { type: "track_completed" }> => e.type === "track_completed",
  );
  let t = lastTs;
  for (const c of completions) {
    t += 1_000;
    const rec = scoreTrack(c.trackId as TrackId, c.artifact);
    log = append(log, {
      type: "track_scored", trackId: c.trackId, score: rec.score,
      judgments: rec.judgments, rubricVersion: rec.rubricVersion,
      scoringDigest: rec.scoringDigest, modelManifest: rec.modelManifest, ts: t,
    });
  }
  log = append(log, { type: "attempt_completed", ts: t + 1_000 });
  return log;
}

// jsdom in this environment does not always expose window.localStorage;
// install a spec-shaped in-memory Storage so the page's persistence path runs.
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
