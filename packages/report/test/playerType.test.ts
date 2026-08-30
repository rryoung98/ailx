import { describe, expect, it } from "vitest";
import { TRACK_IDS, type SessionState } from "@ailx/session";
import {
  AXES, cohortMedians, identitySignals, playerType, playerTypeFor,
} from "../src/playerType.js";

describe("player type (MBTI-style lens)", () => {
  it("all 16 codes resolve to distinct named types", () => {
    const seen = new Set<string>();
    for (let m = 0; m < 16; m++) {
      const med = cohortMedians();
      const raw = {
        t1: m & 8 ? med.t1 + 1 : med.t1 - 1,
        t2: m & 4 ? med.t2 + 1 : med.t2 - 1,
        t3: m & 2 ? med.t3 + 1 : med.t3 - 1,
        t4: m & 1 ? med.t4 + 1 : med.t4 - 1,
      };
      const p = playerType(raw);
      expect(p.name).toBeTruthy();
      seen.add(`${p.code}:${p.name}`);
      expect(p.strengths.length + p.watchouts.length).toBe(4);
    }
    expect(seen.size).toBe(16);
  });
  it("high on every track earns the four high letters", () => {
    const med = cohortMedians();
    const p = playerType({ t1: 100, t2: 100, t3: 100, t4: 100 });
    expect(p.code).toBe(AXES.map((a) => a.hi.letter).join(""));
    expect(p.strengths).toHaveLength(4);
    expect(med.t1).toBeGreaterThan(0);
  });
  it("is deterministic", () => {
    const raw = { t1: 40, t2: 60, t3: 20, t4: 70 };
    expect(playerType(raw)).toEqual(playerType(raw));
  });
});

describe("player type — signals and evidence", () => {
  /** A minimal scored session: four tracks, a T2 raw, and per-track events. */
  const session = (opts: {
    t1?: { prompted: number; revised: number };
    t2raw?: Record<string, number>;
    t3?: { verified: number; other?: number };
  } = {}): SessionState => {
    const ev = (verb: string, n: number, tag: string) =>
      Array.from({ length: n }, (_, i) => ({
        verb, object: `${tag}${i}`, clientTs: "2026-01-01T00:00:00.000Z",
      }));
    const track = (events: unknown[]) => ({
      status: "completed", activeMs: 60_000, events, score: { raw: {}, scaled: 50 },
    });
    return {
      phase: "completed",
      config: { instrument: "ailx", version: "2026.1", locale: "en", budgets: { t1: 600, t2: 300, t3: 600, t4: 480 } },
      order: TRACK_IDS,
      tracks: {
        t1: track([
          ...ev("prompted", opts.t1?.prompted ?? 0, "p"),
          ...ev("revised", opts.t1?.revised ?? 0, "r"),
        ]),
        t2: { ...track([]), score: { raw: opts.t2raw ?? {}, scaled: 50 } },
        t3: track([
          // Verification is attributed per claim (F5): unattributed
          // `verified` events are not checks of anything and do not count.
          ...ev("verified", opts.t3?.verified ?? 0, "claim:c"),
          ...ev("answered", opts.t3?.other ?? 0, "a"),
        ]),
        t4: track([]),
      },
      lastSeq: 1,
      lastTs: Date.UTC(2026, 1, 3),
    } as never;
  };
  const MED = cohortMedians();
  const AT_MEDIAN = { t1: MED.t1, t2: MED.t2, t3: MED.t3, t4: MED.t4 };

  it("every axis carries the measurement it was decided from", () => {
    const p = playerType(AT_MEDIAN);
    expect(p.poles).toHaveLength(4);
    for (const pole of p.poles) {
      expect(pole.evidence.length).toBeGreaterThan(0);
      expect(pole.strength).toBeGreaterThanOrEqual(50);
      expect(pole.strength).toBeLessThanOrEqual(100);
    }
    // With no signals the evidence names the score and the cohort median.
    expect(p.poles[0].evidence).toContain("cohort median");
  });

  it("the letter and the meter can never disagree", () => {
    for (const t1 of [0, 25, 50, 75, 100]) {
      const p = playerType({ ...AT_MEDIAN, t1 });
      const pole = p.poles[0]!;
      expect(pole.high).toBe(t1 >= MED.t1);
      expect(pole.letter).toBe(pole.high ? "M" : "P");
    }
  });

  it("T1 reads iteration, not the T1 score", () => {
    const low = { ...AT_MEDIAN, t1: 0 };
    // Score says Prompter; the log says the build was revised every prompt.
    const s = identitySignals(session({ t1: { prompted: 2, revised: 2 } }));
    expect(playerType(low, s).poles[0]!.letter).toBe("M");
    expect(playerType(low, s).poles[0]!.evidence).toContain("per prompt");
    // Prompted but never revised: the model's first answer stood.
    const oneShot = identitySignals(session({ t1: { prompted: 2, revised: 0 } }));
    expect(playerType({ ...AT_MEDIAN, t1: 100 }, oneShot).poles[0]!.letter).toBe("P");
  });

  it("T2 reads sensitivity d′, not the composite track score", () => {
    const s = identitySignals(session({ t2raw: { dPrime: 1.9, sensitivity: 55 } }));
    const p = playerType({ ...AT_MEDIAN, t2: 0 }, s);
    expect(p.poles[1]!.letter).toBe("S");
    expect(p.poles[1]!.evidence).toContain("d′ 1.90");
    // A run that scored well on calibration/provenance but saw nothing.
    const blind = identitySignals(session({ t2raw: { dPrime: 0.1, sensitivity: 3 } }));
    expect(playerType({ ...AT_MEDIAN, t2: 100 }, blind).poles[1]!.letter).toBe("T");
  });

  it("T3 reads verification events, not the T3 score", () => {
    const s = identitySignals(session({ t3: { verified: 3 } }));
    expect(playerType({ ...AT_MEDIAN, t3: 0 }, s).poles[2]!.letter).toBe("V");
    expect(playerType({ ...AT_MEDIAN, t3: 0 }, s).poles[2]!.evidence).toContain("3 verification events");
    // The track WAS played (it has events) and nothing was verified.
    const none = identitySignals(session({ t3: { verified: 0, other: 2 } }));
    expect(playerType({ ...AT_MEDIAN, t3: 100 }, none).poles[2]!.letter).toBe("A");
  });

  it("silence is no evidence: an empty log falls back to the scores", () => {
    const s = identitySignals(session());
    // T1 never prompted and T3 logged nothing, so neither emits a signal.
    expect(s.t1).toBeUndefined();
    expect(s.t3).toBeUndefined();
    expect(s.t2).toBeUndefined();       // no sensitivity in the raw
    const p = playerType({ t1: 100, t2: 100, t3: 100, t4: 100 }, s);
    expect(p.code).toBe(AXES.map((a) => a.hi.letter).join(""));
  });

  it("an invalid T2 score never decides the T2 axis", () => {
    const s = identitySignals(session({ t2raw: { invalid: 1, sensitivity: 0, dPrime: 0 } }));
    expect(s.t2).toBeUndefined();
  });

  it("T4 has no behavioural measure and always reads its score", () => {
    const s = identitySignals(session({ t1: { prompted: 4, revised: 4 }, t3: { verified: 9 } }));
    expect(s.t4).toBeUndefined();
    expect(playerType({ ...AT_MEDIAN, t4: 0 }, s).poles[3]!.letter).toBe("E");
    expect(playerType({ ...AT_MEDIAN, t4: 100 }, s).poles[3]!.letter).toBe("D");
  });

  it("every signalled code still resolves to a name and a tagline", () => {
    for (let m = 0; m < 16; m++) {
      const signals = {
        t1: { value: m & 8 ? 1 : 0, evidence: "t1" },
        t2: { value: m & 4 ? 1 : 0, evidence: "t2" },
        t3: { value: m & 2 ? 1 : 0, evidence: "t3" },
        t4: { value: m & 1 ? 1 : 0, evidence: "t4" },
      };
      const p = playerType(AT_MEDIAN, signals);
      expect(p.name).toBeTruthy();
      expect(p.tagline).toBeTruthy();
      expect(p.poles.map((x) => x.evidence)).toEqual(["t1", "t2", "t3", "t4"]);
      expect(p.poles.every((x) => x.strength === 100)).toBe(true);
    }
  });

  it("out-of-range and midpoint signals are handled, never thrown on", () => {
    const wild = { t1: { value: 9, evidence: "e" }, t2: { value: -3, evidence: "e" } };
    const p = playerType(AT_MEDIAN, wild);
    expect(p.poles[0]!.strength).toBe(100);
    expect(p.poles[1]!.letter).toBe("T");
    // Exactly 0.5 chooses the high pole, at minimum strength.
    const mid = playerType(AT_MEDIAN, { t3: { value: 0.5, evidence: "e" } });
    expect(mid.poles[2]!.letter).toBe("V");
    expect(mid.poles[2]!.strength).toBe(50);
  });

  it("playerTypeFor is the same call with the session's own signals", () => {
    const s = session({ t1: { prompted: 2, revised: 2 }, t3: { verified: 3 } });
    expect(playerTypeFor(s, AT_MEDIAN)).toEqual(playerType(AT_MEDIAN, identitySignals(s)));
  });

  it("is deterministic with signals too", () => {
    const s = session({ t1: { prompted: 3, revised: 1 }, t2raw: { dPrime: 1, sensitivity: 30 }, t3: { verified: 2 } });
    expect(playerTypeFor(s, AT_MEDIAN)).toEqual(playerTypeFor(s, AT_MEDIAN));
  });
});
