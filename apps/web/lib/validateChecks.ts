/**
 * Validation checks — the "validate AILX quickly" page runs these in the
 * browser; apps/web vitest runs the same functions in node. Each check
 * returns PASS/FAIL plus evidence, never throws.
 */

// Deep import: the purity harness only (no node:crypto in the browser bundle).
import { runPure } from "@ailx/core/dist/purity.js";
import {
  append, canonicalJson, demoCohort, itemId, project, rubricVersionOf,
  scoreCohort, sha256Hex, TRACK_IDS,
  type TrackRawScores, type TrackScoreValue,
} from "@ailx/session";
import { demoScoreArtifact } from "./demo";
import GOLDEN from "./fixtures/composite-golden.json";
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
      const scored = runPure(() => scoreCohort(GOLDEN.cohort as TrackRawScores[]));
      const demoScored = runPure(() => demoScoreArtifact("t3", { demo: true, trackId: "t3", response: "x", interactions: ["prompted"] }));
      let impureTrapped = false;
      try {
        runPure(() => Math.random());
      } catch {
        impureTrapped = true;
      }
      return {
        pass: scored.composite.length === GOLDEN.cohort.length && demoScored.scaled > 0 && impureTrapped,
        detail: `composite + demo scorer both run clean under the harness; an impure score (Math.random) is trapped: ${impureTrapped}`,
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

    run("sample-attempt", "End-to-end sample attempt", "§04 — session log → track scores → composite → band", () => {
      const result1 = scoreSampleAttempt();
      const result2 = scoreSampleAttempt();
      const identical = JSON.stringify(result1) === JSON.stringify(result2);
      const inBounds = result1.composite >= 0 && result1.composite <= 100 &&
        TRACK_IDS.every((t) => result1.tracks[t].scaled >= 0 && result1.tracks[t].scaled <= 100);
      return {
        pass: identical && inBounds && result1.pausedMsAccounted,
        detail: `fixture attempt scores ${TRACK_IDS.map((t) => `${t}:${result1.tracks[t].scaled}`).join(" ")} → composite ${result1.composite} (${result1.band}); replay-deterministic: ${identical}; pause excluded from active time: ${result1.pausedMsAccounted}`,
      };
    }),
  ];
}

function scoreSampleAttempt() {
  const log = buildSampleAttemptLog();
  const state = project(log);
  const tracks = {} as Record<(typeof TRACK_IDS)[number], TrackScoreValue>;
  const raw = {} as TrackRawScores;
  for (const t of TRACK_IDS) {
    const s = runPure(() => demoScoreArtifact(t, state.tracks[t].artifact));
    tracks[t] = s;
    raw[t] = s.scaled;
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
