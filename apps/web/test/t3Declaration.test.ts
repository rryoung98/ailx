/**
 * The released T3 form and the instrument's declaration of it must agree
 * (TEN-73). `config.seeded_errors.count_per_form` in t3's `track.yaml` said 4
 * while `T3_SCENARIO` planted 8, so every sitting raised
 * `errorCatchRate.underpowered` and nothing failed. The exam service refuses
 * such a package at load; a number that only fails in the other repo is a
 * number this repo can break freely, so the guard is asserted here too.
 *
 * The number is 8 because the plant count IS the item count of a component
 * carrying 50 of T3's 160 points: `ERROR_CATCH_MIN_SURFACED` is the scorer's
 * declared floor and the form may not sit under its own floor.
 */
import { ERROR_CATCH_MIN_SURFACED } from "@ailx/track-t3";
import { afterEach, describe, expect, it } from "vitest";
import {
  SNAPSHOT,
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

/** Plant id prefix per declared error kind, so "two of each" is checkable. */
const KIND_PREFIX: Record<string, string> = {
  "misattributed-figure": "pe-figure",
  "false-causal-claim": "pe-causal",
  "fabricated-citation": "pe-citation",
  "wrong-calculation": "pe-arithmetic",
};

describe("T3 planted-error declaration", () => {
  it("declares 8, which is the scorer's floor and what the form plants", () => {
    expect(t3DeclaredPlantCount()).toBe(8);
    expect(ERROR_CATCH_MIN_SURFACED).toBe(8);
    expect(T3_SCENARIO.plantedErrors).toHaveLength(t3DeclaredPlantCount());
    expect(t3DeclaredPlantCount()).toBeGreaterThanOrEqual(ERROR_CATCH_MIN_SURFACED);
  });

  it("plants two instances of each declared kind, and no unplanted kind", () => {
    const kinds = seeded().kinds ?? [];
    expect(kinds).toHaveLength(4);
    const ids = T3_SCENARIO.plantedErrors.map((e) => e.id);
    for (const kind of kinds) {
      const prefix = KIND_PREFIX[kind];
      expect(prefix, `no plants for declared kind ${kind}`).toBeDefined();
      expect(ids.filter((id) => id === prefix || id.startsWith(`${prefix}-`))).toHaveLength(2);
    }
    // Every plant belongs to a declared kind — no family the yaml never named.
    const prefixes = kinds.map((k) => KIND_PREFIX[k]);
    for (const id of ids) {
      expect(prefixes.some((p) => id === p || id.startsWith(`${p}-`)), id).toBe(true);
    }
  });

  it("ids are unique — a duplicated plant is not a plant", () => {
    const ids = T3_SCENARIO.plantedErrors.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
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
    expect(SNAPSHOT.instrument.tracks).not.toHaveLength(0);
  });

  it("returns the scenario itself when the two agree", () => {
    expect(t3Scenario()).toBe(T3_SCENARIO);
    expect(trackConfig("t3")).toBe(T3_SCENARIO);
  });
});
