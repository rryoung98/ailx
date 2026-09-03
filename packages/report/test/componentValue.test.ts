/**
 * A raw record is a stored wire surface. When a component key is renamed in
 * a scorer, an attempt scored before the rename still carries the old key,
 * and the report has to find it.
 *
 * T3's two reliance components are the exception, and TEN-72 made it on
 * purpose: they were renamed twice in three days (`rsr`/`rair` →
 * `overReliance`/`underReliance` in TEN-38 → `errorCatchRate`/
 * `adviceUptakeRate` here) and no sitting has been scored in production, so
 * there is no stored record to read and no alias to keep.
 */
import { describe, expect, it } from "vitest";
import { SCORE_ALLOCATION } from "@ailx/core";
import { componentKeys, componentValue, TRACK_META } from "../src/index.js";

describe("componentValue", () => {
  it("reads the current key", () => {
    const raw = { errorCatchRate: 50, adviceUptakeRate: 30 };
    expect(componentValue(raw, "errorCatchRate")).toBe(50);
    expect(componentValue(raw, "adviceUptakeRate")).toBe(30);
  });

  it("falls back to the pre-rename key of an older stored attempt", () => {
    expect(componentValue({ functional: 40 }, "gates")).toBe(40);
  });

  it("prefers the current key when a record somehow carries both", () => {
    expect(componentValue({ gates: 40, functional: 7 }, "gates")).toBe(40);
  });

  it("carries the four older alias entries unchanged", () => {
    // They are keyed by allocation keys that no longer exist, so the report
    // never asks for them. Pinned so that moving the table did not edit it.
    expect(componentValue({ functional: 40 }, "gates")).toBe(40);
    expect(componentValue({ sensitivity: 25 }, "dprime")).toBe(25);
    expect(componentValue({ "brief-fit": 24 }, "brief")).toBe(24);
    expect(componentValue({ craft: 12 }, "direction")).toBe(12);
    const declared = new Set(
      Object.values(SCORE_ALLOCATION).flatMap((t) => t.components.map((c) => c.key)),
    );
    for (const dead of ["gates", "dprime", "brief", "direction"]) {
      expect(declared.has(dead), dead).toBe(false);
    }
  });

  it("is 0 for a missing key, a missing record and an unscored track", () => {
    expect(componentValue(undefined, "errorCatchRate")).toBe(0);
    expect(componentValue({}, "errorCatchRate")).toBe(0);
    expect(componentValue({ process: 35 }, "errorCatchRate")).toBe(0);
  });

  it("treats a non-numeric stored value as absent", () => {
    for (const bad of ["50", null, {}, undefined]) {
      const raw = { errorCatchRate: bad } as Record<string, unknown>;
      expect(componentValue(raw, "errorCatchRate")).toBe(0);
    }
    // A JSON round trip turns NaN into null, so a corrupt current key still
    // lets an older spelling answer where one is declared.
    expect(componentValue({ gates: null, functional: 40 } as Record<string, unknown>, "gates")).toBe(40);
  });

  it("passes a stored NaN through, as the lookup it replaced did", () => {
    // Not a presentation fix. Changing it here would be a behaviour change
    // inside a rename.
    expect(componentValue({ gates: Number.NaN, functional: 40 }, "gates")).toBeNaN();
  });

  it("keeps 0 as a real value, not a miss", () => {
    expect(componentValue({ gates: 0, functional: 40 }, "gates")).toBe(0);
  });

  it("lists the current key first for every allocated component", () => {
    for (const meta of Object.values(TRACK_META)) {
      for (const c of meta.components) expect(componentKeys(c.key)[0]).toBe(c.key);
    }
  });

  it("gives T3's two reliance components no alias at all", () => {
    const declared = new Set(
      Object.values(SCORE_ALLOCATION).flatMap((t) => t.components.map((c) => c.key)),
    );
    for (const key of ["errorCatchRate", "adviceUptakeRate"] as const) {
      expect(declared.has(key), key).toBe(true);
      expect(componentKeys(key)).toEqual([key]);
    }
    // The dead spellings resolve to nothing, so the report cannot print one.
    for (const dead of ["rsr", "rair", "overReliance", "underReliance"]) {
      expect(componentValue({ [dead]: 50 }, "errorCatchRate"), dead).toBe(0);
    }
  });
});
