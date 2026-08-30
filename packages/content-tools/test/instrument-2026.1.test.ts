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
const DEMO_DIR = fileURLToPath(new URL("../../../instruments/demo-2026.1", import.meta.url));
const TRACKS = fileURLToPath(new URL("../../tracks", import.meta.url));
const pkg = loadInstrument(DIR);
const demoPkg = loadInstrument(DEMO_DIR);
const t2BankOf = (p: typeof pkg) => p.tracks.find((t) => t.trackId === "t2-discrimination")!.bank!;
/**
 * The 104 authored T2 items live in TWO packages since the released-practice
 * split (docs/ARCHITECTURE.md §10 step 1): 84 operational here, 20 published
 * in instruments/demo-2026.1. Corpus-wide invariants (asset coverage,
 * translation back-links) hold over the UNION, not over either half.
 */
const AUTHORED_ITEMS = [...t2BankOf(pkg).items, ...t2BankOf(demoPkg).items];

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
      // >= 2 per side, not 3: the released-practice split moved ONE matched
      // ja/ko pair per locale into instruments/demo-2026.1. A pair per side
      // is what sampleT2DeckIds needs to still deal a 6-item deck, and the
      // deck-size assertion below is the invariant that actually matters.
      expect(media.filter((i) => i.key === "ai").length).toBeGreaterThanOrEqual(2);
    }
  });
  it("translated ja/ko items link their en source item in provenance", () => {
    // Resolved against the whole authored corpus: a ja/ko item may descend
    // from an en item that now sits in the released-practice tier.
    const ids = new Set(AUTHORED_ITEMS.map((i) => i.id));
    for (const i of AUTHORED_ITEMS.filter((x) => x.locale !== "en")) {
      const p = i.provenance as { source_item?: string; translation_provenance?: string };
      if (p.source_item !== undefined) {
        expect(ids, `${i.id} source_item ${p.source_item} not in bank`).toContain(p.source_item);
        const src = AUTHORED_ITEMS.find((x) => x.id === p.source_item)!;
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
    const fresh = JSON.stringify(buildSnapshot(DIR, { tracksRoot: TRACKS }), null, 2) + "\n";
    expect(committed).toBe(fresh);
  });
  it("rubric versions are stable hex digests distinct per track", () => {
    const versions = pkg.tracks.map((t) => t.rubricVersion);
    for (const v of versions) expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(versions).size).toBe(versions.length);
  });
});

/**
 * The public released-practice tier (docs/ARCHITECTURE.md §2.2, §10 step 1):
 * a drop-in snapshot for the static build that carries NO operational item.
 */
describe("instruments/demo-2026.1 — released-practice tier", () => {
  const demoBank = t2BankOf(demoPkg);
  const opBank = t2BankOf(pkg);

  it("is honestly labelled as a public practice tier, not the exam", () => {
    expect(demoPkg.manifest.id).toBe("ailx-demo-practice");
    expect(demoPkg.manifest.version).toBe("demo-2026.1");
    expect(demoPkg.manifest.notice).toMatch(/no score of record/i);
    expect(pkg.manifest.id).toBe("ailx");
  });

  it("partitions the authored corpus: 20 released + 84 operational, disjoint", () => {
    expect(demoBank.items).toHaveLength(20);
    expect(opBank.items).toHaveLength(84);
    const op = new Set(opBank.items.map((i) => i.id));
    for (const i of demoBank.items) {
      expect(op, `released item ${i.id} still in the operational bank`).not.toContain(i.id);
    }
    expect(new Set(AUTHORED_ITEMS.map((i) => i.id)).size).toBe(104);
  });

  it("released counts per locale match the documented partition", () => {
    const n = (locale: string, type: string) =>
      demoBank.items.filter((i) => i.locale === locale && i.type === type).length;
    expect({
      en: [n("en", "image-provenance"), n("en", "text-authenticity"), n("en", "message-hostility"), n("en", "provenance-reasoning")],
      ja: [n("ja", "image-provenance"), n("ja", "text-authenticity"), n("ja", "message-hostility"), n("ja", "provenance-reasoning")],
      ko: [n("ko", "image-provenance"), n("ko", "text-authenticity"), n("ko", "message-hostility"), n("ko", "provenance-reasoning")],
    }).toEqual({ en: [4, 2, 2, 2], ja: [2, 1, 1, 1], ko: [2, 1, 1, 1] });
    // Every locale's binary blocks stay class-balanced so d' is measurable.
    for (const locale of ["en", "ja", "ko"] as const) {
      const media = demoBank.items.filter((i) => i.locale === locale && i.type === "image-provenance");
      expect(media.filter((i) => i.key === "ai").length).toBe(media.filter((i) => i.key === "real").length);
      const text = demoBank.items.filter(
        (i) => i.locale === locale && (i.type === "text-authenticity" || i.type === "message-hostility"),
      );
      const signal = new Set(["ai", "synthetic", "hostile"]);
      expect(text.filter((i) => signal.has(i.key)).length, `${locale} has no signal text item`).toBeGreaterThanOrEqual(1);
      expect(text.filter((i) => !signal.has(i.key)).length, `${locale} has no benign text item`).toBeGreaterThanOrEqual(1);
    }
  });

  it("bank verifies as canonical without rewrites (CI gate)", () => {
    const r = hashBank(join(DEMO_DIR, "tracks/t2-discrimination/items/bank.jsonl"), false);
    expect(r.changed).toBe(false);
    expect(r.rewrittenIds).toBe(0);
    expect(r.sha256).toBe(demoBank.sha256);
  });

  it("committed demo snapshot matches a fresh build byte-for-byte", () => {
    const committed = readFileSync(join(DEMO_DIR, "snapshot.json"), "utf8");
    const fresh = JSON.stringify(buildSnapshot(DEMO_DIR, { tracksRoot: TRACKS, public: true }), null, 2) + "\n";
    expect(committed).toBe(fresh);
  });

  it("carries NO item provenance — a public snapshot names no generation record", () => {
    // `provenance.source_item` on a translated ja/ko item names the
    // OPERATIONAL item it derives from. Shipping it lets a candidate enumerate
    // a bank they must not be able to enumerate, and it is the leak
    // apps/web/test/bundleSecrecy.test.ts caught after the tier split.
    const demo = buildSnapshot(DEMO_DIR, { tracksRoot: TRACKS, public: true });
    const bankItems = demo.instrument.tracks.flatMap((t) => t.bank?.items ?? []);
    expect(bankItems.length).toBeGreaterThan(0);
    for (const item of bankItems) expect(item.provenance, item.id).toBeUndefined();
    expect(JSON.stringify(demo)).not.toContain("source_item");
  });

  it("keeps provenance when NOT built public — the operational snapshot is audit material", () => {
    const op = buildSnapshot(DIR, { tracksRoot: TRACKS });
    const bankItems = op.instrument.tracks.flatMap((t) => t.bank?.items ?? []);
    expect(bankItems.length).toBeGreaterThan(0);
    for (const item of bankItems) expect(item.provenance, item.id).toBeDefined();
  });

  it("is a DROP-IN snapshot: only the manifest and the t2 bank differ", () => {
    const a = buildSnapshot(DIR, { tracksRoot: TRACKS });
    const b = buildSnapshot(DEMO_DIR, { tracksRoot: TRACKS, public: true });
    expect(b.format).toBe(a.format);
    expect(b.scorers).toEqual(a.scorers);
    expect(b.instrument.tracks.map((t) => t.trackId)).toEqual(a.instrument.tracks.map((t) => t.trackId));
    for (const [i, tb] of b.instrument.tracks.entries()) {
      const ta = a.instrument.tracks[i];
      expect(tb.plugin).toBe(ta.plugin);
      expect(tb.config).toEqual(ta.config);          // incl. t2 blocks[].exposure_seconds
      expect(tb.rubricVersion).toBe(ta.rubricVersion); // rubric/prompt bytes are SHARED (symlinks)
      expect(tb.rubric).toEqual(ta.rubric);
      expect(tb.prompts).toEqual(ta.prompts);
    }
    // ...and the only content difference is the t2 bank.
    const strip = (s: typeof a) => ({
      ...s,
      instrument: {
        manifest: null,
        tracks: s.instrument.tracks.map((t) => ({ ...t, bank: t.bank ? "<bank>" : undefined })),
      },
    });
    expect(strip(b)).toEqual(strip(a));
  });
});
