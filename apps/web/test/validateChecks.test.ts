import { describe, expect, it } from "vitest";
import { runAllChecks } from "../lib/instrument/validateChecks";

describe("/validate checks (same code the page runs in-browser)", () => {
  const results = runAllChecks();
  it("runs all eight checks", () => {
    expect(results.map((r) => r.id)).toEqual([
      "sha256", "content-addressing", "rubric-version", "purity",
      "plugin-golden", "golden", "reproducibility", "sample-attempt",
    ]);
  });
  for (const r of runAllChecks()) {
    it(`${r.id}: ${r.title} passes — ${r.detail.slice(0, 60)}`, () => {
      expect(r.pass, r.detail).toBe(true);
    });
  }
});
