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
import { T3_SCENARIO } from "../lib/instrument";

const BANK = fileURLToPath(
  new URL(
    "../../../instruments/2026.1/tracks/t2-discrimination/items/bank.jsonl",
    import.meta.url,
  ),
);

/**
 * The OPERATIONAL instrument, read at test time. Every needle below comes from
 * it, never from a literal in this file: a test that pins one leaked string
 * only guards that string, and tomorrow's judge prompt would leak unwatched.
 *
 * It is also the reason the demo does not self-trip. The released-practice
 * tier publishes item keys on purpose, and `apps/web/lib/instrument.ts`
 * publishes the T3 practice scenario on purpose; neither may supply a needle.
 */
const OPERATIONAL_SNAPSHOT = fileURLToPath(
  new URL("../../../instruments/2026.1/snapshot.json", import.meta.url),
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

const OPERATIONAL = JSON.parse(
  readFileSync(OPERATIONAL_SNAPSHOT, "utf8"),
) as OperationalSnapshot;
const MARKING_NEEDLES = markingNeedles(OPERATIONAL);

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

  describe("the needles themselves", () => {
    it("covers every judge prompt in the operational instrument", () => {
      const prompts = OPERATIONAL.instrument.tracks
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
      for (const track of OPERATIONAL.instrument.tracks) {
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

    it("takes nothing from the released-practice tier, so the demo cannot self-trip", () => {
      // instruments/demo-2026.1 publishes item keys on purpose, and
      // apps/web/lib/instrument.ts publishes T3_SCENARIO as the released
      // PRACTICE scenario. Both are meant to be in the bundle; if a needle
      // came from either, this guard would fail on a correct build forever.
      const published = JSON.stringify(T3_SCENARIO) + readFileSync(DEMO_BANK, "utf8");
      for (const n of MARKING_NEEDLES) {
        expect(published.includes(n.value), `${n.label} is published practice content`).toBe(false);
      }
    });
  });
});
