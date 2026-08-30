/**
 * The player-type CAST as content: sixteen faces, sixteen voices, and the
 * provenance that lets us publish them.
 *
 * `playerType.test.ts` guards the type system. This file guards the art
 * attached to it, and three obligations live here that no TypeScript type can
 * carry:
 *
 *  1. SIXTEEN NAMES NEED SIXTEEN FACES. Every code the axes can produce must
 *     resolve to exactly one character, and no two may share a picture, an
 *     alt text or a voice — a duplicate is a set of stickers, not a cast.
 *  2. THE PICTURE IS NEVER THE MESSAGE. Alt text must describe the DRAWING
 *     (so a screen-reader user loses nothing), and must not smuggle the
 *     verdict, which lives in the name and the tagline as text.
 *  3. WE MAY ACTUALLY PUBLISH THESE. Generated output is ours only because a
 *     provider's terms say so; an entry without a model, a prompt, a date and
 *     a quoted rights basis is not shippable, and the asset it points at has
 *     to exist and fit the export budget.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CHARACTER_CAST,
  CHARACTER_CAST_VERSION,
  CHARACTER_STYLE_PROMPT,
  characterPrompt,
  playerCharacter,
} from "../src/character.js";
import { AXES } from "../src/playerType.js";

const repoUrl = (path: string): string =>
  fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const MANIFEST_PATH = repoUrl("instruments/characters/2026.1/characters.json");
const LEDGER_PATH = repoUrl("instruments/characters/2026.1/generated.json");
const ASSET_DIR = repoUrl("apps/web/public/characters");

/** 90 KB per asset: sixteen of these ride in the static export. */
const ASSET_BUDGET_BYTES = 90_000;
/** And the whole cast has to stay a rounding error on the export. */
const CAST_BUDGET_BYTES = 1_200_000;

/** Every code the four binary axes can produce — the cast must cover them. */
const ALL_CODES: string[] = (() => {
  let codes = [""];
  for (const axis of AXES) {
    codes = codes.flatMap((c) => [c + axis.hi.letter, c + axis.lo.letter]);
  }
  return codes;
})();

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
  version: string;
  model: string;
  style_preamble: string;
  characters: { code: string; src: string; credit: { subject: string } }[];
};
const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as {
  attempts: { slug: string; status: string; prompt: string; raw_sha256: string }[];
};

describe("player-type cast — coverage", () => {
  it("the axes produce sixteen codes and every one of them has a character", () => {
    expect(ALL_CODES).toHaveLength(16);
    expect(new Set(ALL_CODES).size).toBe(16);
    for (const code of ALL_CODES) {
      expect(playerCharacter(code), `no character for ${code}`).not.toBeNull();
    }
  });

  it("carries exactly the sixteen codes and no extras", () => {
    expect(CHARACTER_CAST.map((c) => c.code).sort()).toEqual([...ALL_CODES].sort());
  });

  it("resolves an unknown code to null rather than throwing", () => {
    // A frozen share payload from an older build must degrade to a card
    // without a picture, never a 500 on somebody's link.
    expect(playerCharacter("XXXX")).toBeNull();
    expect(playerCharacter("")).toBeNull();
    expect(playerCharacter("msvd")).toBeNull(); // codes are upper-case
  });
});

describe("player-type cast — sixteen distinct things", () => {
  const fields = ["code", "slug", "src", "alt", "voice"] as const;
  for (const field of fields) {
    it(`no two characters share a ${field}`, () => {
      const values = CHARACTER_CAST.map((c) => c[field]);
      expect(new Set(values).size, `duplicate ${field}`).toBe(values.length);
    });
  }

  it("every subject line is distinct — one prompt, sixteen drawings", () => {
    const subjects = CHARACTER_CAST.map((c) => c.credit.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
  });
});

describe("player-type cast — accessibility", () => {
  it("alt text describes the drawing, at readable length", () => {
    for (const c of CHARACTER_CAST) {
      expect(c.alt.length, `${c.code} alt too short`).toBeGreaterThan(40);
      expect(c.alt.length, `${c.code} alt too long`).toBeLessThan(240);
      expect(c.alt.endsWith("."), `${c.code} alt is not a sentence`).toBe(true);
    }
  });

  it("alt text does not restate the verdict, the code or the art direction", () => {
    // The name, the tagline and the code are printed as TEXT next to the
    // picture on every surface. An alt that repeats them makes a screen
    // reader say the same thing twice and describes nothing.
    for (const c of CHARACTER_CAST) {
      const alt = c.alt.toLowerCase();
      expect(alt, `${c.code} alt names the type code`).not.toContain(c.code.toLowerCase());
      for (const word of ["player type", "ailx", "skeptic", "verifier", "director", "illustration of"]) {
        expect(alt, `${c.code} alt says "${word}"`).not.toContain(word);
      }
    }
  });

  it("every character has a voice line that is a real sentence", () => {
    for (const c of CHARACTER_CAST) {
      expect(c.voice.length, `${c.code} voice too short`).toBeGreaterThan(40);
      expect(c.voice.length, `${c.code} voice too long`).toBeLessThan(220);
      expect(/[.!?]$/.test(c.voice), `${c.code} voice is not a sentence`).toBe(true);
    }
  });

  it("no voice line flatters a run it should not", () => {
    // The taglines are dry and specific; a voice that praises is a voice that
    // lies, and the whole card stops being worth trusting.
    for (const c of CHARACTER_CAST) {
      expect(/amazing|awesome|incredible|perfect|genius|superstar|congratulations/i.test(c.voice),
        `${c.code} voice flatters`).toBe(false);
    }
  });
});

describe("player-type cast — provenance and rights", () => {
  it("every character records model, provider, subject, dates and a rights basis", () => {
    for (const c of CHARACTER_CAST) {
      expect(c.credit.origin).toBe("generated");
      expect(c.credit.model).toMatch(/^[a-z0-9.-]+\/[a-z0-9.-]+$/);
      expect(["google", "openai"]).toContain(c.credit.provider);
      expect(c.credit.subject.length).toBeGreaterThan(60);
      expect(c.credit.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.credit.vetted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.credit.license).toBe("CC0");
      expect(c.credit.author).toBeTruthy();
      expect(c.credit.derivative).toBeTruthy();
      expect(c.credit.rights_basis.length, `${c.code} has no quoted rights basis`)
        .toBeGreaterThan(80);
    }
  });

  it("the full prompt is reconstructible, and is the prompt a human accepted", () => {
    const accepted = new Map(
      ledger.attempts.filter((a) => a.status === "accepted").map((a) => [a.slug, a]),
    );
    for (const c of CHARACTER_CAST) {
      const attempt = accepted.get(c.code);
      expect(attempt, `${c.code} has no accepted attempt in the ledger`).toBeDefined();
      expect(characterPrompt(c)).toBe(attempt!.prompt);
    }
  });

  it("the style preamble is carried once, not sixteen times", () => {
    expect(CHARACTER_STYLE_PROMPT).toBe(manifest.style_preamble);
    for (const c of CHARACTER_CAST) {
      expect(c.credit.subject).not.toContain(CHARACTER_STYLE_PROMPT);
    }
  });

  it("the generated module matches the manifest it was built from", () => {
    expect(CHARACTER_CAST_VERSION).toBe(manifest.version);
    expect(CHARACTER_CAST.map((c) => c.src)).toEqual(manifest.characters.map((c) => c.src));
  });
});

describe("player-type cast — the shipped assets", () => {
  it("every character points at a real file inside the export budget", () => {
    for (const c of CHARACTER_CAST) {
      expect(c.src).toMatch(/^characters\/[0-9a-f]{12}\.jpg$/);
      const path = repoUrl(`apps/web/public/${c.src}`);
      expect(existsSync(path), `missing asset for ${c.code}`).toBe(true);
      expect(statSync(path).size, `${c.code} asset over budget`)
        .toBeLessThanOrEqual(ASSET_BUDGET_BYTES);
    }
  });

  it("is JPEG, square, and small enough to read in a feed", () => {
    for (const c of CHARACTER_CAST) {
      const bytes = readFileSync(repoUrl(`apps/web/public/${c.src}`));
      // SOI marker: satori rasterizes JPEG and PNG, never SVG or WebP, and
      // the OG card is the surface this cast exists for.
      expect(bytes[0], `${c.code} is not a JPEG`).toBe(0xff);
      expect(bytes[1]).toBe(0xd8);
      const { width, height } = jpegShape(bytes);
      expect(width, `${c.code} is not square`).toBe(height);
      expect(width).toBeLessThanOrEqual(512);
    }
  });

  it("is credited in docs/CREDITS.md — a published picture names its origin", () => {
    const credits = readFileSync(repoUrl("docs/CREDITS.md"), "utf8");
    for (const c of CHARACTER_CAST) {
      expect(credits, `${c.code} is not credited`).toContain(c.src.split("/")[1]);
    }
  });

  it("ships no orphaned asset and no bloat", () => {
    const live = new Set(CHARACTER_CAST.map((c) => c.src.split("/")[1]));
    const onDisk = readdirSync(ASSET_DIR).filter((n) => n.endsWith(".jpg"));
    expect(onDisk.filter((n) => !live.has(n)), "orphaned character assets").toEqual([]);
    const total = onDisk.reduce((sum, n) => sum + statSync(`${ASSET_DIR}/${n}`).size, 0);
    expect(total, "the cast is bloating the static export").toBeLessThan(CAST_BUDGET_BYTES);
  });
});

/** Width and height from the JPEG's own SOF marker; no image dependency. */
function jpegShape(bytes: Buffer): { width: number; height: number } {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  throw new Error("no JPEG frame header");
}
