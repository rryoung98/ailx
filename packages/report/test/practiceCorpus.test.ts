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
  PRACTICE_STYLES,
  SIGNAL_CHOICE,
} from "../src/practice.js";

const repoUrl = (path: string): string =>
  fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const CORPUS_PATH = repoUrl("instruments/practice/2026.1/corpus.json");
const MEDIA_DIR = repoUrl("apps/web/public/practice-media");

/** The licences the pipeline is allowed to accept — the same set it enforces. */
const ALLOWED_LICENSE = /^(CC0|CC BY(-SA)? \d(\.\d)?|Public domain|PD)/i;

/** The provider families we have established redistribution rights for. */
const GENERATOR_PROVIDERS = ["google", "openai"];

/** 200 KB per asset: /practice ships in the static export, over the network. */
const ASSET_BUDGET_BYTES = 200_000;

interface CorpusFile {
  version: string;
  items: {
    id: string;
    key: string;
    family: string;
    difficulty: string;
    tell: string;
    material: { kind: string; src: string; alt: string; style?: string };
    credit: Record<string, string>;
  }[];
}

/**
 * Width, height and colour-component count, read from the JPEG's own SOF
 * marker. No image library: the test may not add a dependency to learn a
 * property a candidate's five-line script could read.
 */
const jpegShape = (bytes: Buffer): { width: number; height: number; components: number } => {
  let at = 2; // skip SOI
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    // SOF0..SOF15, excluding the non-frame markers DHT (c4), JPG (c8), DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: bytes.readUInt16BE(at + 5),
        width: bytes.readUInt16BE(at + 7),
        components: bytes[at + 9],
      };
    }
    at += 2 + length;
  }
  throw new Error("no JPEG frame header");
};

/** Aspect band, named the way a person would name it. */
const ratioBand = (ratio: number): string =>
  ratio < 0.9 ? "portrait" : ratio <= 1.11 ? "square" : "landscape";

/**
 * The trivially computable properties of an asset — everything a script can
 * know WITHOUT looking at the picture. Continuous ones are bucketed coarsely
 * and on round numbers, chosen before the measurement rather than after it.
 */
const shortcutFeatures = (bytes: Buffer): Record<string, string | number> => {
  const { width, height, components } = jpegShape(bytes);
  return {
    ratioBand: ratioBand(width / height),
    ratioQuarter: Math.round((width / height) * 4) / 4,
    orientation: width === height ? "exact-square" : width > height ? "wide" : "tall",
    fileSizeBand25k: Math.floor(bytes.length / 25_000),
    pixelBand100k: Math.floor((width * height) / 100_000),
    widthBand100: Math.floor(width / 100),
    heightBand100: Math.floor(height / 100),
    colourComponents: components,
  };
};

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
  it("records an origin, a licence, an author, a date and what was changed", () => {
    expect(PRACTICE_BANK.length).toBeGreaterThan(0);
    for (const item of PRACTICE_BANK) {
      const c = item.credit;
      expect(["commons", "generated"], `${item.id} has origin '${c.origin}'`).toContain(c.origin);
      expect(c.license, `${item.id} has no licence`).toBeTruthy();
      expect(c.license, `${item.id} licence '${c.license}' is not allowed`).toMatch(ALLOWED_LICENSE);
      expect(c.author, `${item.id} has no author to attribute`).toBeTruthy();
      expect(c.retrieved, `${item.id} has no date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.derivative, `${item.id} does not say what was changed`).toBeTruthy();
    }
  });

  it("points a found item at the Commons file it came from", () => {
    for (const item of PRACTICE_BANK) {
      if (item.credit.origin !== "commons") continue;
      expect(item.credit.commons_title, `${item.id} has no source title`).toBeTruthy();
      expect(item.credit.source_url, `${item.id} has no source URL`)
        .toContain("commons.wikimedia.org");
      expect(item.credit.model, `${item.id} is found but names a model`).toBeUndefined();
    }
  });

  it("gives a generated item a model, a full prompt and a redistribution basis", () => {
    // We PUBLISH this corpus, so "the model returned it" is not a licence.
    // The basis is quoted from the provider's own terms at generation time,
    // and an image whose rights are unclear never reaches the repository.
    for (const item of PRACTICE_BANK) {
      if (item.credit.origin !== "generated") continue;
      const c = item.credit;
      expect(c.model, `${item.id} does not say which model made it`).toBeTruthy();
      expect(GENERATOR_PROVIDERS, `${item.id} has unvetted provider '${c.provider}'`)
        .toContain(c.provider!);
      expect(c.model!.startsWith(`${c.provider}/`), `${item.id} model and provider disagree`)
        .toBe(true);
      // Reproducibility is the upgrade this format has over scavenged media:
      // model plus prompt plus date, all recorded.
      expect(c.prompt!.length, `${item.id} has no usable prompt recorded`).toBeGreaterThan(80);
      expect(c.rights_basis, `${item.id} ships with no redistribution basis`).toBeTruthy();
      expect(c.commons_title, `${item.id} is generated but claims a Commons title`)
        .toBeUndefined();
      expect(item.key, `${item.id} is generated but curated as a photograph`).toBe(SIGNAL_CHOICE);
    }
  });

  it("never repeats a prompt (two items from one prompt are one item twice)", () => {
    const prompts = PRACTICE_BANK.map((i) => i.credit.prompt).filter(Boolean);
    expect(new Set(prompts).size).toBe(prompts.length);
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

describe("no trivially computable property of an asset predicts the answer", () => {
  /**
   * THE SHORTCUT TEST. A practice corpus fails at its job twice over if the
   * answer can be had without looking: the candidate learns the shortcut
   * instead of the artefact, and the bank's measured difficulty is a lie.
   * This corpus HAD one — generators default to 1:1 and cameras do not, so
   * every near-square item was synthetic and "answer AI if square" scored 29%
   * of the bank blind. It was broken by reframing crops (recorded, per item,
   * in `credit.derivative`), and file size was broken the same way by
   * encoding every asset towards one common size.
   *
   * A shortcut that returns silently is worse than a loud one, so the rule is
   * asserted rather than remembered, over EVERY property a script can read
   * without a model: aspect, orientation, dimensions, pixel count, encoded
   * size and colour components.
   */
  const rows = PRACTICE_BANK.map((item) => ({
    id: item.id,
    key: item.key,
    features: shortcutFeatures(readFileSync(repoUrl(`apps/web/public/${item.material.src}`))),
  }));
  const featureNames = Object.keys(rows[0]!.features);

  /** Items grouped by one feature's value: bucket -> counts per class. */
  const tally = (feature: string): Map<string, { signal: number; clean: number }> => {
    const buckets = new Map<string, { signal: number; clean: number }>();
    for (const row of rows) {
      const bucket = String(row.features[feature]);
      const seen = buckets.get(bucket) ?? { signal: 0, clean: 0 };
      if (row.key === SIGNAL_CHOICE) seen.signal += 1;
      else seen.clean += 1;
      buckets.set(bucket, seen);
    }
    return buckets;
  };

  /**
   * The bound. Chance for the best CONSTANT answer is the majority class,
   * about 0.52 here; 0.70 is 16 of 23 cards, which an uninformative property
   * does not reach. Anything above it is a rule worth learning instead of
   * looking, which is the thing this corpus must not teach.
   */
  const LEAK_CEILING = 0.7;

  it("scores near chance for a candidate who guesses from the feature alone", () => {
    for (const feature of featureNames) {
      const buckets = tally(feature);
      let correct = 0;
      for (const { signal, clean } of buckets.values()) correct += Math.max(signal, clean);
      const accuracy = correct / rows.length;
      expect(
        accuracy,
        `'${feature}' predicts the answer ${(accuracy * 100).toFixed(0)}% of the time — ` +
          `a candidate could score that without looking at a picture`,
      ).toBeLessThanOrEqual(LEAK_CEILING);
    }
  });

  it("leaves no populated bucket that is purely one class", () => {
    // The aspect-ratio leak was exactly this shape: seven near-square items,
    // all seven synthetic. A bound on average accuracy alone can miss a small
    // bucket that is a free, perfectly reliable answer whenever it comes up.
    for (const feature of featureNames) {
      for (const [bucket, { signal, clean }] of tally(feature)) {
        if (signal + clean < 4) continue;
        expect(
          signal > 0 && clean > 0,
          `every one of the ${signal + clean} items with ${feature}=${bucket} is ` +
            `${signal > 0 ? "AI-generated" : "a photograph"}`,
        ).toBe(true);
      }
    }
  });
});

describe("an item answerable from its STYLE says so", () => {
  /**
   * A painterly or rendered picture is called in a second from its finish,
   * and the candidate never reaches the artefact — which teaches
   * "painterly = generated", false of every genuine painting and of every
   * photorealistic generation. The corpus may still carry such items (found,
   * freely-licensed generations are scarce), but it may not carry them
   * silently: the flag is data, and the gaps document names them.
   */
  it("declares only known styles, and only on generated items", () => {
    for (const item of PRACTICE_BANK) {
      const style = item.material.style;
      if (style === undefined) continue;
      expect(PRACTICE_STYLES, `${item.id} has unknown style '${style}'`).toContain(style);
      expect(item.key, `${item.id} is a photograph flagged as non-photorealistic`)
        .toBe(SIGNAL_CHOICE);
    }
  });

  it("names every flagged item in docs/PROGRESSION.md", () => {
    const gaps = readFileSync(repoUrl("docs/PROGRESSION.md"), "utf8");
    for (const item of PRACTICE_BANK) {
      if (item.material.style === undefined) continue;
      expect(gaps, `PROGRESSION.md does not admit that ${item.id} is not photorealistic`)
        .toContain(item.id.split(":")[2]!);
    }
  });
});

describe("no single generator dominates the images we made ourselves", () => {
  /**
   * THE FINGERPRINT RULE. A corpus generated by one model teaches that model's
   * fingerprint, not the artefact — the same failure as the aspect-ratio and
   * file-size leaks, and harder to see, because it only shows up when the
   * candidate meets a different generator and their detection collapses.
   *
   * So the generated half spans both provider families reachable through
   * OpenRouter, and keeps OLDER models on purpose: their cruder failures are
   * the easy end of a difficulty range one model cannot supply. This test is
   * the thing that keeps that true as the corpus grows.
   */
  const made = PRACTICE_BANK.filter((i) => i.credit.origin === "generated");

  /** Share of the generated set any one model may hold. */
  const MODEL_CEILING = 0.5;

  it("uses at least two models, from at least two provider families", () => {
    expect(made.length, "nothing is generated yet").toBeGreaterThan(0);
    expect(new Set(made.map((i) => i.credit.model)).size,
      "every generated item came from one model").toBeGreaterThanOrEqual(2);
    expect(new Set(made.map((i) => i.credit.provider)).size,
      "every generated item came from one provider family").toBeGreaterThanOrEqual(2);
  });

  it("lets no single model own more than half of what we generated", () => {
    const perModel = new Map<string, number>();
    for (const item of made) {
      const model = item.credit.model!;
      perModel.set(model, (perModel.get(model) ?? 0) + 1);
    }
    for (const [model, count] of perModel) {
      expect(
        count / made.length,
        `${model} made ${count} of ${made.length} generated items — a candidate ` +
          `would learn its fingerprint instead of the artefact`,
      ).toBeLessThanOrEqual(MODEL_CEILING);
    }
  });

  it("keeps an older model in the mix, for the crude end of the range", () => {
    // Newer models fail subtly. A corpus of only current models has no easy
    // items, and an easy item is where a beginner learns what to look at.
    expect(made.some((i) => /2\.5|gpt-5-image-mini/.test(i.credit.model!)),
      "no older or smaller generator is represented").toBe(true);
  });
});
