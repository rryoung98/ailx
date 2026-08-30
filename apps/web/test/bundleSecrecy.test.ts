/**
 * The answer key must not ship to the browser.
 *
 * docs/ARCHITECTURE.md §6: the repo stays whole and the boundary is enforced
 * mechanically — "a CI test greps the built client bundles for a known
 * key/rationale string and any operational item id, and fails the build. The
 * leak we just found must not be findable twice."
 *
 * That leak was real: apps/web/lib/instrument.ts statically imported
 * instruments/2026.1/snapshot.json, whose embedded T2 bank carried `key`,
 * `rationale` and `provenance` for all 104 items in that bank, so the deployed
 * static export handed every participant the marking scheme. The bank has
 * since been split: 20 items became the PUBLIC released-practice tier
 * (instruments/demo-2026.1, keys published on purpose, and the only bank a
 * browser may hold), and the remaining 84 operational items are served only
 * through the server-only `@ailx/instrument`.
 *
 * The secret is read from the OPERATIONAL bank at test time rather than
 * hardcoded here: a test that pins one leaked string only guards that string,
 * and a new item written tomorrow would leak unwatched.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const BANK = fileURLToPath(
  new URL(
    "../../../instruments/2026.1/tracks/t2-discrimination/items/bank.jsonl",
    import.meta.url,
  ),
);

/**
 * Both build modes, and only the assets a BROWSER can fetch. `.next/server/**`
 * is deliberately absent: server code is allowed — required — to hold keys.
 * Source maps are scanned when present, because a shipped map leaks as loudly
 * as the chunk it describes.
 */
const MODES = [
  { name: "static export (apps/web/out)", dir: fileURLToPath(new URL("../out", import.meta.url)) },
  {
    name: "hosted client assets (apps/web/.next/static)",
    dir: fileURLToPath(new URL("../.next/static", import.meta.url)),
  },
];

const SHIPPED = /\.(js|txt|html|map)$/;
// A build that suddenly triples in size is a signal, not something to swallow;
// reading it into one string would also blow the default heap.
const MAX_CORPUS_BYTES = 96 * 1024 * 1024;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SHIPPED.test(entry)) out.push(full);
  }
  return out;
}

interface Corpus {
  files: string[];
  /** One concatenated string: 104 items x 3 needles is 312 scans, not 312 x N file reads. */
  text: string;
}

function loadCorpus(dir: string): Corpus {
  const files = walk(dir);
  let bytes = 0;
  const parts: string[] = [];
  for (const file of files) {
    bytes += statSync(file).size;
    if (bytes > MAX_CORPUS_BYTES) {
      throw new Error(
        `build output under ${dir} exceeds ${MAX_CORPUS_BYTES} bytes; ` +
          "the secrecy scan needs streaming, and the size itself wants explaining",
      );
    }
    parts.push(readFileSync(file, "utf8"));
  }
  // A separator keeps a needle from being forged across a file boundary.
  return { files, text: parts.join("\n\u0000\n") };
}

interface Item {
  id: string;
  rationale: string;
}

const items: Item[] = readFileSync(BANK, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as Item);

/** JSON.stringify minus its quotes: the bundle stores the escaped form. */
function jsonEscaped(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * What must never appear. The id is the content address a client could use to
 * look an answer up; the rationale prefix is the answer spelled out in prose.
 * 60 chars is long enough to be unique to one item and short enough to survive
 * a minifier's line handling.
 */
function needles(item: Item): { label: string; value: string }[] {
  const prefix = item.rationale.slice(0, 60);
  const escaped = jsonEscaped(prefix);
  return [
    { label: "item id", value: item.id },
    { label: "rationale prefix", value: prefix },
    ...(escaped === prefix ? [] : [{ label: "rationale prefix (JSON-escaped)", value: escaped }]),
  ];
}

/**
 * The key field itself, in the shape a bundled JSON blob takes — the canary
 * that fired for the original leak (40 occurrences in one chunk).
 *
 * It cannot be banned outright: the PUBLIC released-practice tier really does
 * ship its keys, on purpose, and the static demo really does bundle it. So the
 * budget is read from that tier at test time. Every `"key":"ai"` in a bundle
 * must be attributable to a released item; the 40 that shipped in
 * 638-614dcaf8.js were 30 more than the tier could account for, and that is
 * exactly what this arithmetic catches.
 *
 * Times two, because Next may emit the same bundled JSON into more than one
 * chunk (and the export writes both a chunk and its flight/txt payload).
 */
const KEY_LITERAL = '"key":"ai"';
const DEMO_BANK = fileURLToPath(
  new URL(
    "../../../instruments/demo-2026.1/tracks/t2-discrimination/items/bank.jsonl",
    import.meta.url,
  ),
);
const RELEASED_AI_KEYS = readFileSync(DEMO_BANK, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .filter((line) => (JSON.parse(line) as { key: string }).key === "ai").length;
const KEY_BUDGET = RELEASED_AI_KEYS * 2;

const countOf = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const present = MODES.filter((mode) => existsSync(mode.dir));

describe("no operational answer key reaches a built client bundle", () => {
  it("the released tier is small enough to be a budget, not a loophole", () => {
    // If the "released" tier ever grew to bank size, the key budget would stop
    // constraining anything. It is a practice form, and it must stay one.
    expect(RELEASED_AI_KEYS).toBeGreaterThan(0);
    expect(RELEASED_AI_KEYS).toBeLessThan(items.length / 4);
  });

  it("has a bank to compare against (guards against a silent path bug)", () => {
    // 84 operational items after the released-practice tier was split out
    // (instruments/demo-2026.1). The floor guards a silent path bug, not a
    // bank size, so it tracks "most of the bank", not an exact count.
    expect(items.length).toBeGreaterThan(50);
    for (const item of items) {
      expect(item.id).toMatch(/^[0-9a-f]{64}$/);
      // Shortest rationale in the bank today is 43 chars; anything much
      // shorter would stop being a distinctive needle.
      expect(item.rationale.length, item.id).toBeGreaterThan(30);
    }
  });

  it("scanned at least one build output", () => {
    // Skipping every mode would turn this guard into a green light. The static
    // export under apps/web/out is committed, so an empty list means the tree
    // is broken or the paths moved — either way, say so.
    expect(
      present.map((m) => m.name),
      "no build output found; run `pnpm --filter @ailx/web build` (and the AILX_BACKEND=1 build) first",
    ).not.toEqual([]);
  });

  for (const mode of MODES) {
    const run = existsSync(mode.dir) ? describe : describe.skip;
    run(mode.name, () => {
      const corpus = existsSync(mode.dir) ? loadCorpus(mode.dir) : { files: [], text: "" };

      it("found client assets to scan", () => {
        expect(corpus.files.length).toBeGreaterThan(0);
      });

      it(`ships no more ${KEY_LITERAL} than the released tier accounts for`, () => {
        const found = countOf(corpus.text, KEY_LITERAL);
        expect(
          found,
          `${found} x ${KEY_LITERAL} under ${mode.dir}, budget ${KEY_BUDGET} ` +
            `(${RELEASED_AI_KEYS} released items x 2 chunks)`,
        ).toBeLessThanOrEqual(KEY_BUDGET);
      });

      it("ships no operational item id or rationale", () => {
        const offenders: string[] = [];
        for (const item of items) {
          for (const needle of needles(item)) {
            if (corpus.text.includes(needle.value)) {
              offenders.push(`${item.id.slice(0, 12)}… ${needle.label}`);
            }
          }
        }
        // Report every offender, not the first: a leak is usually the whole bank.
        expect(offenders.slice(0, 10), `${offenders.length} leaks under ${mode.dir}`).toEqual([]);
      });
    });
  }
});
