// @vitest-environment jsdom
/**
 * EVERY TRACK FIGURE IS DRAWN AGAINST ITS OWN MAXIMUM (TEN-120).
 *
 * The allocation is T1 = 135, T2 = 80, T3 = 160, T4 = 0 (showcase), total
 * 375. Every figure on the report, the share card and the public gallery was
 * drawn on a /100 axis anyway, which is wrong three separate ways:
 *
 *  - T3 was CLIPPED: every score from 100 to 160 drew the same full bar and
 *    the same outer vertex, so the top 60 points were invisible;
 *  - T2 could never FILL: a perfect 80/80 drew at 80%, beside a T1 at
 *    100/135 drawing full, so the stronger performance looked weaker;
 *  - T4 issues no points and was drawn as a fourth scored spoke.
 *
 * `packages/report/src/judging.ts` already states the rule for the numeric
 * surface: "'87.9 / 100' printed under a 160-point track is a wrong number in
 * front of a candidate, which is worse than no number." This is the graphical
 * surface — the one that gets screenshotted — held to it.
 *
 * The maxima are read from `TRACK_META`, which derives them from
 * `SCORE_ALLOCATION` in `@ailx/core`. There is no second copy.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { formatTrackScore, TRACK_META } from "@ailx/report";
import { TrackRadar } from "../components/TrackRadar";

/** The polygon the radar draws, as [x, y] pairs. */
function vertices(values: Record<"t1" | "t2" | "t3" | "t4", number>): [number, number][] {
  const html = renderToStaticMarkup(createElement(TrackRadar, { values }));
  const el = document.createElement("div");
  el.innerHTML = html;
  const shape = [...el.querySelectorAll("polygon")].at(-1)!;
  return shape
    .getAttribute("points")!
    .split(" ")
    .map((p) => p.split(",").map(Number) as [number, number]);
}

/** Distance of each vertex from the radar's centre. */
function radii(values: Record<"t1" | "t2" | "t3" | "t4", number>): number[] {
  return vertices(values).map(([x, y]) => Math.hypot(x - 110, y - 110));
}

const ZERO = { t1: 0, t2: 0, t3: 0, t4: 0 };

describe("the radar's axis is each track's own maximum", () => {
  it("draws a perfect T2 at the outer ring, where a /100 axis drew 80%", () => {
    const full = radii({ ...ZERO, t2: TRACK_META.t2.points });
    const outer = Math.max(...radii({ t1: 999, t2: 999, t3: 999, t4: 999 }));
    expect(full[1]).toBeCloseTo(outer, 6);
  });

  it("tells a T3 of 160 apart from a T3 of 100, which the clip could not", () => {
    const at160 = radii({ ...ZERO, t3: 160 })[2];
    const at100 = radii({ ...ZERO, t3: 100 })[2];
    expect(at160).toBeGreaterThan(at100);
    expect(at100 / at160).toBeCloseTo(100 / TRACK_META.t3.points, 6);
  });

  it("draws no spoke for T4, which issues no points", () => {
    /* Three scored tracks, three vertices. A fourth spoke would be a score
       T4 does not have, and `TRACK_META.t4.scored` is the one place that
       says so. */
    expect(TRACK_META.t4.scored).toBe(false);
    expect(vertices({ t1: 10, t2: 10, t3: 10, t4: 10 })).toHaveLength(3);
    const html = renderToStaticMarkup(createElement(TrackRadar, { values: { ...ZERO, t4: 50.6 } }));
    expect(html).not.toMatch(/>T4</);
  });

  it("names T4 as a showcase rather than leaving it off in silence", () => {
    const html = renderToStaticMarkup(createElement(TrackRadar, { values: { ...ZERO, t4: 50.6 } }));
    expect(html).toContain("showcase, not scored");
  });

  it("puts each track's denominator in the label a screen reader hears", () => {
    const html = renderToStaticMarkup(
      createElement(TrackRadar, { values: { t1: 88.9, t2: 52.9, t3: 124.6, t4: 50.6 } }),
    );
    expect(html).toContain("T1 88.9 / 135");
    expect(html).toContain("T2 52.9 / 80");
    expect(html).toContain("T3 124.6 / 160");
  });

  it("takes the maxima from one source and keeps nothing of its own", () => {
    /* DRY, and checkable: a second copy of the allocation would drift. The
       component's CODE may name no track total — the prose above it may,
       and does, because a comment that explains the defect has to quote the
       numbers that caused it. */
    const code = readSource()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const n of ["135", "160", "80", "375"]) expect(code, n).not.toContain(n);
    expect(code).toContain("TRACK_META");
  });
});

describe("the numbers beside the figures carry their denominator", () => {
  it("a bar's number says which total it is out of", () => {
    /* Every bar row is built from `formatTrackScore`, the one formatter that
       already refuses to print a bare number (packages/report judging.ts).
       The surfaces are held to USING it by the next test. */
    expect(formatTrackScore({ scaled: 88.2 }, undefined, "t1")).toBe("88.2 / 135");
    expect(formatTrackScore({ scaled: 80 }, undefined, "t2")).toBe("80.0 / 80");
    expect(formatTrackScore({ scaled: 124.6 }, undefined, "t3")).toBe("124.6 / 160");
    expect(formatTrackScore({ scaled: 50.6 }, undefined, "t4")).toContain("showcase, not scored");
  });

  it("no surface still draws a track on a /100 axis", () => {
    /* The three figures TEN-120 names, plus the composite card that stands
       beside them. Each must go through `trackFillPercent`, which is the one
       place the axis is decided. */
    for (const file of [
      ["features", "share", "ShareView.tsx"],
      ["features", "report", "CompositeCard.tsx"],
    ]) {
      const src = read(...file);
      expect(src, file.join("/")).toContain("trackFillPercent");
      expect(src, file.join("/")).not.toContain("Math.min(100, p.tracks[t])");
      expect(src, file.join("/")).not.toContain("Math.min(100, b.value)");
    }
  });
});

function read(...parts: string[]): string {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join, dirname } = require("node:path") as typeof import("node:path");
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ...parts), "utf8");
}

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join, dirname } = require("node:path") as typeof import("node:path");
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "..", "components", "TrackRadar.tsx"), "utf8");
}
