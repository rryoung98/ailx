/**
 * The practice drill: its separation from the scored bank, its balance, and
 * its server-side grading.
 *
 * The first suite is the one that matters. The scored item bank is the
 * instrument; a practised item is a dead item, and there is no way to undo
 * the leak. So the separation is asserted HERE, at the content-selection
 * layer, against real bank files on disk — not trusted to a convention.
 *
 * WHERE EACH HALF LIVES NOW. The 84 OPERATIONAL items moved to the private
 * backend repo, which runs its own copy of this suite against them: id, text
 * and rationale disjointness are asserted there, over the bank that is the
 * exam. This copy asserts the two halves that only exist here:
 *
 *  - the same disjointness against the RELEASED tier (instruments/demo-2026.1)
 *    — published keys are still burnt items, and practice must not reuse one;
 *  - the IMAGE guarantee, by CONTENT HASH, against the WHOLE shipped
 *    `apps/web/public/t2-media` pool. That pool still serves both tiers, so
 *    hashing the directory rather than a bank's `src` list covers the
 *    operational deck's pictures too — a stronger check than the old one, and
 *    the only place in either repo where both sets of bytes exist.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runPure } from "@ailx/core";
import {
  ARTEFACT_FAMILIES,
  CLEAN_CHOICE,
  FAMILY_META,
  PRACTICE_BANK,
  PRACTICE_BANK_VERSION,
  PRACTICE_DECK_SIZE,
  PRACTICE_DIFFICULTIES,
  PRACTICE_ID_PREFIX,
  PRACTICE_OPTIONS,
  SIGNAL_CHOICE,
  gradePractice,
  isPracticeItemId,
  practiceItem,
  samplePracticeDeck,
} from "../src/practice.js";

const BANK_PATH = new URL(
  "../../../instruments/demo-2026.1/tracks/t2-discrimination/items/bank.jsonl",
  import.meta.url,
);
const T2_MEDIA = fileURLToPath(new URL("../../../apps/web/public/t2-media", import.meta.url));

interface ScoredItem {
  id: string;
  material?: { kind?: string; text?: string; src?: string; alt?: string };
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
    // The released tier: 20 items. The operational 84 are asserted against in
    // the private repo's copy of this file (see the header).
    expect(scored.length).toBeGreaterThan(10);
  });

  it("the practice module imports no instrument content and reads no file", () => {
    const source = readFileSync(new URL("../src/practice.ts", import.meta.url), "utf8");
    // Comments may NAME the bank (they must, to explain the rule); code may not
    // reach it. Strip comments, then assert on what actually executes.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["@ailx/session", "./practiceCorpus.js"]);
    expect(code).not.toMatch(/instruments|bank\.jsonl|readFile|import\(|require\(/);
  });

  it("the generated corpus module reaches no instrument content either", () => {
    // Moving the content out of practice.ts moved the risk with it, so the
    // same assertion follows it into the generated module.
    const source = readFileSync(new URL("../src/practiceCorpus.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["./practice.js"]);
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

  it("shares no text, and no near-duplicate text, with scored material", () => {
    // Practice is media now, but its alt text and its tells are still prose,
    // and prose lifted from a scored rationale would leak just as surely.
    const scoredTexts = scored
      .flatMap((i) => [i.material?.text ?? "", i.material?.alt ?? "", i.rationale ?? ""])
      .filter((t) => t.length > 0);
    expect(scoredTexts.length).toBeGreaterThan(0);
    const scoredFingerprints = scoredTexts.map(contentWords);
    for (const item of PRACTICE_BANK) {
      const words = contentWords(`${item.material.alt} ${item.tell}`);
      for (const [i, fp] of scoredFingerprints.entries()) {
        const shared = [...words].filter((w) => fp.has(w));
        // A shared long word or two is English; a shared half is a copy.
        expect(shared.length / Math.max(1, words.size), `${item.id} vs scored #${i}`).toBeLessThan(0.5);
      }
    }
  });

  it("shares no IMAGE with the scored deck — by path, and by content hash", () => {
    // The decisive one for a media corpus. Two picture sets can collide on a
    // photograph without sharing a single word, so the fingerprint that
    // matters is the sha256 of the bytes actually shipped. Serving the same
    // picture in practice and in the scored deck would burn the scored item
    // even though every string in this repo stayed different.
    //
    // Hashed over the WHOLE t2-media pool, not over one bank's `src` list: the
    // pool serves the operational deck too, and its bank is no longer in this
    // repo to enumerate. The directory is the superset, so this is the
    // stronger check — and it is the only place either repo holds both sets
    // of bytes.
    const digest = (path: string): string =>
      createHash("sha256").update(readFileSync(path)).digest("hex");

    const scoredSrcs = new Set(
      scored.map((i) => i.material?.src ?? "").filter((s) => s.length > 0),
    );
    expect(scoredSrcs.size).toBeGreaterThan(0);
    const scoredHashes = new Map<string, string>();
    for (const file of readdirSync(T2_MEDIA)) {
      scoredHashes.set(digest(join(T2_MEDIA, file)), `t2-media/${file}`);
    }
    // The pool is bigger than the released tier's own references.
    expect(scoredHashes.size).toBeGreaterThan(scoredSrcs.size);

    for (const item of PRACTICE_BANK) {
      expect(scoredSrcs.has(item.material.src), item.id).toBe(false);
      expect(item.material.src.startsWith("practice-media/"), item.id).toBe(true);
      const file = fileURLToPath(
        new URL(`../../../apps/web/public/${item.material.src}`, import.meta.url),
      );
      const hash = digest(file);
      expect(scoredHashes.get(hash), `${item.id} ships the scored asset ${scoredHashes.get(hash)}`)
        .toBeUndefined();
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
      expect(PRACTICE_DIFFICULTIES).toContain(item.difficulty);
      expect(item.material.kind).toBe("image");
      expect(item.material.alt.length).toBeGreaterThan(20);
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
