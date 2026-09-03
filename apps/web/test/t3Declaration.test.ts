/**
 * The released T3 form and the instrument's DECLARATION of it must agree
 * (TEN-73). `config.seeded_errors.count_per_form` in t3's `track.yaml` said 4
 * while `T3_SCENARIO` plants 8, so every released sitting raised
 * `errorCatchRate.underpowered` and nothing failed. The exam service refuses
 * such a package at load; a number that only fails in the other repo is a
 * number this repo can break freely, so the link is asserted here too.
 *
 * The number is 8 because the plant count IS the item count of a component
 * carrying 50 of T3's 160 points: `ERROR_CATCH_MIN_SURFACED` is the scorer's
 * declared floor and a form may not sit under its own floor.
 *
 * The FORM's own shape — its ids, two instances per family, every plant
 * anchored in the source — is asserted in `wiring.test.ts` and not repeated
 * here. This file asserts only what the yaml and the form say about each
 * other, and what the prose says about both.
 */
import { TRACK_META } from "@ailx/report";
import { ERROR_CATCH_MIN_SURFACED } from "@ailx/track-t3";
import { afterEach, describe, expect, it } from "vitest";
import {
  T3_SCENARIO,
  snapshotTrack,
  t3DeclaredPlantCount,
  t3Scenario,
  trackConfig,
} from "../lib/instrument/instrument";

const seeded = () =>
  snapshotTrack("t3").config.seeded_errors as { count_per_form?: unknown; kinds?: string[] };

const DECLARED = seeded().count_per_form;

afterEach(() => {
  seeded().count_per_form = DECLARED;
});

describe("T3 planted-error declaration", () => {
  it("declares 8, which is the scorer's floor and what the form plants", () => {
    expect(t3DeclaredPlantCount()).toBe(8);
    expect(ERROR_CATCH_MIN_SURFACED).toBe(8);
    expect(T3_SCENARIO.plantedErrors).toHaveLength(t3DeclaredPlantCount());
    expect(t3DeclaredPlantCount()).toBeGreaterThanOrEqual(ERROR_CATCH_MIN_SURFACED);
  });

  it("declares one kind per pair of plants, and every kind the form uses", () => {
    // The yaml names four stable error FAMILIES and the form plants two
    // instances of each (wiring.test.ts pins the instances). The families are
    // what re-versions cheaply, so the two statements must not drift apart.
    // An id names its family by prefix and nothing machine-readable ties a
    // plant to a kind, so a MISLABELLED id is not caught here or anywhere.
    const kinds = seeded().kinds ?? [];
    expect(kinds).toEqual([
      "misattributed-figure", "false-causal-claim", "fabricated-citation", "wrong-calculation",
    ]);
    expect(t3DeclaredPlantCount()).toBe(2 * kinds.length);
    for (const [kind, prefix] of [
      ["misattributed-figure", "pe-figure"],
      ["false-causal-claim", "pe-causal"],
      ["fabricated-citation", "pe-citation"],
      ["wrong-calculation", "pe-arithmetic"],
    ] as const) {
      expect(kinds).toContain(kind);
      expect(
        T3_SCENARIO.plantedErrors.filter((e) => e.id.startsWith(prefix)),
        kind,
      ).toHaveLength(2);
    }
  });

  it("refuses a form that disagrees with the declaration, rather than flagging it", () => {
    seeded().count_per_form = 4;
    expect(() => t3Scenario()).toThrow(/plants 8 errors but the instrument declares 4/);
    expect(() => trackConfig("t3")).toThrow(/count_per_form/);
    seeded().count_per_form = 12;
    expect(() => trackConfig("t3")).toThrow(/plants 8 errors but the instrument declares 12/);
  });

  it("refuses a malformed or missing declaration rather than trusting the form", () => {
    for (const bad of [0, -1, 4.5, Number.NaN, "8", null, undefined]) {
      seeded().count_per_form = bad as never;
      expect(() => t3DeclaredPlantCount()).toThrow(/count_per_form/);
      expect(() => trackConfig("t3")).toThrow(/count_per_form/);
    }
    const track = snapshotTrack("t3");
    const all = track.config.seeded_errors;
    try {
      track.config.seeded_errors = undefined;
      expect(() => trackConfig("t3")).toThrow(/count_per_form/);
    } finally {
      track.config.seeded_errors = all;
    }
  });

  it("returns the scenario itself when the two agree", () => {
    expect(t3Scenario()).toBe(T3_SCENARIO);
    expect(trackConfig("t3")).toBe(T3_SCENARIO);
  });

  it("the candidate-facing prose names the number the instrument declares", () => {
    // @ailx/report's track metadata says "eight" in words, and prose cannot
    // read a yaml field. This is the link: change the declaration and this
    // fails until the sentence a candidate reads is changed with it.
    expect(t3DeclaredPlantCount()).toBe(8);
    expect(TRACK_META.t3.hype).toContain("eight errors");
  });
});
