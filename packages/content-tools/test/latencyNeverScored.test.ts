/**
 * THE LATENCY GUARD: no scored quantity may depend on a clock.
 *
 * Why this is a test and not a rule in a document. Hassenstab's group
 * (Nicosia et al., *Behavior Research Methods* 2023;55(6):2800-2812, DOI
 * 10.3758/s13428-022-01925-1) measured 26 popular smartphones with a timing
 * robot and found total device latency — display plus touch — ranging from
 * 35 ms to 140 ms, and their own BYOD table puts the spread across a full
 * bring-your-own-device study at about 105 ms. More expensive phones were
 * faster (r_s = -0.47 and -0.44 against display latency, p < .05), so the
 * spread tracks income. Our sampling half-width at n = 1,500 and deff 1.6 is
 * ±0.064 SD (docs/SAMPLING.md §4, our arithmetic), so a device effect above
 * roughly 0.06 SD is a bigger error term than the entire sampling error. A
 * scored quantity that moves with a handset's speed would put that effect
 * inside the number itself, where no amount of reporting can take it out.
 *
 * What is guarded: the score() import closure of every track, discovered by
 * the same walk that builds the audit digest (`scorerRecordsIn`), so a scorer
 * that starts delegating to a new module cannot slip out of this check either.
 * Every file in that closure is refused if it READS a timing quantity or a
 * clock.
 *
 * DECLARING a timing field is allowed, and that distinction is deliberate:
 * `latencyMs` is recorded on every T2 response and exported for research
 * (packages/report/src/exportTiers.ts). Recording it is fine. Scoring it is
 * not. So the ban is on member reads (`r.latencyMs`), on destructuring a
 * timing field out of an object, and on the clock itself.
 *
 * BLIND SPOTS, stated rather than implied. This reads source text, so it
 * cannot see a timing quantity reached through a computed key
 * (`r["latency" + "Ms"]`), one renamed at the boundary before score() is
 * called, or one smuggled inside a field this list does not name. The
 * behavioural half of the guard is `apps/web/test/latencyNeverScored.test.ts`,
 * which perturbs the stored timings and demands the same score; the two
 * together are the enforcement, and neither is a sandbox.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scorerRecordsIn } from "../src/scorers.js";

const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
const TRACKS = join(PACKAGES, "tracks");

/**
 * Timing fields a scorer may not READ. Names, not patterns: a list somebody
 * has to add to on purpose is easier to review than a regex over "time".
 */
const TIMING_FIELDS = [
  "latencyMs",
  "activeMs",
  "runningSince",
  "elapsedMs",
  "durationMs",
  "tRelMs",
  "shownAt",
  "timedOut",
  "exposureSeconds",
  "budgetSeconds",
  "activeSeconds",
];

/**
 * `clientTs` is deliberately NOT in that list. Two tracks copy it through
 * ingest normalisation (`packages/tracks/t4-generative/src/plugin.ts`), which
 * lives in the closure because `plugin.ts` is the entry, and a copy is not a
 * read that decides anything. Banning it here would buy a false positive and
 * a snapshot regeneration. It is covered instead by the behavioural guard,
 * which moves every stored `clientTs` and demands the same score.
 */

/** Clock reads. `score()` is already pure at runtime (purity.ts); this is the
 *  static half, and it catches a clock captured at module load. */
const CLOCK_READS = [
  /\bDate\s*\.\s*now\b/,
  /\bperformance\s*\.\s*now\b/,
  /\bnew\s+Date\s*\(\s*\)/,
  /\bhrtime\b/,
];

/** Where a package's source lives, by package name (`@ailx/core`). */
function packageDirByName(): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(PACKAGES, entry.name);
    for (const candidate of [dir, ...readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name))]) {
      try {
        const name = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")).name;
        if (typeof name === "string" && !out.has(name)) out.set(name, candidate);
      } catch {
        // not a package directory
      }
    }
  }
  return out;
}

/** Absolute path of one hashed source file, own or package-qualified. */
function resolveSource(trackPackage: string, path: string, dirs: Map<string, string>): string {
  if (!path.startsWith("@")) {
    const dir = dirs.get(trackPackage);
    if (!dir) throw new Error(`no directory for ${trackPackage}`);
    return join(dir, path);
  }
  const [scope, name, ...rest] = path.split("/");
  const pkg = `${scope}/${name}`;
  const dir = dirs.get(pkg);
  if (!dir) throw new Error(`no directory for ${pkg}`);
  return join(dir, ...rest);
}

/** Source with comments stripped: a comment may name a timing field freely. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

interface Offence {
  file: string;
  line: number;
  text: string;
}

function offences(file: string, source: string): Offence[] {
  const out: Offence[] = [];
  const lines = code(source).split("\n");
  lines.forEach((line, i) => {
    for (const field of TIMING_FIELDS) {
      const read = new RegExp(`\\.\\s*${field}\\b`);
      // `const { latencyMs } = r` and `({ latencyMs })` — a destructuring read.
      const destructured = new RegExp(`\\{[^{}]*\\b${field}\\b[^{}]*\\}\\s*(=|:)`);
      if (read.test(line) || destructured.test(line)) {
        out.push({ file, line: i + 1, text: line.trim() });
      }
    }
    for (const clock of CLOCK_READS) {
      if (clock.test(line)) out.push({ file, line: i + 1, text: line.trim() });
    }
  });
  return out;
}

describe("no scored quantity depends on a clock", () => {
  const dirs = packageDirByName();
  const records = scorerRecordsIn(TRACKS);

  it("finds all four tracks (the guard is worthless if the walk finds nothing)", () => {
    expect(records.map((r) => r.trackId).sort()).toEqual(["t1", "t2", "t3", "t4"]);
    for (const r of records) expect(r.sources.length).toBeGreaterThan(0);
  });

  it("hashes the shared half too, so @ailx/core is inside the guard", () => {
    const shared = records.flatMap((r) => r.sources.filter((s) => s.path.startsWith("@ailx/")));
    expect(shared.length).toBeGreaterThan(0);
  });

  for (const record of scorerRecordsIn(TRACKS)) {
    it(`${record.trackId}: no timing field or clock is read in the score() closure`, () => {
      const found: Offence[] = [];
      for (const source of record.sources) {
        const file = resolveSource(record.packageName, source.path, dirs);
        found.push(...offences(source.path, readFileSync(file, "utf8")));
      }
      expect(
        found,
        found.map((o) => `${o.file}:${o.line}  ${o.text}`).join("\n"),
      ).toEqual([]);
    });
  }

  it("catches a timing read, a destructured one, and a clock (the guard has teeth)", () => {
    expect(offences("f.ts", "const x = r.latencyMs;")).toHaveLength(1);
    expect(offences("f.ts", "const { latencyMs } = r;")).toHaveLength(1);
    expect(offences("f.ts", "const t = Date.now();")).toHaveLength(1);
    expect(offences("f.ts", "const t = performance.now();")).toHaveLength(1);
    expect(offences("f.ts", "const d = new Date();")).toHaveLength(1);
    // Declarations, writes and comments stay legal: recording a latency is
    // not scoring one.
    expect(offences("f.ts", "  latencyMs: number;")).toEqual([]);
    expect(offences("f.ts", "return { itemId, choice: -1, latencyMs: 0 };")).toEqual([]);
    expect(offences("f.ts", "// latencyMs is never read here\nconst a = 1;")).toEqual([]);
    expect(offences("f.ts", "/* r.latencyMs would be a bug */\nconst a = 1;")).toEqual([]);
  });
});
