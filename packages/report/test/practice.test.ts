/**
 * The practice drill: its separation from the scored bank, its balance, and
 * its server-side grading.
 *
 * The first suite is the one that matters. The scored item bank is the
 * instrument; a practised item is a dead item, and there is no way to undo
 * the leak. So the separation is asserted HERE, at the content-selection
 * layer, against the real bank file on disk — not trusted to a convention.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runPure } from "@ailx/core";
import {
  ARTEFACT_FAMILIES,
  CLEAN_CHOICE,
  FAMILY_META,
  PRACTICE_BANK,
  PRACTICE_BANK_VERSION,
  PRACTICE_DECK_SIZE,
  PRACTICE_ID_PREFIX,
  PRACTICE_OPTIONS,
  SIGNAL_CHOICE,
  gradePractice,
  isPracticeItemId,
  practiceItem,
  samplePracticeDeck,
} from "../src/practice.js";

const BANK_PATH = new URL(
  "../../../instruments/2026.1/tracks/t2-discrimination/items/bank.jsonl",
  import.meta.url,
);

interface ScoredItem {
  id: string;
  material?: { kind?: string; text?: string };
  rationale?: string;
}

const scored: ScoredItem[] = readFileSync(BANK_PATH, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as ScoredItem);

/** Word-level fingerprint: catches a paraphrase, not just a byte-for-byte copy. */
function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 6),
  );
}

describe("practice never touches the scored item bank", () => {
  it("reads a non-trivial scored bank (guards against an empty-file pass)", () => {
    expect(scored.length).toBeGreaterThan(10);
  });

  it("the practice module imports no instrument content and reads no file", () => {
    const source = readFileSync(new URL("../src/practice.ts", import.meta.url), "utf8");
    // Comments may NAME the bank (they must, to explain the rule); code may not
    // reach it. Strip comments, then assert on what actually executes.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["@ailx/session"]);
    expect(code).not.toMatch(/instruments|bank\.jsonl|readFile|import\(|require\(/);
  });

  it("shares no item id with the scored bank", () => {
    const scoredIds = new Set(scored.map((i) => i.id));
    for (const item of PRACTICE_BANK) expect(scoredIds.has(item.id), item.id).toBe(false);
  });

  it("prefixes every practice id, and no scored id carries that prefix", () => {
    for (const item of PRACTICE_BANK) expect(item.id.startsWith(PRACTICE_ID_PREFIX)).toBe(true);
    for (const item of scored) expect(item.id.startsWith(PRACTICE_ID_PREFIX)).toBe(false);
  });

  it("shares no passage, and no near-duplicate passage, with scored material", () => {
    const scoredTexts = scored
      .map((i) => i.material?.text ?? "")
      .filter((t) => t.length > 0);
    expect(scoredTexts.length).toBeGreaterThan(0);
    const scoredFingerprints = scoredTexts.map(contentWords);
    for (const item of PRACTICE_BANK) {
      const words = contentWords(item.passage);
      for (const [i, fp] of scoredFingerprints.entries()) {
        const shared = [...words].filter((w) => fp.has(w));
        // A shared long word or two is English; a shared half is a copy.
        expect(shared.length / Math.max(1, words.size), `${item.id} vs scored #${i}`).toBeLessThan(0.5);
      }
    }
  });

  it("never leaks a scored rationale (the tells are written for practice only)", () => {
    const rationales = scored.map((i) => (i.rationale ?? "").trim()).filter((r) => r.length > 20);
    for (const item of PRACTICE_BANK) {
      for (const r of rationales) expect(item.tell).not.toContain(r);
    }
  });

  it("only ever deals ids that exist in the practice bank", () => {
    const practiceIds = new Set(PRACTICE_BANK.map((i) => i.id));
    for (let n = 0; n < 200; n++) {
      for (const id of samplePracticeDeck(`seed-${n}`)) expect(practiceIds.has(id)).toBe(true);
    }
  });

  it("resolves nothing for a scored bank id", () => {
    for (const item of scored.slice(0, 25)) {
      expect(practiceItem(item.id)).toBeNull();
      expect(isPracticeItemId(item.id)).toBe(false);
      expect(gradePractice(item.id, SIGNAL_CHOICE)).toBe(false);
      expect(gradePractice(item.id, CLEAN_CHOICE)).toBe(false);
    }
  });
});

describe("practice bank shape", () => {
  it("is well formed and uniquely identified", () => {
    const ids = new Set(PRACTICE_BANK.map((i) => i.id));
    expect(ids.size).toBe(PRACTICE_BANK.length);
    for (const item of PRACTICE_BANK) {
      expect(ARTEFACT_FAMILIES).toContain(item.family);
      expect(item.id).toBe(`${PRACTICE_ID_PREFIX}${item.family}:${item.id.split(":")[2]}`);
      expect(item.key === SIGNAL_CHOICE || item.key === CLEAN_CHOICE).toBe(true);
      expect(item.passage.length).toBeGreaterThan(40);
      expect(item.tell.length).toBeGreaterThan(40);
    }
  });

  it("gives every family enough class-balanced material for a deck", () => {
    for (const family of ARTEFACT_FAMILIES) {
      const pool = PRACTICE_BANK.filter((i) => i.family === family);
      const signal = pool.filter((i) => i.key === SIGNAL_CHOICE).length;
      expect(signal, family).toBeGreaterThanOrEqual(PRACTICE_DECK_SIZE / ARTEFACT_FAMILIES.length);
      expect(pool.length - signal, family).toBeGreaterThanOrEqual(
        PRACTICE_DECK_SIZE / ARTEFACT_FAMILIES.length,
      );
      expect(FAMILY_META[family].name.length).toBeGreaterThan(0);
    }
  });

  it("offers exactly two calls, signal first", () => {
    expect(PRACTICE_OPTIONS).toHaveLength(2);
    expect(SIGNAL_CHOICE).toBe(0);
    expect(CLEAN_CHOICE).toBe(1);
  });

  it("names a bank version so a content edit cannot masquerade as learning", () => {
    expect(PRACTICE_BANK_VERSION).toMatch(/^practice-/);
  });
});

describe("samplePracticeDeck", () => {
  it("is deterministic in its seed and varies across seeds", () => {
    expect(samplePracticeDeck("a")).toEqual(samplePracticeDeck("a"));
    const decks = new Set(Array.from({ length: 50 }, (_, i) => samplePracticeDeck(`s${i}`).join()));
    expect(decks.size).toBeGreaterThan(1);
  });

  it("deals a full, non-repeating, family- and class-balanced deck", () => {
    for (let n = 0; n < 100; n++) {
      const ids = samplePracticeDeck(`deck-${n}`);
      expect(ids).toHaveLength(PRACTICE_DECK_SIZE);
      expect(new Set(ids).size).toBe(ids.length);
      const items = ids.map((id) => practiceItem(id)!);
      for (const family of ARTEFACT_FAMILIES) {
        expect(items.filter((i) => i.family === family)).toHaveLength(
          PRACTICE_DECK_SIZE / ARTEFACT_FAMILIES.length,
        );
      }
      expect(items.filter((i) => i.key === SIGNAL_CHOICE)).toHaveLength(PRACTICE_DECK_SIZE / 2);
    }
  });

  it("uses the whole bank across many seeds (no dead content)", () => {
    const seen = new Set<string>();
    for (let n = 0; n < 300; n++) for (const id of samplePracticeDeck(`wide-${n}`)) seen.add(id);
    expect(seen.size).toBe(PRACTICE_BANK.length);
  });
});

describe("gradePractice is the only verdict", () => {
  it("grades every bank item both ways", () => {
    for (const item of PRACTICE_BANK) {
      expect(gradePractice(item.id, item.key)).toBe(true);
      expect(gradePractice(item.id, 1 - item.key)).toBe(false);
    }
  });

  it("refuses unknown ids and out-of-range choices without throwing", () => {
    expect(gradePractice("practice:physics:does-not-exist", 0)).toBe(false);
    expect(gradePractice("", 0)).toBe(false);
    expect(gradePractice(PRACTICE_BANK[0].id, -1)).toBe(false);
    expect(gradePractice(PRACTICE_BANK[0].id, 99)).toBe(false);
    expect(gradePractice(PRACTICE_BANK[0].id, Number.NaN)).toBe(false);
  });
});

describe("purity (FRONTEND.md §2.2)", () => {
  it("deals and grades where fetch, Date.now and Math.random throw", () => {
    runPure(() => {
      const ids = samplePracticeDeck("pure-seed");
      expect(ids).toHaveLength(PRACTICE_DECK_SIZE);
      expect(gradePractice(ids[0], practiceItem(ids[0])!.key)).toBe(true);
    });
  });
});
