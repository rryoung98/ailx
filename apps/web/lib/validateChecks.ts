/**
 * Validation checks — the "validate AILX quickly" page runs these in the
 * browser; apps/web vitest runs the same functions in node. Each check
 * returns PASS/FAIL plus evidence, never throws.
 */

// Deep import: the purity harness only (no node:crypto in the browser bundle).
import { runPure } from "@ailx/core/dist/purity.js";
import { SCORE_ALLOCATION, trackPoints } from "@ailx/core";
import {
  append, demoCohort, itemId, project, rubricVersionOf,
  scoreCohort, sha256Hex, TRACK_IDS,
  type TrackRawScores,
} from "@ailx/session";
import { t1Plugin } from "@ailx/track-t1";
import { plugin as t2Plugin, validateT2Config } from "@ailx/track-t2";
import { plugin as t3Plugin, validateT3Config } from "@ailx/track-t3";
import { t4Plugin } from "@ailx/track-t4";
import GOLDEN from "./fixtures/composite-golden.json";
import PLUGIN_GOLDEN from "./fixtures/plugin-golden.json";
import { scoreTrack, type TrackScoringRecord } from "./registry";
import { buildSampleAttemptLog } from "./sampleAttempt";

export interface CheckResult {
  id: string;
  title: string;
  pass: boolean;
  detail: string;
  spec: string;
}

type Check = () => Omit<CheckResult, "id" | "title" | "spec">;

function run(id: string, title: string, spec: string, fn: Check): CheckResult {
  try {
    return { id, title, spec, ...fn() };
  } catch (err) {
    return { id, title, spec, pass: false, detail: `threw: ${String(err)}` };
  }
}

const SAMPLE_ITEM = {
  bank: "t2-2026.1", kind: "media", stem: "Is this photograph authentic?",
  key: "synthetic", locale: { en: "…", ja: "…", ko: "…" },
};
const SAMPLE_ITEM_ID = "146a9d0f9a9396b8afa3ffbdbeee9ac430fe9820686fc5772006144452c2ef4f";
const SHA_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

interface PluginGoldenFixture {
  config: unknown;
  artifact: unknown;
  judgments: Array<{ dimension: string; sample: number; value: number; modelId: string }>;
  expected: { raw: Record<string, number>; scaled: number };
}

const PG = PLUGIN_GOLDEN as unknown as Record<"t1" | "t2" | "t3" | "t4", PluginGoldenFixture>;

/** Runs a REAL plugin score() on its golden fixture. Pure by contract. */
function runPluginGolden(t: "t1" | "t2" | "t3" | "t4") {
  const f = PG[t];
  const rubricVersion = "golden-rubric";
  switch (t) {
    case "t1":
      return t1Plugin.score(
        { artifact: f.artifact as never, judgments: f.judgments, rubricVersion },
        t1Plugin.validateConfig(f.config),
      );
    case "t2":
      return t2Plugin.score(
        { artifact: f.artifact as never, judgments: f.judgments, rubricVersion },
        validateT2Config(f.config),
      );
    case "t3":
      return t3Plugin.score(
        { artifact: f.artifact as never, judgments: f.judgments, rubricVersion },
        validateT3Config(f.config),
      );
    case "t4":
      return t4Plugin.score(
        { artifact: f.artifact as never, judgments: f.judgments, rubricVersion },
        t4Plugin.validateConfig(f.config),
      );
  }
}

export function runAllChecks(): CheckResult[] {
  return [
    run("sha256", "SHA-256 implementation", "FIPS 180-4", () => {
      const got = sha256Hex("abc");
      return {
        pass: got === SHA_ABC,
        detail: `sha256("abc") = ${got.slice(0, 16)}… (expected ${SHA_ABC.slice(0, 16)}…)`,
      };
    }),

    run("content-addressing", "Content addressing", "§14 — item_id = sha256(canonical_json(item))", () => {
      const id1 = itemId(SAMPLE_ITEM);
      const reordered = itemId({ locale: SAMPLE_ITEM.locale, key: SAMPLE_ITEM.key, stem: SAMPLE_ITEM.stem, kind: SAMPLE_ITEM.kind, bank: SAMPLE_ITEM.bank });
      const edited = itemId({ ...SAMPLE_ITEM, stem: SAMPLE_ITEM.stem + "!" });
      const pass = id1 === SAMPLE_ITEM_ID && reordered === id1 && edited !== id1;
      return {
        pass,
        detail: `id ${id1.slice(0, 12)}… matches frozen fixture; key order invariant: ${reordered === id1}; edited item is a NEW item: ${edited !== id1}`,
      };
    }),

    run("rubric-version", "Prompts are content", "§14 — rubric_version = hash(rubric + prompts)", () => {
      const v1 = rubricVersionOf(["rubric v1", "screening prompt A"]);
      const v2 = rubricVersionOf(["rubric v1", "screening prompt B"]);
      return {
        pass: v1 !== v2 && v1.length === 64,
        detail: `changing a judge prompt bumps rubric_version (${v1.slice(0, 10)}… → ${v2.slice(0, 10)}…)`,
      };
    }),

    run("purity", "Scoring purity harness", "§14 — score() runs where fetch/Date.now/Math.random throw", () => {
      // ALL FOUR real plugin scorers run inside the harness.
      const clean = (["t1", "t2", "t3", "t4"] as const).every((t) => {
        const s = runPure(() => runPluginGolden(t));
        return typeof s.scaled === "number";
      });
      let impureTrapped = false;
      try {
        runPure(() => Math.random());
      } catch {
        impureTrapped = true;
      }
      const composite = runPure(() => scoreCohort(GOLDEN.cohort as TrackRawScores[]));
      return {
        pass: clean && impureTrapped && composite.composite.length === GOLDEN.cohort.length,
        detail: `all four real plugin score() functions + the composite run clean under the harness; an impure score (Math.random) is trapped: ${impureTrapped}`,
      };
    }),

    run("plugin-golden", "Real scorer golden fixtures", "§14 — each track's score() reproduces pinned values", () => {
      const drift: string[] = [];
      for (const t of ["t1", "t2", "t3", "t4"] as const) {
        const got = runPure(() => runPluginGolden(t));
        if (JSON.stringify(got) !== JSON.stringify(PG[t].expected)) drift.push(t);
      }
      return {
        pass: drift.length === 0,
        detail: drift.length === 0
          ? `t1..t4 golden artifacts+judgments reproduce pinned scores (${(["t1", "t2", "t3", "t4"] as const).map((t) => `${t}:${PG[t].expected.scaled}`).join(" ")})`
          : `drift in: ${drift.join(", ")} — regenerate deliberately via apps/web/scripts/gen-plugin-golden.mjs`,
      };
    }),

    run("golden", "Golden fixture reproduction", "§14 — golden fixtures fail the build on any drift", () => {
      const r = scoreCohort(GOLDEN.cohort as TrackRawScores[]);
      const pass = JSON.stringify(r) === JSON.stringify(GOLDEN.expected);
      return {
        pass,
        detail: pass
          ? `12-candidate fixture reproduced byte-identically (composite[0] = ${r.composite[0]}, band[5] = ${r.band[5]})`
          : "drift detected against the frozen fixture",
      };
    }),

    run("reproducibility", "Composite reproducibility", "§04 — any score can be recomputed byte-identically", () => {
      const cohort = demoCohort("validate-repro", 45);
      const a = JSON.stringify(scoreCohort(cohort));
      const b = JSON.stringify(scoreCohort(cohort));
      const idx = cohort.map((_, i) => i).reverse();
      const perm = scoreCohort(idx.map((i) => cohort[i]));
      const orig = scoreCohort(cohort);
      const permOk = idx.every((oi, k) => perm.composite[k] === orig.composite[oi] && perm.band[k] === orig.band[oi]);
      return {
        pass: a === b && permOk,
        detail: `two runs byte-identical: ${a === b}; invariant under cohort permutation: ${permOk}`,
      };
    }),

    run("sample-attempt", "End-to-end sample attempt", "§04 — session log → REAL plugin scores → composite → band", () => {
      const result1 = scoreSampleAttempt();
      const result2 = scoreSampleAttempt();
      const identical = JSON.stringify(result1) === JSON.stringify(result2);
      // Each track's bound is ITS declared point total, not a flat 100 —
      // T1 and T3 are 160, T2 is 80, and T4 is an unscored showcase whose
      // 0-100 index is recorded but issues no points.
      const inBounds = result1.composite >= 0 && result1.composite <= 100 &&
        TRACK_IDS.every((t) => {
          const s = result1.tracks[t].score.scaled;
          const cap = SCORE_ALLOCATION[t].scored ? trackPoints(t) : 100;
          return s >= 0 && s <= cap;
        });
      const notInvalid = TRACK_IDS.every((t) => result1.tracks[t].score.raw.invalid === undefined);
      return {
        pass: identical && inBounds && notInvalid && result1.pausedMsAccounted,
        detail: `fixture attempt scores ${TRACK_IDS.map((t) => `${t}:${result1.tracks[t].score.scaled}`).join(" ")} → composite ${result1.composite} (${result1.band}); replay-deterministic: ${identical}; pause excluded from active time: ${result1.pausedMsAccounted}`,
      };
    }),
  ];
}

function scoreSampleAttempt() {
  const log = buildSampleAttemptLog();
  const state = project(log);
  const tracks = {} as Record<(typeof TRACK_IDS)[number], TrackScoringRecord>;
  const raw = {} as TrackRawScores;
  for (const t of TRACK_IDS) {
    // The SAME registry path the exam uses: real plugin score() under runPure.
    const s = runPure(() => scoreTrack(t, state.tracks[t].artifact));
    tracks[t] = s;
    raw[t] = s.score.scaled;
  }
  const cohort = [...demoCohort("ailx-2026.1-demo-cohort", 44), raw];
  const r = scoreCohort(cohort);
  const i = cohort.length - 1;
  // T3 fixture pauses for 120 s; active time must exclude it.
  const t3 = state.tracks.t3;
  // t3 fixture: 6×30 s of events + 10 s to pause + 20 s after resume = 210 s active; 120 s paused excluded.
  const pausedMsAccounted = t3.activeMs === 210_000;
  return {
    tracks,
    composite: r.composite[i],
    band: r.band[i],
    pausedMsAccounted,
    attemptId: state.attemptId,
  };
}

// keep append imported for parity with fixture builder type checking
void append;
