/**
 * Diagnosis is a CANDIDATE-FACING derivation over aggregates, so it is tested
 * the same way the share payload is: exact shapes, an item-integrity check,
 * and an invariance check that proves the text cannot be a function of the
 * item bank.
 */
import { describe, expect, it } from "vitest";
import { TRACK_IDS, type TrackRawScores } from "@ailx/session";
import {
  DELIBERATE_ITERATION,
  DIAGNOSIS_BASIS,
  RUSHED_BUDGET_FRAC,
  diagnose,
} from "../src/diagnosis.js";
import { AXES, cohortMedians, playerType } from "../src/playerType.js";
import { TRACK_META } from "../src/tracks.js";
import type { ShareProcess } from "../src/share.js";

const shape = (v: number[]): TrackRawScores => ({ t1: v[0], t2: v[1], t3: v[2], t4: v[3] });

const med = cohortMedians();
/** Strong everywhere except T2, which is the case the user described. */
const T2_WEAK = shape([med.t1 + 20, med.t2 - 25, med.t3 + 10, med.t4 + 18]);
/** Ranking is by MARGIN over each track's own median, not by raw value. */
const ALL_HIGH = shape([med.t1 + 5, med.t2 + 5, med.t3 + 5, med.t4 + 5]);
const ALL_LOW = shape([med.t1 - 5, med.t2 - 9, med.t3 - 1, med.t4 - 7]);

const process = (over: Partial<ShareProcess> = {}): ShareProcess => ({
  totalActiveSeconds: 1200,
  tracks: TRACK_IDS.map((t) => ({
    track: t,
    activeSeconds: 300,
    budgetSeconds: 600,
    timedOut: false,
    iterationRatio: 0.8,
    verificationEvents: 2,
  })),
  ...over,
});

describe("diagnose", () => {
  it("names the weakest track first and the strongest as the strength", () => {
    const d = diagnose({ trackRaw: T2_WEAK });
    expect(d.weakest?.track).toBe("t2");
    expect(d.weakest?.level).toBe("watch");
    expect(d.strongest?.track).toBe("t1");
    expect(d.findings[0].track).toBe("t2");
    expect(d.findings.map((f) => f.level)).toEqual(["watch", "strength", "strength", "strength"]);
    expect(d.basis).toBe(DIAGNOSIS_BASIS);
  });

  it("summarizes honestly: what you do well, then what misses", () => {
    const d = diagnose({ trackRaw: T2_WEAK });
    const axisT1 = AXES.find((a) => a.track === "t1")!;
    const axisT2 = AXES.find((a) => a.track === "t2")!;
    expect(d.summary).toBe(`${axisT1.strength} ${axisT2.watchout}`);
  });

  it("orders watchouts weakest-first and strengths strongest-first", () => {
    const d = diagnose({ trackRaw: shape([med.t1 - 30, med.t2 - 3, med.t3 + 1, med.t4 + 30]) });
    expect(d.findings.map((f) => f.track)).toEqual(["t1", "t2", "t4", "t3"]);
  });

  it("points a T2 watchout at the practice drill that exists", () => {
    const d = diagnose({ trackRaw: T2_WEAK });
    const action = d.actions[0];
    expect(action.track).toBe("t2");
    expect(action.href).toBe("/practice");
    expect(action.drill).toBe(true);
    // The families the drill teaches are named, so the loop is legible.
    expect(action.detail).toContain("physics violation");
    expect(action.detail).toContain("sociocultural error");
  });

  it("gives every track an action, and never a dead end", () => {
    const d = diagnose({ trackRaw: ALL_LOW });
    expect(d.actions.map((a) => a.track).sort()).toEqual([...TRACK_IDS]);
    for (const a of d.actions) {
      expect(a.href.startsWith("/")).toBe(true);
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.detail.length).toBeGreaterThan(0);
    }
  });

  it("still offers the drill when nothing is below the median", () => {
    const d = diagnose({ trackRaw: ALL_HIGH });
    expect(d.weakest).toBeNull();
    expect(d.findings.every((f) => f.level === "strength")).toBe(true);
    expect(d.actions.map((a) => a.track)).toEqual(["t2"]);
    expect(d.summary).toContain("at or above this cohort's median");
  });

  it("reads a whole-run watchout summary when nothing is above the median", () => {
    const d = diagnose({ trackRaw: ALL_LOW });
    expect(d.strongest).toBeNull();
    expect(d.summary).toContain("Every track has room in it");
  });

  it("uses the product's own track names and codes (one vocabulary)", () => {
    for (const f of diagnose({ trackRaw: T2_WEAK }).findings) {
      expect(f.name).toBe(TRACK_META[f.track].name);
      expect(f.code).toBe(TRACK_META[f.track].code);
    }
  });

  it("rounds a track value to one decimal and never invents one", () => {
    const raw = shape([88.24, 79.55, 71.06, 66.9]);
    const values = Object.fromEntries(
      diagnose({ trackRaw: raw }).findings.map((f) => [f.track, f.value]),
    );
    expect(values).toEqual({ t1: 88.2, t2: 79.6, t3: 71.1, t4: 66.9 });
  });

  it("agrees with the player type: the same split, never a second opinion", () => {
    const p = playerType(T2_WEAK);
    const d = diagnose({ trackRaw: T2_WEAK });
    for (const pole of p.poles) {
      const finding = d.findings.find((f) => f.track === pole.track)!;
      expect(finding.level).toBe(pole.high ? "strength" : "watch");
    }
  });
});

describe("diagnose — process habits", () => {
  it("is empty when the candidate has no process data", () => {
    expect(diagnose({ trackRaw: T2_WEAK }).process).toEqual([]);
    expect(diagnose({ trackRaw: T2_WEAK, process: null }).process).toEqual([]);
  });

  it("credits verification and deliberate iteration", () => {
    const notes = diagnose({ trackRaw: T2_WEAK, process: process() }).process;
    expect(notes[0].headline).toBe("You check things");
    expect(notes[0].detail).toContain("8 verification action(s)");
    expect(notes[1].headline).toBe("Your iteration is deliberate");
  });

  it("names the absence of verification as the finding, not silence", () => {
    const p = process();
    p.tracks = p.tracks.map((t) => ({ ...t, verificationEvents: 0 }));
    const notes = diagnose({ trackRaw: T2_WEAK, process: p }).process;
    expect(notes[0].headline).toBe("No verification actions recorded");
  });

  it("calls first-answer acceptance below the deliberate-iteration line", () => {
    const p = process();
    p.tracks = p.tracks.map((t) => ({ ...t, iterationRatio: DELIBERATE_ITERATION - 0.01 }));
    expect(diagnose({ trackRaw: T2_WEAK, process: p }).process[1].headline).toBe(
      "You accept the first answer",
    );
  });

  it("skips the iteration note when nothing was ever prompted", () => {
    const p = process();
    p.tracks = p.tracks.map((t) => ({ ...t, iterationRatio: null }));
    const notes = diagnose({ trackRaw: T2_WEAK, process: p }).process;
    expect(notes.map((n) => n.headline)).toEqual(["You check things"]);
  });

  it("reports running out of clock, by track code", () => {
    const p = process();
    p.tracks = p.tracks.map((t) => ({ ...t, timedOut: t.track === "t3" }));
    const notes = diagnose({ trackRaw: T2_WEAK, process: p }).process;
    expect(notes[2].headline).toBe("You ran out of clock");
    expect(notes[2].detail).toContain("T3");
  });

  it("reports finishing early only when nothing timed out", () => {
    const p = process();
    p.tracks = p.tracks.map((t) => ({
      ...t,
      activeSeconds: Math.floor(t.budgetSeconds * RUSHED_BUDGET_FRAC) - 1,
    }));
    const notes = diagnose({ trackRaw: T2_WEAK, process: p }).process;
    expect(notes[2].headline).toBe("You finished early");
    // A timed-out track is never ALSO called rushed.
    p.tracks = p.tracks.map((t) => ({ ...t, timedOut: true }));
    expect(diagnose({ trackRaw: T2_WEAK, process: p }).process[2].headline).toBe(
      "You ran out of clock",
    );
  });

  it("says nothing about pace when the run used a normal share of its budget", () => {
    const notes = diagnose({ trackRaw: T2_WEAK, process: process() }).process;
    expect(notes.map((n) => n.headline)).not.toContain("You finished early");
    expect(notes.map((n) => n.headline)).not.toContain("You ran out of clock");
  });

  it("survives a zero budget without dividing by it", () => {
    const p = process();
    p.tracks = p.tracks.map((t) => ({ ...t, budgetSeconds: 0, activeSeconds: 0 }));
    expect(() => diagnose({ trackRaw: T2_WEAK, process: p })).not.toThrow();
    expect(diagnose({ trackRaw: T2_WEAK, process: p }).process.map((n) => n.headline)).not.toContain(
      "You finished early",
    );
  });
});

describe("diagnosis leaks nothing about the instrument", () => {
  it("has exactly the allowlisted keys — nothing rides along", () => {
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (typeof v !== "object" || v === null) return;
      for (const [k, child] of Object.entries(v)) {
        keys.add(k);
        walk(child);
      }
    };
    walk(diagnose({ trackRaw: T2_WEAK, process: process() }));
    expect([...keys].sort()).toEqual([
      "actions", "basis", "code", "detail", "drill", "findings", "headline", "href", "label",
      "level", "name", "process", "strongest", "summary", "track", "value", "weakest",
    ]);
  });

  it("carries no item-level, response-level or identity value", () => {
    // `basis` is excluded on purpose: it is the honesty sentence, and it
    // NAMES the things we refuse to report ("no percentile ...").
    const { basis: _basis, ...rest } = diagnose({ trackRaw: T2_WEAK, process: process() });
    const json = JSON.stringify(rest);
    for (const forbidden of [
      "itemId", "item_id", "answerKey", "deck", "bank", "confidence", "latency",
      "eventCount", "verbCounts", "attemptId", "participant", "authRef",
      "dPrime", "brier", "nSignal", "nNoise", "composite", "percentile", "judgments",
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
  });

  it("is INVARIANT to bank content: the same aggregates give the same text", () => {
    // Two runs whose per-item history is necessarily different (different
    // process totals) but whose track aggregates are equal produce identical
    // findings, actions and summary — the text cannot encode which items were
    // seen, because it never sees them.
    const a = diagnose({ trackRaw: T2_WEAK, process: process() });
    const b = diagnose({
      trackRaw: { ...T2_WEAK },
      process: process({ totalActiveSeconds: 4242 }),
    });
    expect(b.findings).toEqual(a.findings);
    expect(b.actions).toEqual(a.actions);
    expect(b.summary).toBe(a.summary);
  });

  it("draws every sentence from a fixed table, not from the run", () => {
    const fixed = new Set<string>([
      ...AXES.map((a) => a.strength),
      ...AXES.map((a) => a.watchout),
    ]);
    for (const f of diagnose({ trackRaw: T2_WEAK }).findings) {
      expect(fixed.has(f.headline), f.headline).toBe(true);
    }
  });
});
