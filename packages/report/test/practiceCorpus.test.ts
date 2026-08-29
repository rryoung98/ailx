/**
 * The practice corpus as CONTENT: its licensing, its attribution, its tells,
 * and the accessibility of its alt text.
 *
 * `practice.test.ts` guards the corpus against the scored bank. This file
 * guards it against itself. Three obligations live here that no type can
 * carry:
 *
 *  1. LICENSING IS NOT OPTIONAL. Every asset is somebody else's work, shipped
 *     under a licence that names conditions. An item without a licence, an
 *     author and a source URL is not a shippable item, and CC-BY / CC-BY-SA
 *     make that a legal statement rather than a stylistic one.
 *  2. THE TELL IS THE PRODUCT. The training effect the spec cites comes from
 *     the one-line explanation after the call, not from the card count. An
 *     item with a missing or boilerplate tell teaches nothing.
 *  3. ALT TEXT MUST NOT ANSWER THE QUESTION. A screen-reader user has to be
 *     able to take the drill, so alt text must describe the scene — but an
 *     alt text that says "AI-generated" or names the artefact hands over the
 *     answer, and the drill would be measuring reading, not looking.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ARTEFACT_FAMILIES,
  CLEAN_CHOICE,
  PRACTICE_BANK,
  PRACTICE_BANK_VERSION,
  PRACTICE_DECK_SIZE,
  SIGNAL_CHOICE,
} from "../src/practice.js";

const repoUrl = (path: string): string =>
  fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const CORPUS_PATH = repoUrl("instruments/practice/2026.1/corpus.json");
const MEDIA_DIR = repoUrl("apps/web/public/practice-media");

/** The licences the pipeline is allowed to accept — the same set it enforces. */
const ALLOWED_LICENSE = /^(CC0|CC BY(-SA)? \d(\.\d)?|Public domain|PD)/i;

/** 150 KB per asset: /practice ships in the static export, over the network. */
const ASSET_BUDGET_BYTES = 150_000;

interface CorpusFile {
  version: string;
  items: {
    id: string;
    key: string;
    family: string;
    difficulty: string;
    tell: string;
    material: { kind: string; src: string; alt: string };
    credit: Record<string, string>;
  }[];
}

const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as CorpusFile;

describe("the generated corpus module matches its source of truth", () => {
  it("carries the manifest's version", () => {
    expect(PRACTICE_BANK_VERSION).toBe(corpus.version);
    expect(PRACTICE_BANK_VERSION).toMatch(/^practice-/);
  });

  it("carries every manifest item, and nothing else", () => {
    expect(PRACTICE_BANK.map((i) => i.id).sort()).toEqual(corpus.items.map((i) => i.id).sort());
  });

  it("agrees with the manifest field by field (a stale regeneration fails here)", () => {
    const byId = new Map(PRACTICE_BANK.map((i) => [i.id, i]));
    for (const source of corpus.items) {
      const built = byId.get(source.id)!;
      expect(built.family).toBe(source.family);
      expect(built.difficulty).toBe(source.difficulty);
      expect(built.tell).toBe(source.tell);
      expect(built.material).toEqual(source.material);
      expect(built.credit).toEqual(source.credit);
      // The manifest names the class; the module carries its option index.
      expect(built.key).toBe(source.key === "synthetic" ? SIGNAL_CHOICE : CLEAN_CHOICE);
    }
  });
});

describe("every item is legally shippable", () => {
  it("records a licence, an author, a source URL and a retrieval date", () => {
    expect(PRACTICE_BANK.length).toBeGreaterThan(0);
    for (const item of PRACTICE_BANK) {
      const c = item.credit;
      expect(c.license, `${item.id} has no licence`).toBeTruthy();
      expect(c.license, `${item.id} licence '${c.license}' is not allowed`).toMatch(ALLOWED_LICENSE);
      expect(c.author, `${item.id} has no author to attribute`).toBeTruthy();
      expect(c.commons_title, `${item.id} has no source title`).toBeTruthy();
      expect(c.source_url, `${item.id} has no source URL`).toContain("commons.wikimedia.org");
      expect(c.retrieved, `${item.id} has no retrieval date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.derivative, `${item.id} does not say what was changed`).toBeTruthy();
    }
  });

  it("evidences the generator for every image it calls AI-generated", () => {
    // Labelling a photograph "AI-generated" would teach a falsehood, so the
    // claim has to come from the Commons file page, not from a category.
    for (const item of PRACTICE_BANK) {
      if (item.key !== SIGNAL_CHOICE) continue;
      expect(item.credit.generator_evidence, `${item.id} claims synthetic with no evidence`)
        .toBeTruthy();
    }
  });

  it("never claims a generator for an image it calls a photograph", () => {
    for (const item of PRACTICE_BANK) {
      if (item.key !== CLEAN_CHOICE) continue;
      expect(item.credit.generator_evidence, `${item.id} is both photograph and generated`)
        .toBeUndefined();
    }
  });
});

describe("every asset exists, is budgeted, and is used once", () => {
  it("ships each referenced file under the asset budget", () => {
    for (const item of PRACTICE_BANK) {
      expect(item.material.src).toMatch(/^practice-media\/[0-9a-f]{12}\.jpg$/);
      const path = repoUrl(`apps/web/public/${item.material.src}`);
      expect(existsSync(path), `missing asset ${item.material.src}`).toBe(true);
      expect(statSync(path).size, `${item.material.src} over budget`)
        .toBeLessThanOrEqual(ASSET_BUDGET_BYTES);
    }
  });

  it("references every shipped asset exactly once (no orphans, no reuse)", () => {
    const referenced = PRACTICE_BANK.map((i) => i.material.src.replace("practice-media/", ""));
    expect(new Set(referenced).size, "an asset is used by two items").toBe(referenced.length);
    const shipped = readdirSync(MEDIA_DIR).filter((f) => f.endsWith(".jpg"));
    expect(shipped.sort(), "shipped assets and referenced assets disagree").toEqual(
      [...referenced].sort(),
    );
  });
});

describe("attribution is discoverable outside the app too", () => {
  it("lists every asset, author and licence in docs/CREDITS.md", () => {
    // The drill credits each image on the card, but CC-BY also wants the
    // attribution to survive the app: a reader of the repo must be able to
    // find who made what without running anything.
    const credits = readFileSync(repoUrl("docs/CREDITS.md"), "utf8");
    for (const item of PRACTICE_BANK) {
      const file = item.material.src.replace("practice-media/", "");
      expect(credits, `CREDITS.md does not list ${file}`).toContain(file);
      expect(credits, `CREDITS.md does not attribute ${item.id}`)
        .toContain(item.credit.author);
    }
  });
});

describe("the tell is the teaching", () => {
  it("gives every item a specific, non-boilerplate tell", () => {
    const tells = PRACTICE_BANK.map((i) => i.tell);
    expect(new Set(tells).size, "two items share a tell").toBe(tells.length);
    for (const item of PRACTICE_BANK) {
      expect(item.tell.length, `${item.id} tell is too short to teach`).toBeGreaterThan(80);
      // A tell that only restates the verdict is not a tell.
      expect(item.tell.toLowerCase(), `${item.id} tell only restates the answer`)
        .not.toMatch(/^(this is|it is) (an? )?(ai|real|fake|generated|photograph)/);
    }
  });
});

describe("alt text lets a screen-reader user play without being told", () => {
  it("describes the scene", () => {
    for (const item of PRACTICE_BANK) {
      expect(item.material.alt.length, `${item.id} alt is too thin`).toBeGreaterThan(30);
      expect(item.material.alt.trim().endsWith("."), `${item.id} alt is not a sentence`).toBe(true);
    }
  });

  it("never leaks the class, the generator, or the artefact", () => {
    const leaks = [
      "ai-generated", "ai generated", "generated", "synthetic", "artificial",
      "midjourney", "dall-e", "stable diffusion", "gemini", "chatgpt", "imagen",
      "real photograph", "genuine photograph", "photograph of a real", "camera-captured",
      "impossible", "artefact", "artifact", "wrong", "mismatched", "inconsistent",
    ];
    for (const item of PRACTICE_BANK) {
      const alt = item.material.alt.toLowerCase();
      for (const leak of leaks) {
        expect(alt.includes(leak), `${item.id} alt leaks '${leak}'`).toBe(false);
      }
    }
  });

  it("does not simply repeat the tell", () => {
    for (const item of PRACTICE_BANK) {
      expect(item.tell.toLowerCase()).not.toContain(item.material.alt.toLowerCase());
    }
  });
});

describe("the corpus can fill a balanced deck", () => {
  it("has both classes in every family, in enough depth to deal a round", () => {
    const perFamily = Math.floor(PRACTICE_DECK_SIZE / ARTEFACT_FAMILIES.length);
    const signalPerFamily = Math.ceil(perFamily / 2);
    for (const family of ARTEFACT_FAMILIES) {
      const pool = PRACTICE_BANK.filter((i) => i.family === family);
      const signal = pool.filter((i) => i.key === SIGNAL_CHOICE).length;
      expect(signal, `${family} has too few AI-generated items`)
        .toBeGreaterThanOrEqual(signalPerFamily);
      expect(pool.length - signal, `${family} has too few photographs`)
        .toBeGreaterThanOrEqual(perFamily - signalPerFamily);
    }
  });

  it("is not lopsided overall (a class-biased corpus trains a response bias)", () => {
    const signal = PRACTICE_BANK.filter((i) => i.key === SIGNAL_CHOICE).length;
    const clean = PRACTICE_BANK.length - signal;
    expect(Math.abs(signal - clean), "corpus is skewed towards one call")
      .toBeLessThanOrEqual(Math.ceil(PRACTICE_BANK.length / 4));
  });

  it("varies difficulty rather than shipping one setting", () => {
    expect(new Set(PRACTICE_BANK.map((i) => i.difficulty)).size).toBeGreaterThanOrEqual(2);
  });
});
