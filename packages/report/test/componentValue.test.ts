/**
 * A raw record is a stored wire surface. When a component key is renamed in
 * a scorer, an attempt scored before the rename still carries the old key,
 * and the report has to find it. `rsr`/`rair` became
 * `overReliance`/`underReliance` on 2026-09-02 (TEN-38).
 */
import { describe, expect, it } from "vitest";
import { SCORE_ALLOCATION } from "@ailx/core";
import { componentKeys, componentValue, TRACK_META } from "../src/index.js";

describe("componentValue", () => {
  it("reads the current key", () => {
    expect(componentValue({ overReliance: 50, underReliance: 30 }, "overReliance")).toBe(50);
    expect(componentValue({ overReliance: 50, underReliance: 30 }, "underReliance")).toBe(30);
  });

  it("falls back to the pre-rename key of an older stored attempt", () => {
    const stored = { rsr: 50, rair: 30, "rsr.underpowered": 1 };
    expect(componentValue(stored, "overReliance")).toBe(50);
    expect(componentValue(stored, "underReliance")).toBe(30);
  });

  it("prefers the current key when a record somehow carries both", () => {
    expect(componentValue({ overReliance: 50, rsr: 7 }, "overReliance")).toBe(50);
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
    expect(componentValue(undefined, "overReliance")).toBe(0);
    expect(componentValue({}, "overReliance")).toBe(0);
    expect(componentValue({ process: 35 }, "overReliance")).toBe(0);
  });

  it("treats a non-numeric or non-finite stored value as absent", () => {
    // A corrupt record must print 0, never NaN.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "50", null, {}]) {
      expect(componentValue({ overReliance: bad } as Record<string, unknown>, "overReliance")).toBe(0);
    }
    // ...and an alias still answers when the current key is corrupt.
    expect(componentValue({ overReliance: Number.NaN, rsr: 50 }, "overReliance")).toBe(50);
  });

  it("keeps 0 as a real value, not a miss", () => {
    expect(componentValue({ overReliance: 0, rsr: 50 }, "overReliance")).toBe(0);
  });

  it("lists the current key first for every allocated component", () => {
    for (const meta of Object.values(TRACK_META)) {
      for (const c of meta.components) expect(componentKeys(c.key)[0]).toBe(c.key);
    }
  });

  it("aliases the two renamed T3 components, which the allocation declares", () => {
    const declared = new Set(
      Object.values(SCORE_ALLOCATION).flatMap((t) => t.components.map((c) => c.key)),
    );
    for (const [key, old] of [["overReliance", "rsr"], ["underReliance", "rair"]] as const) {
      expect(declared.has(key), key).toBe(true);
      expect(componentKeys(key)).toEqual([key, old]);
    }
  });
});
