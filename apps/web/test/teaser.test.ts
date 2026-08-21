/**
 * Regression gate: the landing teaser uses REAL items from the committed
 * instrument snapshot — not separate toy content (review follow-up).
 */
import { describe, it, expect } from "vitest";
import { TEASER_ITEMS, TEASER_BANK_IDS } from "../lib/demoItems";
import { snapshotTrack } from "../lib/instrument";

describe("landing teaser uses real snapshot items", () => {
  const bank = snapshotTrack("t2").bank!;
  const byId = new Map(bank.items.map((i) => [i.id, i]));

  it("has exactly three items, all present in the snapshot bank", () => {
    expect(TEASER_ITEMS).toHaveLength(3);
    for (const t of TEASER_ITEMS) {
      expect(byId.has(t.id), `teaser id ${t.id} missing from bank`).toBe(true);
    }
    expect(TEASER_ITEMS.map((t) => t.id)).toEqual([...TEASER_BANK_IDS]);
  });

  it("covers one real-media photo item, one AI-vs-human text, one hostile message", () => {
    const kinds = TEASER_ITEMS.map((t) => t.kind).sort();
    expect(kinds).toEqual(["media", "message", "text"]);
    const types = TEASER_ITEMS.map((t) => byId.get(t.id)!.type).sort();
    expect(types).toEqual(["image-provenance", "message-hostility", "text-authenticity"]);
  });

  it("keys and tells are projections of the bank item, not invented", () => {
    for (const t of TEASER_ITEMS) {
      const raw = byId.get(t.id)!;
      const synthetic = ["ai", "hostile", "synthetic"].includes(raw.key);
      expect(t.key).toBe(synthetic ? "synthetic" : "authentic");
      expect(t.tell).toBe(raw.rationale);
    }
  });

  it("media item renders the bundled static asset", () => {
    const media = TEASER_ITEMS.find((t) => t.kind === "media")!;
    expect(media.imgSrc).toMatch(/\/t2-media\/[0-9a-f]{12}\.jpg$/);
  });
});
