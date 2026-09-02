/**
 * The spec is checked against the code, not the other way round.
 *
 * §04's design principle is a claim about how many of the 400 points one
 * scoring MECHANISM can damage. That claim was typed into `AILX-Spec-2026.1.md`
 * as prose and it went wrong by a factor of five: the spec said 40-45 points
 * were exposed to LLM-judge methodology while the built system resolved 241
 * of 400 through stored judge values. Nothing failed, because nothing was
 * comparing the two.
 *
 * This file compares them. It parses the mechanism table out of §04 and
 * asserts it against `pointsByResolution()`. If somebody re-weights a track
 * and forgets the spec, the build says so here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALLOCATED_TRACK_IDS,
  SCORE_ALLOCATION,
  TOTAL_POINTS,
  pointsByResolution,
  trackPoints,
  unimplementedPoints,
  type Resolution,
} from "../src/allocation.js";

const SPEC = readFileSync(
  fileURLToPath(new URL("../../../AILX-Spec-2026.1.md", import.meta.url)),
  "utf8",
);

/** First-cell keyword -> the mechanism that row is about. */
const ROW_KEYWORDS: ReadonlyArray<readonly [string, Resolution]> = [
  ["Model-free arithmetic", "model-free"],
  ["Machine-checkable gates", "machine-gate"],
  ["Blinded human pairwise comparison", "human-cj"],
  ["LLM jury against a locked rubric", "llm-judge"],
];

/**
 * The §04 mechanism table as { designed, implemented } per row keyword.
 * Deliberately strict: a table that stops being parseable is a table that
 * stopped being checked, so a missing row fails rather than being skipped.
 */
function specMechanismTable(): Record<Resolution, { designed: number; implemented: number }> {
  const heading = "#### How the 375 points are actually resolved";
  const start = SPEC.indexOf(heading);
  expect(start, "§04 mechanism-table heading").toBeGreaterThan(-1);
  const section = SPEC.slice(start, SPEC.indexOf("\n#### ", start + heading.length));
  const out = {} as Record<Resolution, { designed: number; implemented: number }>;
  for (const [keyword, resolution] of ROW_KEYWORDS) {
    const line = section
      .split("\n")
      .find((l) => l.startsWith("|") && l.includes(keyword));
    expect(line, `spec row for "${keyword}"`).toBeTruthy();
    const cells = line!.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    const nums = cells.slice(1).map((c) => Number(c.replace(/\*/g, "")));
    expect(nums.length, `two numeric cells for "${keyword}"`).toBe(2);
    for (const n of nums) expect(Number.isFinite(n), `numeric cell for "${keyword}"`).toBe(true);
    out[resolution] = { designed: nums[0], implemented: nums[1] };
  }
  return out;
}

describe("AILX-Spec-2026.1 §04 agrees with the allocation table", () => {
  it("states the same designed exposure per mechanism that the code allocates", () => {
    const spec = specMechanismTable();
    const code = pointsByResolution();
    for (const [, resolution] of ROW_KEYWORDS) {
      expect(spec[resolution].designed, resolution).toBe(code[resolution]);
    }
  });

  it("has a designed column that totals the instrument", () => {
    const spec = specMechanismTable();
    const sum = ROW_KEYWORDS.reduce((a, [, r]) => a + spec[r].designed, 0);
    expect(sum).toBe(TOTAL_POINTS);
  });

  /**
   * The IMPLEMENTED column is the honest half. Every unimplemented component
   * resolves through the stored-judge path today, whatever mechanism it is
   * designed for, because score() cannot tell a stored human comparison from
   * a stored model judgment.
   *
   * What this assertion does NOT do is check the metadata against the code.
   * It reads `implemented` / `resolvedBy` — the same flags the spec sentence
   * was derived from — so it proves the prose agrees with the table and
   * nothing more. A component mislabelled `model-free` while its points come
   * from a stored judgment passes here. That gap is closed empirically by
   * `apps/web/test/allocationResolution.test.ts`, which runs the REAL plugin
   * score() over a fixture, varies only the stored judgments, and asserts
   * that the components which MOVE are exactly the ones this table calls
   * judge-resolved. It lives in apps/web because core is what the track
   * plugins import, so core may not import them back.
   */
  it("states an implemented LLM-jury exposure that matches the unimplemented set", () => {
    const spec = specMechanismTable();
    const implementedJury = ALLOCATED_TRACK_IDS.reduce(
      (a, t) =>
        a +
        SCORE_ALLOCATION[t].components
          .filter((c) => c.resolvedBy === "llm-judge" || !c.implemented)
          .reduce((s, c) => s + c.points, 0),
      0,
    );
    expect(spec["llm-judge"].implemented).toBe(implementedJury);
    // ...and nothing unimplemented is credited to its designed mechanism.
    for (const r of ["machine-gate", "human-cj"] as const) {
      expect(spec[r].implemented).toBe(0);
    }
  });

  it("quotes the same per-track point totals the code allocates", () => {
    expect(SPEC).toContain("**T1 — Creative Build** (135 pts");
    expect(SPEC).toContain("**T2 — Synthetic-Media Discrimination** (80 pts");
    expect(SPEC).toContain("**T3 — Calibrated Reliance** (160 pts");
    expect(SPEC).toContain("**T4 — Generative Direction** (**0 pts — unscored showcase**");
    expect(trackPoints("t1")).toBe(135);
    expect(trackPoints("t2")).toBe(80);
    expect(trackPoints("t3")).toBe(160);
    expect(trackPoints("t4")).toBe(0);
  });

  it("quotes the unimplemented point count the code reports", () => {
    expect(unimplementedPoints()).toBe(145);
    expect(SPEC).toContain("**145 points**");
  });

  it("states the safety bound as the number the code produces", () => {
    const code = pointsByResolution();
    expect(SPEC).toContain(
      `damages at most ${code["llm-judge"]} of ${TOTAL_POINTS} points`,
    );
    expect(SPEC).toContain(
      `${code["model-free"]} of ${TOTAL_POINTS}, is arithmetic on stored response data`,
    );
  });

  it("no longer carries the false 40-45 claim as a live statement", () => {
    // The phrase survives ONLY inside the paragraph that retracts it.
    const occurrences = SPEC.split("40–45 points out of 400").length - 1;
    expect(occurrences).toBe(1);
    const idx = SPEC.indexOf("40–45 points out of 400");
    const around = SPEC.slice(idx - 400, idx + 400);
    expect(around).toMatch(/false in both directions|was wrong/);
  });
});
