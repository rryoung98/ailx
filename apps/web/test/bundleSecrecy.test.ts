/**
 * The answer key must not ship to the browser.
 *
 * docs/ARCHITECTURE.md §6: the repo stays whole and the boundary is enforced
 * mechanically — "a CI test greps the built client bundles for a known
 * key/rationale string and any operational item id, and fails the build. The
 * leak we just found must not be findable twice."
 *
 * That leak was real: apps/web/lib/instrument/instrument.ts statically imported
 * instruments/2026.1/snapshot.json, whose embedded T2 bank carried `key`,
 * `rationale` and `provenance` for all 104 items in that bank, so the deployed
 * static export handed every participant the marking scheme. The bank has
 * since been split: 20 items became the PUBLIC released-practice tier
 * (instruments/demo-2026.1, keys published on purpose, and the only bank a
 * browser may hold), and the remaining 84 operational items moved out of this
 * repository altogether, into the private backend repo.
 *
 * WHICH CHANGES HOW THIS GUARD IS WRITTEN. It used to read its needles from
 * the operational instrument at test time — the right way round while that
 * instrument was here, because a hardcoded needle only guards one string. The
 * needles are gone with it, so the scan is now stated as an ALLOWANCE instead
 * of a blacklist, which is strictly stronger:
 *
 *   1. every `"key":"ai"` must be attributable to a released item (unchanged);
 *   2. every T2 item id in the bundle must BE a released item id — the 104-item
 *      leak fails this with 84 unaccounted ids, and so does any future bank;
 *   3. nothing SHAPED like a mark scheme may appear at all: a non-empty
 *      `prompts` array, a `band_anchors` block, a judge prompt's front matter,
 *      or a rubric criterion that carries a `description`.
 *
 * The exact-secret scan is kept and still runs wherever the secrets exist: set
 * `AILX_OPERATIONAL_SNAPSHOT` to a checkout of the private instrument (CI in
 * that repo does) and every judge prompt, criterion description, band anchor,
 * T3 plant and T4 brief becomes a needle again. The extractor that does it is
 * proved against a synthetic snapshot below, unconditionally, so it cannot rot
 * while unused.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";
import { T3_SCENARIO } from "../lib/instrument/instrument";

/**
 * The OPERATIONAL instrument, if this checkout can see one. Unset in this
 * repository — that is the point of moving it — and set by the private repo's
 * CI to the path of its `instruments/2026.1/snapshot.json`. Every needle in
 * the exact-secret scan comes from it, never from a literal in this file: a
 * test that pins one leaked string only guards that string.
 *
 * It is also the reason the demo does not self-trip. The released-practice
 * tier publishes item keys on purpose, and `apps/web/lib/instrument/instrument.ts`
 * publishes the T3 practice scenario on purpose; neither may supply a needle.
 */
const OPERATIONAL_SNAPSHOT = process.env.AILX_OPERATIONAL_SNAPSHOT;

/**
 * Both build modes, and only the assets a BROWSER can fetch. `.next/server/**`
 * is deliberately absent: server code is allowed — required — to hold keys.
 * Source maps are scanned when present, because a shipped map leaks as loudly
 * as the chunk it describes.
 */
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

/**
 * `apps/web/public` is the third mode, and the one this guard was blind to
 * until TEN-117. It is not a build output: both builds copy it verbatim, so a
 * file placed there is served by BOTH modes and was scanned in neither. It is
 * always present, so unlike the other two it never skips.
 *
 * `expectItemIds` says whether a mode must contain released item ids at all.
 * A build output must — a scan that finds none is looking at the wrong bytes
 * and would pass on anything. The public tree legitimately carries none.
 */
const MODES = [
  {
    name: "static export (apps/web/out)",
    dir: fileURLToPath(new URL("../out", import.meta.url)),
    expectItemIds: true,
  },
  {
    name: "hosted client assets (apps/web/.next/static)",
    dir: fileURLToPath(new URL("../.next/static", import.meta.url)),
    expectItemIds: true,
  },
  { name: "public asset tree (apps/web/public)", dir: PUBLIC_DIR, expectItemIds: false },
];

/**
 * The file classes a browser can fetch AND a human can read. `js|txt|html|map`
 * was the whole list until TEN-117, so `public/media/*.provenance.json` shipped
 * unscanned and a planted `public/offline-bank.json` would have passed. Binary
 * media is deliberately absent: bytes are covered by the inventory below, which
 * asserts WHICH files may exist rather than what is inside them.
 */
const SHIPPED = /\.(js|txt|html|map|json|jsonl|md|css|svg|mjs|cjs|ya?ml|csv)$/;
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

/** JSON.stringify minus its quotes: the bundle stores the escaped form. */
function jsonEscaped(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * What must never appear, given an operational bank to read it from. The id is
 * the content address a client could use to look an answer up; the rationale
 * prefix is the answer spelled out in prose. 60 chars is long enough to be
 * unique to one item and short enough to survive a minifier's line handling.
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
// The released tier publishes its keys on purpose, so a released item carries
// `key` as well as everything `Item` names. Annotating the array `Item[]`
// threw that away and made the arithmetic below reach back through a cast.
const released: Array<Item & { key: string }> = readFileSync(DEMO_BANK, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as Item & { key: string });
const RELEASED_IDS = new Set(released.map((i) => i.id));
const RELEASED_AI_KEYS = released.filter((i) => i.key === "ai").length;
const KEY_BUDGET = RELEASED_AI_KEYS * 2;

/**
 * Every content-addressed item id in the bundle, in either of the two shapes
 * the snapshot takes there: raw JSON in a chunk, and the DOUBLE-escaped JSON
 * of a flight payload. Stripping backslashes collapses both into one haystack,
 * which is also why the structural probes below can be written once.
 */
const ITEM_ID = /"id":"([0-9a-f]{64})"/g;
function bundledItemIds(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.replace(/\\/g, "").matchAll(ITEM_ID)) out.add(m[1]);
  return out;
}

/**
 * A mark scheme, by SHAPE rather than by secret — the guard that survives the
 * operational instrument not being in this repo. Each probe is a literal
 * substring of the JSON a leak would produce:
 *
 *  - `"prompts":[{` — the array is empty in a public snapshot, always.
 *  - `"band_anchors"` / `"min_scaled"` — the band prose, stripped wholesale.
 *  - `translation_provenance` — a judge prompt's front matter, so a prompt
 *    smuggled in as a plain string is caught too.
 *  - `,"description"` right after a criterion's `scored_by`/`judged` pair: the
 *    published allocation ends at `judged`, and anything after it is marking
 *    detail. Written as the two orderings a criterion object can serialise in.
 */
const MARK_SCHEME_SHAPES: ReadonlyArray<{ label: string; value: string }> = [
  { label: "non-empty judge prompt array", value: '"prompts":[{' },
  { label: "rubric band anchors", value: '"band_anchors"' },
  { label: "band anchor threshold", value: '"min_scaled"' },
  { label: "judge prompt front matter", value: "translation_provenance" },
  { label: "criterion description (judged)", value: '"judged":true,"description"' },
  { label: "criterion description (unjudged)", value: '"judged":false,"description"' },
];

/**
 * MARKING MATERIAL — the second half of the answer key.
 *
 * T2's secret is the keyed item. The judged tracks (T1, T3, T4) keep theirs in
 * the instrument's judge PROMPTS, in the operational T3 planted errors (which
 * surfaced claim is the plant, and what the truth is), and in the operational
 * T4 brief/audience (a harvested brief lets a candidate pre-generate). None of
 * it may reach a browser; the server issues those scores.
 *
 * Needle rules, learned the hard way:
 *  - the bundle stores the snapshot JSON DOUBLE-escaped, so a needle carrying
 *    a newline, a quote or a backslash never matches even when the secret is
 *    right there. Only a single line free of `"` and `\\` matches raw.
 *  - prefer a line unique to ONE prompt, so a hit names its own source; the
 *    ja/ko prompts share a machine-translation frontmatter comment.
 */
interface OperationalPrompt {
  locale: string;
  filename: string;
  content: string;
}

interface OperationalCriterion {
  id: string;
  name: string;
  points: number;
  description?: string;
}

/**
 * A band anchor: the prose that tells a marker what "distinction" looks like.
 * `buildSnapshot(..., { public: true })` drops the whole array, because an
 * anchor is the mark scheme written out — read four of them and you know what
 * to write. Guarded here for the same reason the criterion `description` is.
 */
interface OperationalBandAnchor {
  band: string;
  anchor?: string;
}

interface OperationalTrack {
  trackId: string;
  config: Record<string, unknown>;
  rubric?: { criteria?: OperationalCriterion[]; band_anchors?: OperationalBandAnchor[] };
  prompts?: OperationalPrompt[];
}

interface OperationalSnapshot {
  instrument: { tracks: OperationalTrack[] };
}

/**
 * Tracks whose PROMPTS and dealt form are marking material. T2's answer key is
 * the keyed item, covered by the bank scan above, and T2 publishes no judge
 * prompt — but its RUBRIC marking detail is withheld exactly like theirs, so
 * the rubric scan below deliberately runs over every track.
 */
const JUDGED_TRACKS = ["t1-creative-build", "t3-reasoning", "t4-generative"];

/** Lines that survive the bundle's escaping and are long enough to be unique. */
const MIN_NEEDLE_CHARS = 40;
function bundleSafeLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= MIN_NEEDLE_CHARS && !line.includes('"') && !line.includes("\\"));
}

/**
 * The longest bundle-safe line, preferring one that occurs in exactly one of
 * the sibling bodies. Returns undefined when a body has no safe line at all
 * (a prompt written entirely in quoted JSON, say) — the caller must notice.
 */
function pickNeedle(body: string, siblings: readonly string[]): string | undefined {
  const candidates = bundleSafeLines(body).sort((a, b) => b.length - a.length);
  const unique = candidates.find(
    (line) => siblings.filter((s) => s.includes(line)).length === 1,
  );
  return unique ?? candidates[0];
}

interface Needle {
  label: string;
  value: string;
}

/**
 * Every secret string the judged tracks own, as it would appear in a bundle.
 * Exported shape, tested below against a synthetic snapshot: the operational
 * instrument in this PUBLIC repo carries the judge prompts but not yet the T3
 * scenario or the T4 brief (those live with the exam service), so extraction
 * must be proven independently of what today's file happens to contain.
 */
function markingNeedles(snap: OperationalSnapshot): Needle[] {
  const out: Needle[] = [];
  for (const track of snap.instrument.tracks) {
    // Rubric MARKING detail, for EVERY track — the public view strips it from
    // all four, so all four are guarded. The points allocation is published
    // (spec §14); the per-criterion description is how a judge is told to
    // mark, and a band anchor is that mark scheme spelled out per grade.
    for (const c of track.rubric?.criteria ?? []) {
      const value = pickNeedle(c.description ?? "", [c.description ?? ""]);
      if (value !== undefined) out.push({ label: `${track.trackId} rubric ${c.id}`, value });
    }
    for (const a of track.rubric?.band_anchors ?? []) {
      const value = pickNeedle(a.anchor ?? "", [a.anchor ?? ""]);
      if (value !== undefined) out.push({ label: `${track.trackId} band ${a.band}`, value });
    }

    if (!JUDGED_TRACKS.includes(track.trackId)) continue;

    // (a) judge prompts, every locale.
    const bodies = (track.prompts ?? []).map((p) => p.content);
    for (const prompt of track.prompts ?? []) {
      const value = pickNeedle(prompt.content, bodies);
      if (value !== undefined) out.push({ label: `${track.trackId} ${prompt.filename}`, value });
    }

    // (b) operational T3 planted errors: the claim IS the key, the truth is
    // the mark scheme. Accept either casing — the snapshot is snake_case, the
    // TS shapes are camelCase.
    const cfg = track.config as Record<string, unknown>;
    const scenario = (cfg.scenario ?? {}) as Record<string, unknown>;
    const plants = (scenario.planted_errors ?? scenario.plantedErrors ?? []) as Array<
      Record<string, unknown>
    >;
    for (const plant of Array.isArray(plants) ? plants : []) {
      for (const field of ["claim", "truth"] as const) {
        const text = plant[field];
        if (typeof text !== "string") continue;
        const value = pickNeedle(text, [text]);
        if (value !== undefined) {
          out.push({ label: `${track.trackId} plant ${String(plant.id)} ${field}`, value });
        }
      }
    }

    // (c) operational T4 brief/audience (also read from a t3 scenario block,
    // whose operational brief/sourceExcerpt is withheld for form security).
    for (const [holder, name] of [
      [cfg, "config"],
      [scenario, "scenario"],
    ] as const) {
      for (const field of ["brief", "audience", "source_excerpt", "sourceExcerpt"] as const) {
        const text = (holder as Record<string, unknown>)[field];
        if (typeof text !== "string") continue;
        const value = pickNeedle(text, [text]);
        if (value !== undefined) out.push({ label: `${track.trackId} ${name}.${field}`, value });
      }
    }
  }
  return out;
}

const OPERATIONAL: OperationalSnapshot | undefined =
  OPERATIONAL_SNAPSHOT === undefined
    ? undefined
    : (JSON.parse(readFileSync(OPERATIONAL_SNAPSHOT, "utf8")) as OperationalSnapshot);
const MARKING_NEEDLES = OPERATIONAL === undefined ? [] : markingNeedles(OPERATIONAL);
const OPERATIONAL_ITEMS: Item[] =
  process.env.AILX_OPERATIONAL_BANK === undefined
    ? []
    : readFileSync(process.env.AILX_OPERATIONAL_BANK, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Item);

const countOf = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const present = MODES.filter((mode) => existsSync(mode.dir));

describe("no operational answer key reaches a built client bundle", () => {
  it("the released tier is small enough to be a budget, not a loophole", () => {
    // If the "released" tier ever grew to exam size, the key budget would stop
    // constraining anything. It is a practice form, and it must stay one.
    // 20 items against the 104 authored: a quarter of the corpus is the line.
    expect(RELEASED_AI_KEYS).toBeGreaterThan(0);
    expect(released.length).toBeLessThan(104 / 4);
  });

  it("has a released bank to compare against (guards against a silent path bug)", () => {
    expect(released.length).toBe(20);
    expect(RELEASED_IDS.size).toBe(released.length);
    for (const item of released) {
      expect(item.id).toMatch(/^[0-9a-f]{64}$/);
      expect(item.rationale.length, item.id).toBeGreaterThan(30);
    }
  });

  // Skipping every mode would turn this guard into a green light, so CI must
  // find output: `.github/workflows/ci.yml` runs both builds before the test
  // step, and an empty list there means the tree is broken or the paths moved.
  //
  // Neither output is committed, and a test cannot make one, so on a clean
  // clone this assertion only said "you forgot to build". That made a green
  // `pnpm test` depend on a build step nothing runs for you. It is skipped
  // where there is nothing to scan and no CI to have built it.
  it.skipIf(present.length === 0 && process.env.CI === undefined)(
    "scanned at least one build output",
    () => {
      expect(
        present.map((m) => m.name),
        "no build output found; run `pnpm --filter @ailx/web build` (and the AILX_BACKEND=1 build) first",
      ).not.toEqual([]);
    },
  );

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

      it("ships no T2 item the released tier cannot account for", () => {
        // The allowance, not a blacklist. Every content-addressed item id in
        // the bundle must be one of the twenty published on purpose; the
        // original leak put 104 there, and 84 of them would fail here without
        // this repo holding a single byte of the operational bank.
        const bundled = [...bundledItemIds(corpus.text)];
        const foreign = bundled.filter((id) => !RELEASED_IDS.has(id));
        expect(
          foreign.slice(0, 10).map((id) => `${id.slice(0, 12)}…`),
          `${foreign.length} unaccounted item ids under ${mode.dir}`,
        ).toEqual([]);
        // ...and the released ones really are there, or the scan is looking at
        // the wrong bytes and would pass on anything.
        if (mode.expectItemIds) {
          expect(bundled.length, `no item id at all under ${mode.dir}`).toBeGreaterThan(0);
        }
      });

      it("ships nothing shaped like a mark scheme", () => {
        const flat = corpus.text.replace(/\\/g, "");
        const offenders = MARK_SCHEME_SHAPES.filter((s) => flat.includes(s.value)).map(
          (s) => s.label,
        );
        expect(offenders, `mark-scheme shapes under ${mode.dir}`).toEqual([]);
      });

      it("ships no operational item id or rationale", () => {
        // Only bites where an operational bank is readable (the private repo's
        // CI, via AILX_OPERATIONAL_BANK). Where it is not, the allowance scan
        // above is the guard, and it covers strictly more.
        const offenders: string[] = [];
        for (const item of OPERATIONAL_ITEMS) {
          for (const needle of needles(item)) {
            if (corpus.text.includes(needle.value)) {
              offenders.push(`${item.id.slice(0, 12)}… ${needle.label}`);
            }
          }
        }
        // Report every offender, not the first: a leak is usually the whole bank.
        expect(offenders.slice(0, 10), `${offenders.length} leaks under ${mode.dir}`).toEqual([]);
      });

      it("ships no judge prompt, rubric marking detail or operational track secret", () => {
        const offenders: string[] = [];
        for (const needle of MARKING_NEEDLES) {
          const hits = countOf(corpus.text, needle.value);
          if (hits === 0) continue;
          const where = corpus.files
            .filter((f) => readFileSync(f, "utf8").includes(needle.value))
            .map((f) => f.slice(mode.dir.length + 1));
          offenders.push(`${needle.label}: ${hits} hit(s) in ${where.join(", ")}`);
        }
        expect(offenders, `${offenders.length} marking-material leaks under ${mode.dir}`).toEqual(
          [],
        );
      });
    });
  }

  /**
   * The exact-secret half. It runs only where an operational instrument is
   * readable — nowhere in this repository, by design — so it is a
   * describe.skipIf rather than a silent no-op: a skipped test says so in the
   * report, and the structural scan above is what guards this repo.
   */
  describe.skipIf(OPERATIONAL === undefined)("the needles themselves", () => {
    it("covers every judge prompt in the operational instrument", () => {
      const prompts = OPERATIONAL!.instrument.tracks
        .filter((t) => JUDGED_TRACKS.includes(t.trackId))
        .flatMap((t) => (t.prompts ?? []).map((p) => `${t.trackId} ${p.filename}`));
      // 3 judged tracks x en/ja/ko today. A track that lost its prompts would
      // silently shrink the guard, so assert the coverage, not just the count.
      expect(prompts.length).toBeGreaterThanOrEqual(9);
      const labels = new Set(MARKING_NEEDLES.map((n) => n.label));
      for (const p of prompts) expect(labels.has(p), `no needle for ${p}`).toBe(true);
    });

    it("covers every rubric description and band anchor, in every track", () => {
      // The public view strips both from all four tracks. A needle set that
      // silently missed one would let the next regression ship.
      const labels = new Set(MARKING_NEEDLES.map((n) => n.label));
      let described = 0;
      let anchored = 0;
      for (const track of OPERATIONAL!.instrument.tracks) {
        for (const c of track.rubric?.criteria ?? []) {
          if ((c.description ?? "").length < MIN_NEEDLE_CHARS) continue;
          described += 1;
          expect(labels.has(`${track.trackId} rubric ${c.id}`), `no needle for ${c.id}`).toBe(true);
        }
        for (const a of track.rubric?.band_anchors ?? []) {
          if ((a.anchor ?? "").length < MIN_NEEDLE_CHARS) continue;
          anchored += 1;
          expect(labels.has(`${track.trackId} band ${a.band}`), `no needle for ${a.band}`).toBe(
            true,
          );
        }
      }
      // 4 tracks x 3-4 criteria, and 4 bands on each of the four rubrics.
      expect(described).toBeGreaterThanOrEqual(15);
      expect(anchored).toBeGreaterThanOrEqual(16);
    });

    it("every needle survives the bundle's escaping", () => {
      expect(MARKING_NEEDLES.length).toBeGreaterThan(0);
      for (const n of MARKING_NEEDLES) {
        expect(n.value, n.label).not.toMatch(/["\\\n]/);
        expect(n.value.length, n.label).toBeGreaterThanOrEqual(MIN_NEEDLE_CHARS);
        // Raw and JSON-escaped must be the same bytes, or the double-escaped
        // snapshot in the bundle would hide the secret from this scan.
        expect(JSON.stringify(n.value).slice(1, -1), n.label).toEqual(n.value);
      }
    });

    it("takes nothing from the released-practice tier, so the demo cannot self-trip", () => {
      // instruments/demo-2026.1 publishes item keys on purpose, and
      // apps/web/lib/instrument/instrument.ts publishes T3_SCENARIO as the released
      // PRACTICE scenario. Both are meant to be in the bundle; if a needle
      // came from either, this guard would fail on a correct build forever.
      const published = JSON.stringify(T3_SCENARIO) + readFileSync(DEMO_BANK, "utf8");
      for (const n of MARKING_NEEDLES) {
        expect(published.includes(n.value), `${n.label} is published practice content`).toBe(false);
      }
    });
  });

  /**
   * Unconditional, because the extractor must not rot while it is unused, and
   * because the shape probes must be proved to bite.
   */
  describe("the guard machinery itself", () => {
    it("extracts T3 plants and the T4 brief when the instrument carries them", () => {
      // The operational T3 scenario and T4 brief live with the exam service,
      // not in this public repo, so prove the EXTRACTOR rather than trusting
      // that today's file happens to contain them.
      const synthetic: OperationalSnapshot = {
        instrument: {
          tracks: [
            {
              trackId: "t3-reasoning",
              config: {
                scenario: {
                  brief: "Advise the minister on whether to adopt the pooled assessor panel in 2031.",
                  source_excerpt:
                    "Section 9.4 of the operational source document, withheld from the sitting view.",
                  planted_errors: [
                    {
                      id: "pe-op",
                      claim: "The operational memorandum reports a median wait of 77 months in 2029.",
                      truth: "Section 3.2 of the operational source states the median wait was 41 months.",
                    },
                  ],
                },
              },
            },
            {
              trackId: "t4-generative",
              config: {
                brief: "Direct a launch campaign for the operational client, three finals plus one film.",
                audience: "Operational panel reviewers who never see the candidate name.",
              },
            },
          ],
        },
      };
      const labels = markingNeedles(synthetic).map((n) => n.label);
      expect(labels).toEqual([
        "t3-reasoning plant pe-op claim",
        "t3-reasoning plant pe-op truth",
        "t3-reasoning scenario.brief",
        "t3-reasoning scenario.source_excerpt",
        "t4-generative config.brief",
        "t4-generative config.audience",
      ]);
    });

    /**
     * The pre-78e3cef snapshot, in miniature: a judge prompt, a band anchor
     * and a criterion description. Every shape probe must fire on it, in BOTH
     * the raw and the double-escaped form a Next bundle stores. If one stopped
     * firing, the guard would go quiet exactly when it was needed.
     */
    const leaked = JSON.stringify({
      instrument: {
        tracks: [
          {
            trackId: "t3-reasoning",
            prompts: [
              {
                locale: "en",
                filename: "screening.en.md",
                content: "---\nlocale: en\ntranslation_provenance: source\n---\nJudge it.\n",
              },
            ],
            rubric: {
              criteria: [
                { id: "analysis-quality", name: "Analysis quality", points: 45, scored_by: "jury", judged: true, description: "how to mark it" },
                { id: "process-quality", name: "Process quality", points: 20, scored_by: "arithmetic", judged: false, description: "how to mark it" },
              ],
              band_anchors: [{ band: "distinction", min_scaled: 70, anchor: "what good looks like" }],
            },
          },
        ],
      },
    });

    it("every mark-scheme shape fires on a snapshot that carries one", () => {
      for (const form of [leaked, JSON.stringify(leaked)]) {
        const flat = form.replace(/\\/g, "");
        for (const shape of MARK_SCHEME_SHAPES) {
          expect(flat.includes(shape.value), `${shape.label} missed`).toBe(true);
        }
      }
    });

    it("no mark-scheme shape fires on the snapshot the browser really gets", () => {
      // The committed public snapshot. A probe that also matched this would
      // fail every correct build forever, which is the other way to lose a guard.
      const publicSnapshot = readFileSync(
        fileURLToPath(new URL("../../../instruments/demo-2026.1/snapshot.json", import.meta.url)),
        "utf8",
      );
      for (const form of [publicSnapshot, JSON.stringify(publicSnapshot)]) {
        const flat = form.replace(/\\/g, "");
        for (const shape of MARK_SCHEME_SHAPES) {
          expect(flat.includes(shape.value), `${shape.label} self-trips`).toBe(false);
        }
      }
    });

    it("the id allowance catches a foreign item in either escaping", () => {
      const foreign = "f".repeat(64);
      const one = released[0].id;
      for (const form of [`"id":"${one}" "id":"${foreign}"`, JSON.stringify(`"id":"${foreign}"`)]) {
        const bundled = bundledItemIds(form);
        expect([...bundled].filter((id) => !RELEASED_IDS.has(id))).toEqual([foreign]);
      }
      // ...and does not fire on a released id.
      expect([...bundledItemIds(`"id":"${one}"`)].filter((id) => !RELEASED_IDS.has(id))).toEqual([]);
    });
  });
});


/**
 * WHAT MAY BE IN `apps/web/public` — an inventory, not a scan (TEN-113/TEN-117).
 *
 * The leak this guard exists to stop arrived as BYTES, not as a string: 56
 * JPEGs shipped from a public repository while the released-practice tier
 * referenced 6 of them. No probe above could see it — wrong directory, wrong
 * file class — so the rule here is stated the other way round, as an ALLOWANCE:
 *
 *   every file under apps/web/public must be named by a committed manifest of
 *   the released-practice site, or by one of the two literal lists below.
 *
 * The lists are frozen and each says why it exists. A file that belongs to no
 * manifest and no list fails the build, which is the property that was missing:
 * the next asset cannot arrive quietly.
 */
const REPO_ROOT = new URL("../../../", import.meta.url);
const readRepo = (path: string): string => readFileSync(fileURLToPath(new URL(path, REPO_ROOT)), "utf8");

/** Media the RELEASED-PRACTICE tier deals, read from the committed snapshot. */
function releasedMediaRefs(): string[] {
  const snapshot = readRepo("instruments/demo-2026.1/snapshot.json");
  return [...snapshot.matchAll(/"src":\s*"(t2-media\/[0-9a-f]{12}\.jpg)"/g)].map((m) => m[1]);
}

/** The unscored practice drill, read from its committed corpus manifest. */
function practiceMediaRefs(): string[] {
  const corpus = JSON.parse(readRepo("instruments/practice/2026.1/corpus.json")) as {
    items: Array<{ material?: { src?: string } }>;
  };
  return corpus.items.map((i) => i.material?.src ?? "").filter((s) => s.startsWith("practice-media/"));
}

/** The sixteen player-type characters, read from their committed manifest. */
function characterRefs(): string[] {
  const manifest = JSON.parse(readRepo("instruments/characters/2026.1/characters.json")) as {
    characters: Array<{ src?: string }>;
  };
  return manifest.characters.map((ch) => ch.src ?? "").filter((s) => s.startsWith("characters/"));
}

/**
 * Site chrome: decorative, aria-hidden, never an exam item. Listed by hand
 * because no manifest deals it — which is exactly why it is listed by hand.
 */
const SITE_CHROME: readonly string[] = [
  "media/backdrops.provenance.json",
  "media/campus-map.jpg",
  "media/hero-desk.jpg",
  "media/hero-desk.provenance.json",
  "media/loader-mark.svg",
  "media/logo.svg",
  "media/pastoral.jpg",
];

/**
 * The t2-media pool this repo ships but does not deal: the frontend is the
 * origin the exam service's own form fetches from, so the bytes stayed here
 * when the bank left (TEN-113). Frozen at 50 files on 2026-09-04. It may only
 * SHRINK — moving custody to the exam service empties it — and a 51st file
 * fails the inventory instead of arriving unremarked.
 */
const T2_POOL_HELD: readonly string[] = [
  "1207a651eed5.jpg",
  "1ac81826d931.jpg",
  "24dfeb021b56.jpg",
  "300c5808768e.jpg",
  "32dfed510acc.jpg",
  "369c4dcde8bd.jpg",
  "3a6837119bc7.jpg",
  "3bf3d45bb71c.jpg",
  "3ce7bae3a765.jpg",
  "3da5c976002b.jpg",
  "404046269a4a.jpg",
  "4aad445d8709.jpg",
  "4bad2746a646.jpg",
  "4d1f26e07cd5.jpg",
  "636f536bab7f.jpg",
  "6ccbc0a589b2.jpg",
  "71a822c8f181.jpg",
  "759aad647cec.jpg",
  "78bb42ab69f4.jpg",
  "7bb12d1723c7.jpg",
  "86516c937b4f.jpg",
  "8bdea735e794.jpg",
  "8efac43f3d63.jpg",
  "93f2785ed7d3.jpg",
  "99a3b7744279.jpg",
  "9b48289591d6.jpg",
  "a1da11b10d5e.jpg",
  "a3915ea73984.jpg",
  "a45d95027410.jpg",
  "a6499cd29190.jpg",
  "a7897c69b204.jpg",
  "a7c31c9a6b67.jpg",
  "b69e9e8858fd.jpg",
  "be810838ac5d.jpg",
  "bf9752342194.jpg",
  "c0112dc52e10.jpg",
  "c83b09b13caf.jpg",
  "c9c0a56c620e.jpg",
  "cc46563e0668.jpg",
  "d400e472872f.jpg",
  "d9e10c4ce1bd.jpg",
  "da96373f7c16.jpg",
  "de474801736c.jpg",
  "e621151fccb4.jpg",
  "eb9b7d51d61d.jpg",
  "f729f0c0bed1.jpg",
  "f98af2483f40.jpg",
  "fb1ff0b6a97d.jpg",
  "fbfc86e5c2c6.jpg",
  "fcd27045eaab.jpg",
];

function allowedPublicFiles(): Set<string> {
  return new Set<string>([
    ...releasedMediaRefs(),
    ...practiceMediaRefs(),
    ...characterRefs(),
    ...SITE_CHROME,
    ...T2_POOL_HELD.map((f) => `t2-media/${f}`),
  ]);
}

/** Repo-relative, slash-separated, so the assertion reads the same on Windows. */
function walkAllFiles(dir: string, base: string = dir, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkAllFiles(full, base, out);
    else out.push(full.slice(base.length + 1).split(sep).join("/"));
  }
  return out;
}

/** Pure, so both directions can be proved on a synthetic tree below. */
function unaccounted(shipped: readonly string[], allowed: ReadonlySet<string>): string[] {
  return shipped.filter((f) => !allowed.has(f)).sort();
}
function missing(shipped: readonly string[], allowed: ReadonlySet<string>): string[] {
  const have = new Set(shipped);
  return [...allowed].filter((f) => !have.has(f)).sort();
}

describe("apps/web/public ships only what the released-practice site accounts for", () => {
  const shipped = walkAllFiles(PUBLIC_DIR);
  const allowed = allowedPublicFiles();

  it("reads its allowance from the committed manifests, not from the tree", () => {
    // A manifest that stopped resolving would empty the allowance and turn
    // this guard into a blanket failure, or — worse, if it were written as a
    // blacklist — into a green light.
    expect(releasedMediaRefs().length).toBeGreaterThan(0);
    expect(practiceMediaRefs().length).toBeGreaterThan(0);
    expect(characterRefs().length).toBe(16);
    expect(shipped.length).toBeGreaterThan(0);
  });

  it("ships no file that no manifest and no frozen list accounts for", () => {
    const extra = unaccounted(shipped, allowed);
    expect(
      extra.slice(0, 20),
      `${extra.length} unaccounted file(s) under apps/web/public`,
    ).toEqual([]);
  });

  it("ships every file its manifests promise", () => {
    const gone = missing(shipped, allowed);
    expect(gone.slice(0, 20), `${gone.length} manifest reference(s) not shipped`).toEqual([]);
  });

  it("holds exactly the frozen t2-media pool, and it may only shrink", () => {
    const pool = shipped.filter((f) => f.startsWith("t2-media/"));
    const dealt = new Set(releasedMediaRefs());
    const held = pool.filter((f) => !dealt.has(f)).sort();
    expect(held).toEqual([...T2_POOL_HELD].map((f) => `t2-media/${f}`).sort());
  });


  it("docs/CREDITS.md attributes the t2-media pool without classifying it", () => {
    // The bytes are only half of TEN-113. The other half was a per-file
    // column beside them in a public markdown table. Attribution stays;
    // a per-file classification of an exam stimulus may not come back.
    const credits = readRepo("docs/CREDITS.md");
    const section = credits.slice(
      credits.indexOf("# Image credits"),
      credits.indexOf("# Practice corpus credits"),
    );
    expect(section.length).toBeGreaterThan(1000);
    const offenders = section
      .split("\n")
      .filter((line) => /^\|\s*`?[0-9a-f]{12}\.jpg/.test(line))
      .filter((line) =>
        line
          .split("|")
          .map((cell) => cell.trim())
          .some((cell) => cell === "AI-generated" || cell === "Photograph"),
      );
    expect(offenders.length, "per-file classification back in the t2-media table").toBe(0);
    // ...and the pool really is still attributed, or the check passes vacuously.
    expect(
      section.split("\n").filter((l) => /^\|\s*`[0-9a-f]{12}\.jpg`/.test(l)),
    ).toHaveLength(56);
  });

  describe("the inventory machinery itself", () => {
    it("names a planted file, whatever its extension", () => {
      const tree = ["t2-media/aaaaaaaaaaaa.jpg", "offline-bank.json", "notes.md"];
      const allow = new Set(["t2-media/aaaaaaaaaaaa.jpg"]);
      expect(unaccounted(tree, allow)).toEqual(["notes.md", "offline-bank.json"]);
      expect(missing(tree, allow)).toEqual([]);
    });

    it("names a manifest reference that is not on disk", () => {
      const allow = new Set(["characters/aaaaaaaaaaaa.jpg"]);
      expect(missing([], allow)).toEqual(["characters/aaaaaaaaaaaa.jpg"]);
    });

    it("fires on the tree as it stood before TEN-113", () => {
      // 6 dealt + 50 held: with the pool unaccounted, every one of the 50 is
      // named. This is the failure the guard would have produced on 2026-09-04.
      const before = [...Array(56).keys()].map((i) => `t2-media/${String(i).padStart(12, "0")}.jpg`);
      const dealtOnly = new Set(before.slice(0, 6));
      expect(unaccounted(before, dealtOnly)).toHaveLength(50);
    });
  });
});
