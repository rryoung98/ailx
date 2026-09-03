/**
 * The withheld arm of the redacted item view — the type the browser had no
 * name for until TEN-68.
 */
import { describe, expect, it } from "vitest";
import { WITHHELD_REASONS, isWithheldItem } from "../src/items.js";

describe("isWithheldItem", () => {
  it("accepts the two arms the service can send", () => {
    for (const withheld of WITHHELD_REASONS) {
      expect(isWithheldItem({ phase: "withheld", id: "itm-1", withheld })).toBe(true);
    }
    expect(isWithheldItem({ phase: "withheld", id: "itm-1", withheld: "withdrawn", yourChoice: 0 })).toBe(
      true,
    );
  });

  it("refuses a PRESENTED item, which is the whole point of the discriminant", () => {
    expect(
      isWithheldItem({ phase: "review", id: "itm-1", stem: "s", options: ["a", "b"], key: 1 }),
    ).toBe(false);
    expect(isWithheldItem({ phase: "sitting", id: "itm-1" })).toBe(false);
  });

  it("refuses an entry we could not honestly show: no id, or a reason we cannot name", () => {
    expect(isWithheldItem({ phase: "withheld", withheld: "withdrawn" })).toBe(false);
    expect(isWithheldItem({ phase: "withheld", id: "", withheld: "withdrawn" })).toBe(false);
    expect(isWithheldItem({ phase: "withheld", id: "itm-1", withheld: "retired" })).toBe(false);
    expect(isWithheldItem({ phase: "withheld", id: "itm-1" })).toBe(false);
  });

  it("refuses a non-object", () => {
    for (const raw of [null, undefined, "withheld", 3, []]) {
      expect(isWithheldItem(raw)).toBe(false);
    }
  });
});
