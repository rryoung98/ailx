// @vitest-environment jsdom
/**
 * Reliance is never shown as a bare number — TEN-35.
 *
 * T3's `errorCatchRate` is 50 points and `adviceUptakeRate` is 30, both estimated from at most 8
 * planted errors and the correct-advice claims beside them. On 8 events the
 * 95% interval on a rate is wider than half the scale, so a two-decimal rate
 * printed on its own claims a precision the instrument does not have.
 *
 * These tests fail if a reliance point estimate reaches the page without its
 * interval, without the band, or through any path other than the pure
 * derivation in @ailx/track-t3.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearAttempt, saveAttempt } from "@ailx/session";
import { formatInterval, relianceReportFromRaw, wilsonInterval } from "@ailx/track-t3";
import { browserSources } from "./helpers/browserSources";
import { completedLog, completedState, memoryStorage } from "./helpers/completedAttempt";
import { RelianceCard } from "../features/report/RelianceCard";
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

const render = async (el: Parameters<Root["render"]>[0]) => {
  await act(async () => { root.render(el); });
};

/** A two-decimal rate, with the typographic minus the formatter uses. */
const RATE = /^\u2212?\d\.\d\d$/;

describe("the report never shows a reliance rate without its interval", () => {
  it("renders all three reliance rows, each with a 95% interval", async () => {
    await render(createElement(ReportPage));
    const section = host.querySelector('[data-testid="t3-reliance"]');
    expect(section, "T3 reliance section").toBeTruthy();
    const rows = [...section!.querySelectorAll("[data-reliance-row]")];
    expect(rows.map((r) => r.getAttribute("data-reliance-row"))).toEqual([
      "over", "under", "index",
    ]);
    for (const row of rows) {
      const cells = [...row.children].map((c) => c.textContent ?? "");
      const rate = cells.find((c) => RATE.test(c.trim()));
      expect(rate, `point estimate in ${row.getAttribute("data-reliance-row")}`).toBeTruthy();
      const interval = row.querySelector("[data-reliance-interval]");
      expect(interval, `interval beside ${row.getAttribute("data-reliance-row")}`).toBeTruthy();
      expect(interval!.textContent).toMatch(/^95% CI \u2212?\d\.\d\d to \u2212?\d\.\d\d$/);
    }
  });

  it("names the band and says it is read from both tails", async () => {
    await render(createElement(ReportPage));
    const band = host.querySelector('[data-testid="reliance-band"]')!;
    expect(band).toBeTruthy();
    expect(band.textContent).toMatch(/over-reliant|calibrated|under-reliant/);
    expect(band.textContent).toContain("both tails");
  });

  it("prints the intervals the derivation computed, not a rounded guess", async () => {
    await render(createElement(ReportPage));
    const raw = completedState().tracks.t3.score!.raw;
    const report = relianceReportFromRaw(raw)!;
    const section = host.querySelector('[data-testid="t3-reliance"]')!;
    for (const row of report.rows) {
      expect(section.textContent).toContain(formatInterval(row.interval));
    }
  });

  it("carries the precision and reliability notes with the numbers", async () => {
    await render(createElement(ReportPage));
    const raw = completedState().tracks.t3.score!.raw;
    const section = host.querySelector('[data-testid="t3-reliance"]')!;
    // The precision note is worked from the plants THIS sitting surfaced
    // (TEN-91), not from a count written into the sentence.
    expect(section.textContent).toContain(relianceReportFromRaw(raw)!.precisionNote);
    const n = raw.plantedSurfaced;
    if (n >= 2) {
      expect(section.textContent).toContain(formatInterval(wilsonInterval(Math.floor(n / 2), n)));
    } else {
      expect(section.textContent).toContain("fewer than two events is not an estimate");
    }
    expect(section.textContent).toContain("Karvelis");
    expect(section.textContent).toContain("ICC below 0.5");
  });

  it("shows the underpowered warning exactly when the record flags it", async () => {
    await render(createElement(ReportPage));
    const raw = completedState().tracks.t3.score!.raw;
    const warned = host.querySelector('[data-testid="reliance-underpowered"]');
    expect(Boolean(warned)).toBe(raw["errorCatchRate.underpowered"] === 1);
    if (warned) {
      expect(warned.textContent).toBe(relianceReportFromRaw(raw)!.underpoweredNote);
      expect(warned.textContent).toContain(`surfaced ${raw.plantedSurfaced} planted error`);
      expect(warned.textContent).toContain("floor for reporting a rate is 8");
    }
  });
});

describe("RelianceCard on its own", () => {
  const raw = (plantedSurfaced: number, plantedCaught: number) => ({
    plantedSurfaced,
    plantedCaught,
    adviceSurfaced: 4,
    adviceAdopted: 3,
    "errorCatchRate.underpowered": plantedSurfaced < 8 ? 1 : 0,
  });

  it("says in plain English that an underpowered sitting is underpowered", async () => {
    await render(createElement(RelianceCard, { raw: raw(3, 2) }));
    const note = host.querySelector('[data-testid="reliance-underpowered"]')!;
    expect(note).toBeTruthy();
    expect(note.textContent).toBe(
      "This sitting surfaced 3 planted errors. The floor for reporting a rate is 8. " +
        "The over-reliance rate and the band rest on 3 events, so treat both as provisional.",
    );
  });

  it("drops the warning once the form surfaced eight plants", async () => {
    await render(createElement(RelianceCard, { raw: raw(8, 5) }));
    expect(host.querySelector('[data-testid="reliance-underpowered"]')).toBeNull();
    expect(host.querySelector('[data-testid="t3-reliance"]')).toBeTruthy();
  });

  it("shows no rate and no band when a side surfaced nothing", async () => {
    await render(createElement(RelianceCard, {
      raw: { plantedSurfaced: 0, plantedCaught: 0, adviceSurfaced: 0, adviceAdopted: 0 },
    }));
    const section = host.querySelector('[data-testid="t3-reliance"]')!;
    expect(section.querySelectorAll("[data-reliance-interval]")).toHaveLength(0);
    expect(section.textContent).toContain("no rate");
    expect(host.querySelector('[data-testid="reliance-band"]')!.textContent).toBe(
      "No band: one side of the measure had no events in this sitting.",
    );
  });

  it("renders nothing for a raw record with no reliance counts", async () => {
    await render(createElement(RelianceCard, { raw: { gates: 10 } }));
    expect(host.querySelector('[data-testid="t3-reliance"]')).toBeNull();
  });
});

/**
 * The durable half of the guard. A DOM assertion only covers the card that
 * exists today; this one fails if any NEW frontend module starts printing a
 * reliance rate straight out of the raw record, which is how the interval
 * would get lost again.
 */
describe("no frontend module reads a reliance rate out of the raw record", () => {
  const files = browserSources(/\.tsx?$/);

  it("scans a real file list", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  /**
   * Both the stored rate keys and the counts a rate could be recomputed from.
   * RelianceCard is the one allowed reader, and it only calls the derivation.
   */
  const FORBIDDEN = /reliance\.(over|under|index)|plantedSurfaced|plantedCaught|adviceSurfaced|adviceAdopted/;

  it("finds no reliance rate or count read outside RelianceCard", () => {
    const offenders = files
      .filter((f) => !f.endsWith("RelianceCard.tsx"))
      .filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")));
    expect(offenders, "read reliance rates through relianceReportFromRaw instead").toEqual([]);
  });

  it("and RelianceCard itself computes no rate", () => {
    const card = readFileSync(join(__dirname, "..", "features", "report", "RelianceCard.tsx"), "utf8");
    expect(card).not.toMatch(FORBIDDEN);
    expect(card).toContain("relianceReportFromRaw");
  });
});
