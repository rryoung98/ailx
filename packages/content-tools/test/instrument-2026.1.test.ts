/**
 * CI gate: the committed instrument package must load, validate, and be
 * byte-consistent — item ids, bank.sha256, rubric versions, snapshot.json.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadInstrument } from "../src/loader.js";
import { hashBank } from "../src/bank.js";
import { buildSnapshot } from "../src/snapshot.js";

const DIR = fileURLToPath(new URL("../../../instruments/2026.1", import.meta.url));
const pkg = loadInstrument(DIR);

describe("instrument 2026.1 loads and validates", () => {
  it("has the four tracks in order", () => {
    expect(pkg.tracks.map((t) => t.trackId)).toEqual([
      "t1-creative-build", "t2-discrimination", "t3-reasoning", "t4-generative",
    ]);
  });
  it("covers en/ja/ko", () => {
    expect(pkg.manifest.locales).toEqual(["en", "ja", "ko"]);
  });
  it("every rubric totals 100 points", () => {
    for (const t of pkg.tracks) {
      expect(t.rubric.total_points).toBe(100);
      expect(t.rubric.criteria.reduce((s, c) => s + c.points, 0)).toBe(100);
    }
  });
  it("score allocations match the spec section tables", () => {
    const pts = (id: string) =>
      Object.fromEntries(pkg.tracks.find((t) => t.trackId === id)!.rubric.criteria.map((c) => [c.id, c.points]));
    expect(pts("t1-creative-build")).toEqual({
      "functional-gates": 30, "comparative-merit": 40, "technical-ambition": 20, "design-rationale": 10,
    });
    expect(pts("t2-discrimination")).toEqual({
      sensitivity: 60, calibration: 25, "provenance-reasoning": 15,
    });
    expect(pts("t3-reasoning")).toEqual({
      "planted-error-detection": 25, "analysis-quality": 45, "process-quality": 20, "appropriate-reliance": 10,
    });
    expect(pts("t4-generative")).toEqual({
      "brief-compliance": 30, "comparative-merit": 40, "direction-craft": 20, "provenance-disclosure": 10,
    });
  });
  it("judged tracks carry screening prompts in all three locales", () => {
    for (const id of ["t1-creative-build", "t3-reasoning", "t4-generative"]) {
      const t = pkg.tracks.find((x) => x.trackId === id)!;
      expect(t.prompts.map((p) => p.locale).sort()).toEqual(["en", "ja", "ko"]);
      const en = t.prompts.find((p) => p.locale === "en")!;
      expect(en.translationProvenance).toBe("source");
      for (const l of ["ja", "ko"] as const) {
        expect(t.prompts.find((p) => p.locale === l)!.translationProvenance).toBe("machine");
      }
    }
  });
  it("T2 has no judged criteria and no prompts (no model in the loop)", () => {
    const t2 = pkg.tracks.find((t) => t.trackId === "t2-discrimination")!;
    expect(t2.rubric.criteria.every((c) => !c.judged)).toBe(true);
    expect(t2.prompts).toHaveLength(0);
  });
  it("band anchors align with the §04 composite bands", () => {
    for (const t of pkg.tracks) {
      const byBand = Object.fromEntries(t.rubric.band_anchors.map((b) => [b.band, b.min_scaled]));
      expect(byBand).toEqual({ distinction: 70, merit: 61, pass: 50, participation: 0 });
    }
  });
});

describe("T2 demo bank", () => {
  const bank = pkg.tracks.find((t) => t.trackId === "t2-discrimination")!.bank!;
  it("holds at least 24 items", () => {
    expect(bank.items.length).toBeGreaterThanOrEqual(24);
  });
  it("spans all difficulty tiers and required item families", () => {
    const diffs = new Set(bank.items.map((i) => i.difficulty));
    expect([...diffs].sort()).toEqual(["easy", "hard", "medium"]);
    const types = new Set(bank.items.map((i) => i.type));
    for (const t of ["text-authenticity", "image-provenance", "message-hostility", "provenance-reasoning"]) {
      expect(types).toContain(t);
    }
  });
  it("includes ja and ko items alongside en", () => {
    const locales = new Set(bank.items.map((i) => i.locale));
    expect(locales).toContain("en");
    expect(locales).toContain("ja");
    expect(locales).toContain("ko");
  });
  it("ja and ko decks are playable: >= 8 items each, spanning binary + provenance families", () => {
    for (const locale of ["ja", "ko"] as const) {
      const items = bank.items.filter((i) => i.locale === locale);
      expect(items.length, `${locale} bank too thin`).toBeGreaterThanOrEqual(8);
      const types = new Set(items.map((i) => i.type));
      for (const t of ["text-authenticity", "image-provenance", "message-hostility", "provenance-reasoning"]) {
        expect(types, `${locale} missing ${t}`).toContain(t);
      }
      // Balanced real-vs-AI media block so d' stays measurable per locale.
      const media = items.filter((i) => i.type === "image-provenance");
      expect(media.filter((i) => i.key === "ai").length).toBe(media.filter((i) => i.key === "real").length);
      expect(media.filter((i) => i.key === "ai").length).toBeGreaterThanOrEqual(3);
    }
  });
  it("translated ja/ko items link their en source item in provenance", () => {
    const ids = new Set(bank.items.map((i) => i.id));
    for (const i of bank.items.filter((x) => x.locale !== "en")) {
      const p = i.provenance as { source_item?: string; translation_provenance?: string };
      if (p.source_item !== undefined) {
        expect(ids, `${i.id} source_item ${p.source_item} not in bank`).toContain(p.source_item);
        const src = bank.items.find((x) => x.id === p.source_item)!;
        expect(src.locale).toBe("en");
        expect(src.type).toBe(i.type);
        expect(src.key).toBe(i.key);
      }
    }
  });
  it("items are self-contained (media inline or bundled repo-local assets)", () => {
    for (const item of bank.items) {
      const m = item.material as { kind?: string; data_uri?: string; src?: string };
      // The mock hand-drawn SVG scenes are retired: real Commons media only.
      expect(m.kind).not.toBe("svg");
      if (m.kind === "image") {
        // Bundled static asset: relative path under apps/web/public, never a
        // remote URL (network fetches at exam time would break containment).
        expect(m.src).toMatch(/^t2-media\/[0-9a-f]{12}\.jpg$/);
        continue;
      }
      // No externally fetched media fields anywhere in material.
      expect(JSON.stringify(item.material)).not.toMatch(/"(src|href|image_url|media_url)"/);
    }
  });
  it("bank verifies as canonical without rewrites (CI gate)", () => {
    const r = hashBank(join(DIR, "tracks/t2-discrimination/items/bank.jsonl"), false);
    expect(r.changed).toBe(false);
    expect(r.rewrittenIds).toBe(0);
    expect(r.sha256).toBe(bank.sha256);
  });
});

describe("snapshot.json consistency (CI gate)", () => {
  it("committed snapshot matches a fresh build byte-for-byte", () => {
    const committed = readFileSync(join(DIR, "snapshot.json"), "utf8");
    const fresh = JSON.stringify(buildSnapshot(DIR), null, 2) + "\n";
    expect(committed).toBe(fresh);
  });
  it("rubric versions are stable hex digests distinct per track", () => {
    const versions = pkg.tracks.map((t) => t.rubricVersion);
    for (const v of versions) expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
