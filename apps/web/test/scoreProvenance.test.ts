/**
 * Two honesty properties of the SHIPPED product, checked against the real
 * functions rather than against copy:
 *
 * 1. No user-visible track score renders without saying what produced it
 *    (F2/F14 — a sha256-seeded heuristic printed as a bare "87.9 / 100").
 * 2. Each finish step's stated price is TRUE: "leave it blank and that
 *    component scores zero" must be worth exactly zero points (F9 — T4 paid
 *    a 0.2 floor for an empty note while T1's identical sentence was true).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEMO_SCORE_NOTE, DEMO_SCORE_QUALIFIER, formatTrackScore, isDemoScored,
} from "@ailx/report";
import { scoreTrack } from "../lib/registry";
import { t2Items } from "../lib/instrument";

const read = (rel: string) => readFileSync(fileURLToPath(new NodeURL(rel, import.meta.url)), "utf8");

const t1 = (selfReport: string) => ({
  html: "<html><head><style>h1{color:#123}</style></head><body><header><h1>Hi</h1></header>" +
    "<main><section><p>a small but real artifact</p></section></main></body></html>",
  promptLog: [{ kind: "prompted", prompt: "draft", clientTs: "2026-01-01T00:00:30.000Z" }],
  selfReport,
});

const t4 = (note: string) => ({
  drafts: [
    { index: 0, prompt: "poster", svg: "<svg/>", clientTs: "2026-01-01T00:00:00.000Z" },
    { index: 1, prompt: "poster, one focal figure, wide margins, warm dawn palette", svg: "<svg/>", clientTs: "2026-01-01T00:00:01.000Z" },
  ],
  finals: {
    images: [{ kind: "image", fromDraftIndex: 1, prompt: "poster, one focal figure, wide margins, warm dawn palette", asset: "<svg/>", clientTs: "2026-01-01T00:00:02.000Z" }],
  },
  chosenSet: [0],
  note,
  disclosed: true,
});

describe("the finish steps price the skip truthfully (F9)", () => {
  it("T4: an empty direction note scores literally zero, as the runner says", () => {
    const copy = read("../../../packages/tracks/t4-generative/src/Runner.tsx");
    expect(copy).toContain("that component then scores zero");
    const blank = scoreTrack("t4", t4(""));
    expect(blank.score.raw["craft.note"]).toBe(0);
    // And the claim is only meaningful because a written note DOES pay.
    const written = scoreTrack("t4", t4("The dawn palette carries the brief: one focal figure, wide margins, warm light."));
    expect(written.score.raw["craft.note"]).toBeGreaterThan(0);
    expect(written.score.scaled).toBeGreaterThan(blank.score.scaled);
  });

  it("T1: an empty design rationale scores literally zero, as the runner says", () => {
    const copy = read("../../../packages/tracks/t1-creative-build/src/Runner.tsx");
    expect(copy).toContain("that component then scores zero");
    expect(scoreTrack("t1", t1("")).score.raw.rationale).toBe(0);
    expect(scoreTrack("t1", t1("   \n ")).score.raw.rationale).toBe(0);
    expect(scoreTrack("t1", t1("I kept one column and raised contrast.")).score.raw.rationale).toBeGreaterThan(0);
  });
});

describe("no user-visible score renders without its provenance (F2/F14)", () => {
  it("marks every judged track score as a demo estimate", () => {
    for (const artifact of [["t1", t1("why")], ["t4", t4("a note")]] as const) {
      const rec = scoreTrack(artifact[0], artifact[1]);
      expect(isDemoScored(rec.judgments)).toBe(true);
      expect(formatTrackScore(rec.score, rec.judgments)).toContain(DEMO_SCORE_QUALIFIER);
    }
  });

  it("leaves the model-free track (T2) unqualified — it is measured, not judged", () => {
    const responses = t2Items("en").map((i) => ({
      itemId: i.id, choice: i.key, confidence: 70, latencyMs: 1200,
    }));
    const rec = scoreTrack("t2", { responses });
    expect(rec.judgments).toHaveLength(0);
    expect(isDemoScored(rec.judgments)).toBe(false);
    expect(formatTrackScore(rec.score, rec.judgments)).not.toContain(DEMO_SCORE_QUALIFIER);
  });

  it("the between-tracks screen prints scores only through the shared formatter", () => {
    const src = read("../app/exam/page.tsx");
    expect(src).toContain("formatTrackScore(ts.score, ts.judgments)");
    // The bare number this replaced.
    expect(src).not.toMatch(/score\.scaled\.toFixed/);
    // …and the screen says once, in words, what a demo estimate is.
    expect(src).toContain("DEMO_SCORE_NOTE");
    expect(DEMO_SCORE_NOTE).toContain("not a judged result");
  });
});
