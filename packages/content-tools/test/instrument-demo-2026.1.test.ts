/**
 * CI gate: the committed instrument package must load, validate, and be
 * byte-consistent — item ids, bank.sha256, rubric versions, snapshot.json.
 *
 * There is ONE instrument in this repository now: the public
 * released-practice tier. `instruments/2026.1` — 84 operational items, judge
 * prompts, rubric marking detail — lives in the private backend repo, and the
 * assertions that need those bytes (the 104-item partition, the operational
 * bank's canonicality, the ja/ko `source_item` back-links across the whole
 * authored corpus) went with it. What stays here is everything the released
 * tier can prove on its own, plus the `--public` contract itself, proved
 * against a SYNTHETIC unredacted instrument so it is still tested even though
 * no marking material exists in this tree to test it with.
 */
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadInstrument } from "../src/loader.js";
import { SCORE_ALLOCATION, trackPoints, type AllocatedTrackId } from "@ailx/core";

/** Short id (the allocation table's key) to package directory name. */
const ALLOCATED_TRACKS: ReadonlyArray<readonly [AllocatedTrackId, string]> = [
  ["t1", "t1-creative-build"],
  ["t2", "t2-discrimination"],
  ["t3", "t3-reasoning"],
  ["t4", "t4-generative"],
];
import { hashBank } from "../src/bank.js";
import { buildSnapshot } from "../src/snapshot.js";

const DIR = fileURLToPath(new URL("../../../instruments/demo-2026.1", import.meta.url));
const TRACKS = fileURLToPath(new URL("../../tracks", import.meta.url));
const pkg = loadInstrument(DIR);
const bank = pkg.tracks.find((t) => t.trackId === "t2-discrimination")!.bank!;

describe("the released-practice instrument loads and validates", () => {
  it("has the four tracks in order", () => {
    expect(pkg.tracks.map((t) => t.trackId)).toEqual([
      "t1-creative-build", "t2-discrimination", "t3-reasoning", "t4-generative",
    ]);
  });
  it("covers en/ja/ko", () => {
    expect(pkg.manifest.locales).toEqual(["en", "ja", "ko"]);
  });
  it("is honestly labelled as a public practice tier, not the exam", () => {
    expect(pkg.manifest.id).toBe("ailx-demo-practice");
    expect(pkg.manifest.version).toBe("demo-2026.1");
    expect(pkg.manifest.notice).toMatch(/no score of record/i);
    expect(pkg.manifest.redacted).toBe(true);
  });
  it("every rubric's declared total is the sum of its criteria", () => {
    for (const t of pkg.tracks) {
      expect(t.rubric.criteria.reduce((s, c) => s + c.points, 0), t.trackId)
        .toBe(t.rubric.total_points);
    }
  });

  /**
   * The published allocation survives redaction — that is the half of a
   * rubric a candidate is entitled to know (spec §14). It is checked against
   * `SCORE_ALLOCATION`, the table score() itself reads, rather than against a
   * typed copy: a copy is how the rubric and the scorer came to disagree in
   * the first place.
   */
  it("publishes exactly the allocation score() uses", () => {
    expect(ALLOCATED_TRACKS.length).toBe(4);
    for (const [short, long] of ALLOCATED_TRACKS) {
      const alloc = SCORE_ALLOCATION[short];
      const rubric = pkg.tracks.find((t) => t.trackId === long)!.rubric;
      const sort = (rows: [string, number][]) =>
        rows.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
      expect(
        sort(rubric.criteria.map((c) => [c.id, c.points] as [string, number])),
        long,
      ).toEqual(sort(alloc.components.map((c) => [c.rubricId, c.points] as [string, number])));
      expect(rubric.total_points, long).toBe(trackPoints(short));
    }
  });

  it("marks a criterion judged exactly when its points route to an LLM jury", () => {
    for (const [short, long] of ALLOCATED_TRACKS) {
      const alloc = SCORE_ALLOCATION[short];
      const rubric = pkg.tracks.find((t) => t.trackId === long)!.rubric;
      for (const c of alloc.components) {
        const published = rubric.criteria.find((r) => r.id === c.rubricId)!;
        expect(published.judged, `${long} ${c.rubricId}`).toBe(
          c.resolvedBy === "llm-judge",
        );
      }
    }
  });
  it("carries no judge prompt and no marking detail, in any track", () => {
    for (const t of pkg.tracks) {
      expect(t.prompts, t.trackId).toEqual([]);
      expect(t.rubric.band_anchors, t.trackId).toBeUndefined();
      for (const c of t.rubric.criteria) expect(c.description, `${t.trackId} ${c.id}`).toBeUndefined();
    }
    // ...and it still has judged criteria. A redacted tier keeps the fact that
    // a criterion is judged; it withholds how.
    expect(pkg.tracks.flatMap((t) => t.rubric.criteria).filter((c) => c.judged).length).toBeGreaterThan(0);
  });
  it("T2 has no judged criteria (no model in the loop)", () => {
    const t2 = pkg.tracks.find((t) => t.trackId === "t2-discrimination")!;
    expect(t2.rubric.criteria.every((c) => !c.judged)).toBe(true);
  });
});

describe("T2 released bank", () => {
  it("holds the twenty released items", () => {
    expect(bank.items).toHaveLength(20);
  });
  it("spans the required item families", () => {
    const types = new Set(bank.items.map((i) => i.type));
    for (const t of ["text-authenticity", "image-provenance", "message-hostility", "provenance-reasoning"]) {
      expect(types).toContain(t);
    }
  });
  it("released counts per locale match the documented partition", () => {
    const n = (locale: string, type: string) =>
      bank.items.filter((i) => i.locale === locale && i.type === type).length;
    expect({
      en: [n("en", "image-provenance"), n("en", "text-authenticity"), n("en", "message-hostility"), n("en", "provenance-reasoning")],
      ja: [n("ja", "image-provenance"), n("ja", "text-authenticity"), n("ja", "message-hostility"), n("ja", "provenance-reasoning")],
      ko: [n("ko", "image-provenance"), n("ko", "text-authenticity"), n("ko", "message-hostility"), n("ko", "provenance-reasoning")],
    }).toEqual({ en: [4, 2, 2, 2], ja: [2, 1, 1, 1], ko: [2, 1, 1, 1] });
    // Every locale's binary blocks stay class-balanced so d' is measurable.
    for (const locale of ["en", "ja", "ko"] as const) {
      const media = bank.items.filter((i) => i.locale === locale && i.type === "image-provenance");
      expect(media.filter((i) => i.key === "ai").length).toBe(media.filter((i) => i.key === "real").length);
      const text = bank.items.filter(
        (i) => i.locale === locale && (i.type === "text-authenticity" || i.type === "message-hostility"),
      );
      const signal = new Set(["ai", "synthetic", "hostile"]);
      expect(text.filter((i) => signal.has(i.key)).length, `${locale} has no signal text item`).toBeGreaterThanOrEqual(1);
      expect(text.filter((i) => !signal.has(i.key)).length, `${locale} has no benign text item`).toBeGreaterThanOrEqual(1);
    }
  });
  it("items are self-contained (media inline or bundled repo-local assets)", () => {
    for (const item of bank.items) {
      const m = item.material as { kind?: string; data_uri?: string; src?: string };
      expect(m.kind).not.toBe("svg");
      if (m.kind === "image") {
        expect(m.src).toMatch(/^t2-media\/[0-9a-f]{12}\.jpg$/);
        continue;
      }
      expect(JSON.stringify(item.material)).not.toMatch(/"(src|href|image_url|media_url)"/);
    }
  });
  /**
   * TEN-48. `track.yaml` states how many items each block holds, and the
   * bank is beside it. Before this the file declared a 132-item form of six
   * blocks and the released bank held 20 in four, and nothing compared the
   * two. The private service refuses a snapshot whose declaration its bank
   * does not meet (`assertBankAgreesWithSnapshot`); this is the same check
   * on the tier this repo owns, where the file is edited.
   */
  it("declares the block counts its bank actually holds", () => {
    // Bank item type to declared block id. The same map as
    // apps/web/lib/instrument.ts TYPE_MAP; content-tools must not import the
    // web app, so it is restated with this comment rather than shared.
    const BLOCK_OF: Record<string, string> = {
      "text-authenticity": "message-page",
      "image-provenance": "media-image",
      "message-hostility": "message-email",
      "provenance-reasoning": "provenance",
    };
    const held = new Map<string, number>();
    for (const i of bank.items) {
      const block = BLOCK_OF[i.type] ?? "provenance";
      held.set(block, (held.get(block) ?? 0) + 1);
    }
    const t2 = pkg.tracks.find((t) => t.trackId === "t2-discrimination")!;
    const blocks = t2.config.blocks as Array<{ id: string; bank_items: number }>;
    let declaredTotal = 0;
    for (const b of blocks) {
      expect(Number.isInteger(b.bank_items), `${b.id} declares no integer bank_items`).toBe(true);
      expect(held.get(b.id) ?? 0, b.id).toBe(b.bank_items);
      declaredTotal += b.bank_items;
    }
    // The other direction: a block the bank fills but nobody declared.
    for (const id of held.keys()) expect(blocks.map((b) => b.id), id).toContain(id);
    expect(declaredTotal).toBe(bank.items.length);
  });

  it("declares what one sitting is dealt", () => {
    const t2 = pkg.tracks.find((t) => t.trackId === "t2-discrimination")!;
    // The sampler reads these numbers (@ailx/track-t2 sampleT2DeckIds); the
    // released tier deals one media pair, two text items, two provenance.
    expect(t2.config.deck).toEqual({ media_pairs: 1, text: 2, provenance: 2 });
  });

  it("bank verifies as canonical without rewrites (CI gate)", () => {
    const r = hashBank(join(DIR, "tracks/t2-discrimination/items/bank.jsonl"), false);
    expect(r.changed).toBe(false);
    expect(r.rewrittenIds).toBe(0);
    expect(r.sha256).toBe(bank.sha256);
  });
});

describe("snapshot.json consistency (CI gate)", () => {
  it("committed snapshot matches a fresh --public build byte-for-byte", () => {
    const committed = readFileSync(join(DIR, "snapshot.json"), "utf8");
    const fresh = JSON.stringify(buildSnapshot(DIR, { tracksRoot: TRACKS, public: true }), null, 2) + "\n";
    expect(committed).toBe(fresh);
  });
  it("rubric versions are stable hex digests distinct per track", () => {
    const versions = pkg.tracks.map((t) => t.rubricVersion);
    for (const v of versions) expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(versions).size).toBe(versions.length);
  });
  it("carries NO item provenance — a public snapshot names no generation record", () => {
    // `provenance.source_item` on a translated ja/ko item names the
    // OPERATIONAL item it derives from. Shipping it lets a candidate enumerate
    // a bank they must not be able to enumerate.
    const demo = buildSnapshot(DIR, { tracksRoot: TRACKS, public: true });
    const bankItems = demo.instrument.tracks.flatMap((t) => t.bank?.items ?? []);
    expect(bankItems.length).toBeGreaterThan(0);
    for (const item of bankItems) expect(item.provenance, item.id).toBeUndefined();
    expect(JSON.stringify(demo)).not.toContain("source_item");
  });
  it("still publishes the points allocation and a rubric version", () => {
    const demo = buildSnapshot(DIR, { tracksRoot: TRACKS, public: true });
    for (const track of demo.instrument.tracks) {
      expect(track.prompts, track.trackId).toEqual([]);
      expect(track.rubric.band_anchors, track.trackId).toBeUndefined();
      for (const c of track.rubric.criteria) {
        expect(c.description, `${track.trackId} ${c.id}`).toBeUndefined();
        expect(c.points, `${track.trackId} ${c.id}`).toBeGreaterThan(0);
        expect(c.name.length, `${track.trackId} ${c.id}`).toBeGreaterThan(0);
      }
      expect(track.rubricVersion, track.trackId).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

/**
 * The `--public` strip, proved against an instrument that HAS something to
 * strip. No such instrument is in this repo any more, so one is synthesised:
 * the released tier with its redaction undone — marking prose put back on
 * every criterion, band anchors restored, a judge prompt written for each
 * judged track. That is the shape the operational package has in the private
 * repo, and it is the shape `buildSnapshot(..., { public: true })` must reduce
 * to exactly what the committed snapshot above contains.
 */
describe("buildSnapshot --public reduces an unredacted instrument", () => {
  let dir: string;
  const MARKING = "how a judge is told to mark this criterion, at length";
  const ANCHOR = "what a distinction-grade submission looks like in prose";
  const PROMPT_BODY = "Judge the submission against the locked rubric traits.";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ailx-unredacted-"));
    cpSync(DIR, dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.yaml"),
      readFileSync(join(dir, "manifest.yaml"), "utf8").replace("redacted: true\n", ""),
    );
    for (const t of pkg.tracks) {
      const rubric = join(dir, "tracks", t.trackId, "rubric.yaml");
      writeFileSync(
        rubric,
        readFileSync(rubric, "utf8").replace(/^(    judged: (?:true|false))$/gm, `$1\n    description: ${MARKING}`) +
          ["band_anchors:",
            `  - { band: distinction, min_scaled: 70, anchor: ${ANCHOR} }`,
            "  - { band: merit, min_scaled: 61, anchor: x }",
            "  - { band: pass, min_scaled: 50, anchor: x }",
            "  - { band: participation, min_scaled: 0, anchor: x }",
            ""].join("\n"),
      );
      if (t.rubric.criteria.some((c) => c.judged)) {
        const prompts = join(dir, "tracks", t.trackId, "prompts");
        mkdirSync(prompts);
        for (const locale of ["en", "ja", "ko"]) {
          writeFileSync(
            join(prompts, `screening.${locale}.md`),
            `---\nlocale: ${locale}\ntranslation_provenance: ${locale === "en" ? "source" : "machine"}\n---\n${PROMPT_BODY}\n`,
          );
        }
      }
    }
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps prompts, marking detail and provenance when NOT public", () => {
    const op = buildSnapshot(dir, { tracksRoot: TRACKS });
    // The tracks that HAVE judged criteria — t2 is model-free by design and
    // t4 is an unscored showcase with no criteria at all.
    const judged = op.instrument.tracks.filter((t) =>
      t.rubric.criteria.some((c) => c.judged),
    );
    expect(judged.map((t) => t.trackId)).toEqual(["t1-creative-build", "t3-reasoning"]);
    for (const track of judged) {
      expect(track.prompts.length, track.trackId).toBe(3);
      expect(track.rubric.band_anchors?.length, track.trackId).toBe(4);
      for (const c of track.rubric.criteria) expect(c.description, `${track.trackId} ${c.id}`).toBe(MARKING);
    }
    const items = op.instrument.tracks.flatMap((t) => t.bank?.items ?? []);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.provenance, item.id).toBeDefined();
    // The material really is in there — otherwise the strip below proves nothing.
    const raw = JSON.stringify(op);
    for (const secret of [MARKING, ANCHOR, PROMPT_BODY]) expect(raw).toContain(secret);
  });

  it("drops every one of them when public, and nothing else", () => {
    const a = buildSnapshot(dir, { tracksRoot: TRACKS });
    const b = buildSnapshot(dir, { tracksRoot: TRACKS, public: true });
    const raw = JSON.stringify(b);
    for (const secret of [MARKING, ANCHOR, PROMPT_BODY]) expect(raw).not.toContain(secret);
    expect(raw).not.toContain("source_item");
    expect(b.format).toBe(a.format);
    expect(b.scorers).toEqual(a.scorers);
    for (const [i, tb] of b.instrument.tracks.entries()) {
      const ta = a.instrument.tracks[i];
      expect(tb.plugin).toBe(ta.plugin);
      expect(tb.config).toEqual(ta.config);            // incl. t2 blocks[].exposure_seconds
      expect(tb.rubricVersion).toBe(ta.rubricVersion); // computed on load, BEFORE the strip
      expect(tb.rubric.criteria).toEqual(
        ta.rubric.criteria.map(({ description: _marking, ...published }) => published),
      );
      expect(tb.rubric.total_points).toBe(ta.rubric.total_points);
      expect(tb.bank?.sha256).toBe(ta.bank?.sha256);
    }
  });
});
