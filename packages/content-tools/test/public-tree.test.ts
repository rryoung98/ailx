/**
 * The public tree may hold ONE instrument, and it must be the redacted one.
 *
 * `instruments/2026.1` — 84 keyed T2 items, the T1/T3/T4 judge prompts and the
 * rubric marking detail — moved to the private backend repo. The released tier
 * used to reach into it through symlinks, so making it self-contained was one
 * `cp -rL` away from re-publishing exactly what commit 78e3cef removed from
 * the browser bundle.
 *
 * This file is the standing guard on that. It walks `instruments/` as a
 * DIRECTORY, not as a list of known paths, so a leak cannot hide behind a new
 * name: any manifest, any rubric, any prompt, any snapshot, anywhere under it.
 */
import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { loadInstrument, InstrumentValidationError } from "../src/loader.js";
import { buildSnapshot } from "../src/snapshot.js";

const INSTRUMENTS = fileURLToPath(new URL("../../../instruments", import.meta.url));
const DEMO_DIR = join(INSTRUMENTS, "demo-2026.1");
const TRACKS = fileURLToPath(new URL("../../tracks", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__pycache__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(INSTRUMENTS);
const dirs = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(full);
      dirs(full, out);
    }
  }
  return out;
};
const allDirs = dirs(INSTRUMENTS);

const rel = (p: string) => p.slice(INSTRUMENTS.length + 1);

describe("no operational instrument content lives in the public repo", () => {
  it("scanned a real tree (guards against an empty-walk pass)", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith("manifest.yaml"))).toBe(true);
  });

  it("has no operational tier, under that name or any other", () => {
    expect(existsSync(join(INSTRUMENTS, "2026.1"))).toBe(false);
    // Every manifest in the tree must declare itself redacted. A second,
    // unredacted instrument package is the leak wearing a different directory.
    const manifests = files.filter((f) => f.endsWith("manifest.yaml"));
    expect(manifests.map(rel)).toEqual(["demo-2026.1/manifest.yaml"]);
    for (const m of manifests) {
      const doc = parse(readFileSync(m, "utf8")) as { redacted?: unknown };
      expect(doc.redacted, `${rel(m)} is not marked redacted`).toBe(true);
    }
  });

  it("carries no judge prompt — no prompts/ directory and no prompt front matter", () => {
    expect(allDirs.filter((d) => d.endsWith("/prompts")).map(rel)).toEqual([]);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const head = readFileSync(f, "utf8").slice(0, 400);
      expect(
        /^---\n[\s\S]*translation_provenance/.test(head),
        `${rel(f)} looks like a judge prompt`,
      ).toBe(false);
    }
  });

  it("carries no rubric marking detail — no description, no band_anchors", () => {
    const rubrics = files.filter((f) => f.endsWith("rubric.yaml"));
    // Four tracks. A zero here would make the loop vacuous.
    expect(rubrics.length).toBe(4);
    for (const f of rubrics) {
      const doc = parse(readFileSync(f, "utf8")) as {
        band_anchors?: unknown;
        criteria: Array<Record<string, unknown>>;
      };
      expect(doc.band_anchors, rel(f)).toBeUndefined();
      for (const c of doc.criteria) {
        expect(Object.keys(c).sort(), `${rel(f)} ${String(c.id)}`).toEqual([
          "id", "judged", "name", "points", "scored_by",
        ]);
      }
    }
  });

  it("no symlink reaches out of the tree (the old 2026.1 links are gone)", () => {
    for (const p of [...files, ...allDirs]) {
      // lstat via statSync would follow; readdir gave us real entries, and a
      // dangling symlink would already have thrown in walk(). Assert the
      // stronger property instead: everything resolves inside instruments/.
      expect(p.startsWith(INSTRUMENTS), p).toBe(true);
    }
  });

  it("the committed snapshot carries nothing the sources no longer have", () => {
    const snaps = files.filter((f) => f.endsWith("snapshot.json"));
    expect(snaps.map(rel)).toEqual(["demo-2026.1/snapshot.json"]);
    for (const f of snaps) {
      const snap = JSON.parse(readFileSync(f, "utf8")) as {
        instrument: {
          manifest: { redacted?: boolean };
          tracks: Array<{
            prompts: unknown[];
            rubric: { criteria: Array<Record<string, unknown>>; band_anchors?: unknown };
            bank?: { items: Array<Record<string, unknown>> };
          }>;
        };
      };
      expect(snap.instrument.manifest.redacted).toBe(true);
      for (const t of snap.instrument.tracks) {
        expect(t.prompts).toEqual([]);
        expect(t.rubric.band_anchors).toBeUndefined();
        for (const c of t.rubric.criteria) expect(c.description).toBeUndefined();
        for (const i of t.bank?.items ?? []) expect(i.provenance).toBeUndefined();
      }
    }
  });

  it("the committed snapshot is exactly what the documented script rebuilds", () => {
    // Hand-editing the JSON is the other way marking material could come back.
    const built = JSON.stringify(
      buildSnapshot(DEMO_DIR, { tracksRoot: TRACKS, public: true }), null, 2,
    ) + "\n";
    expect(built).toEqual(readFileSync(join(DEMO_DIR, "snapshot.json"), "utf8"));
  });
});

/**
 * WHAT MAY BE IN `instruments/` — an inventory, not a pattern match (TEN-236).
 *
 * Every assertion above constrains a KNOWN name: a manifest, a rubric, a
 * prompts directory, the snapshot. A new directory carrying `bank.jsonl` with
 * keys in it and no manifest matches none of them and passed the whole file.
 * Two unconstrained directories already live here (`practice/`, `characters/`),
 * so that is the shape a mistake would take.
 *
 * The rule is therefore stated as an ALLOWANCE, the way
 * `apps/web/test/bundleSecrecy.test.ts` states it for `apps/web/public`:
 *
 *   every file under instruments/ is named by a committed manifest, or by the
 *   frozen list below, which says why each entry is there.
 */

/** The demo package's own files, read from its manifest and its track files. */
function manifestedInstrumentFiles(): string[] {
  const manifest = parse(readFileSync(join(DEMO_DIR, "manifest.yaml"), "utf8")) as {
    tracks?: string[];
  };
  const named = ["demo-2026.1/manifest.yaml"];
  for (const track of manifest.tracks ?? []) {
    const dir = `demo-2026.1/tracks/${track}`;
    named.push(`${dir}/track.yaml`, `${dir}/rubric.yaml`);
    const doc = parse(
      readFileSync(join(INSTRUMENTS, dir, "track.yaml"), "utf8"),
    ) as { config?: { demo_bank?: string } };
    // A bank is only allowed here because the track file DEALS it.
    if (doc.config?.demo_bank !== undefined) named.push(`${dir}/${doc.config.demo_bank}`);
  }
  return named;
}

/**
 * Everything no manifest deals. Frozen, and each entry says why — a file that
 * belongs to no manifest and no line here fails the build, which is the
 * property that was missing.
 */
const FROZEN_INSTRUMENT_FILES: readonly string[] = [
  // The package's own documentation, and the built artefact the browser loads.
  // Both are constrained by the assertions above, byte for byte.
  "demo-2026.1/README.md",
  "demo-2026.1/snapshot.json",
  // The demo bank's integrity sidecars: a checksum over bank.jsonl and the
  // dated link check over the URLs its items cite. No item content.
  "demo-2026.1/tracks/t2-discrimination/items/bank.sha256",
  "demo-2026.1/tracks/t2-discrimination/items/link-check.json",
  // The UNSCORED practice drill. Not an instrument package: its corpus is its
  // own committed manifest, and apps/web/test/bundleSecrecy.test.ts reads it.
  "practice/2026.1/README.md",
  "practice/2026.1/corpus.json",
  "practice/2026.1/curation.json",
  "practice/2026.1/generated.json",
  "practice/2026.1/tools/build-practice-corpus.py",
  "practice/2026.1/tools/generate-practice-images.py",
  // The sixteen player-type characters: art direction and a vetting ledger,
  // dealt to nobody and scored by nothing.
  "characters/2026.1/README.md",
  "characters/2026.1/cast.json",
  "characters/2026.1/characters.json",
  "characters/2026.1/generated.json",
  "characters/2026.1/tools/build-characters.py",
  "characters/2026.1/tools/generate-character-images.py",
  // Shared generation tooling. Python, run by hand, holds no item.
  "tools/commons_media.py",
  "tools/generation_ledger.py",
  "tools/openrouter_images.py",
];

/** Pure, so both directions are provable on a synthetic tree. */
function unaccounted(present: readonly string[], allowed: ReadonlySet<string>): string[] {
  return present.filter((f) => !allowed.has(f)).sort();
}
function missing(present: readonly string[], allowed: ReadonlySet<string>): string[] {
  const have = new Set(present);
  return [...allowed].filter((f) => !have.has(f)).sort();
}

describe("instruments/ holds only what a manifest or the frozen list names", () => {
  const present = files.map(rel).map((f) => f.split(sep).join("/"));
  const manifested = manifestedInstrumentFiles();
  const allowed = new Set([...manifested, ...FROZEN_INSTRUMENT_FILES]);

  it("reads its allowance from the committed manifest, not from the tree", () => {
    // A manifest that stopped resolving would empty the allowance and turn
    // this guard into a blanket failure — or, written the other way round,
    // into a green light.
    expect(manifested).toContain("demo-2026.1/manifest.yaml");
    expect(manifested).toContain("demo-2026.1/tracks/t2-discrimination/items/bank.jsonl");
    expect(manifested.length).toBe(1 + 4 * 2 + 1);
    expect(present.length).toBeGreaterThan(10);
  });

  it("carries no file that no manifest and no frozen list accounts for", () => {
    const extra = unaccounted(present, allowed);
    expect(extra.slice(0, 20), `${extra.length} unaccounted file(s) under instruments/`).toEqual([]);
  });

  it("carries every file the manifest and the frozen list promise", () => {
    const gone = missing(present, allowed);
    expect(gone.slice(0, 20), `${gone.length} named file(s) not on disk`).toEqual([]);
  });

  describe("the inventory machinery itself", () => {
    it("names an unmanifested keyed bank under a new instruments directory", () => {
      // The exact shape TEN-236 describes, and the shape every other
      // assertion in this file is blind to.
      const planted = "2027.1/tracks/t2-discrimination/items/bank.jsonl";
      expect(unaccounted([...present, planted], allowed)).toEqual([planted]);
    });

    it("names a planted file whatever its extension, and a promise not kept", () => {
      const allow = new Set(["demo-2026.1/manifest.yaml"]);
      expect(unaccounted(["demo-2026.1/manifest.yaml", "keys.csv"], allow)).toEqual(["keys.csv"]);
      expect(missing([], allow)).toEqual(["demo-2026.1/manifest.yaml"]);
    });
  });
});

describe("the redacted loader refuses marking material coming back", () => {
  const withCopy = (mutate: (dir: string) => void): (() => void) => () => {
    const dir = mkdtempSync(join(tmpdir(), "ailx-redacted-"));
    try {
      cpSync(DEMO_DIR, dir, { recursive: true });
      mutate(dir);
      loadInstrument(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const RUBRIC = join("tracks", "t3-reasoning", "rubric.yaml");

  it("loads the committed tier as it stands", () => {
    const pkg = loadInstrument(DEMO_DIR);
    expect(pkg.manifest.redacted).toBe(true);
    expect(pkg.tracks.map((t) => t.trackId)).toEqual([
      "t1-creative-build", "t2-discrimination", "t3-reasoning", "t4-generative",
    ]);
    // Judged criteria with no prompts is the WHOLE point of the tier.
    expect(pkg.tracks.some((t) => t.rubric.criteria.some((c) => c.judged))).toBe(true);
    for (const t of pkg.tracks) {
      expect(t.prompts).toEqual([]);
      expect(t.rubric.band_anchors).toBeUndefined();
      expect(t.rubricVersion).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("refuses a criterion description", () => {
    expect(
      withCopy((dir) => {
        const p = join(dir, RUBRIC);
        writeFileSync(
          p,
          readFileSync(p, "utf8").replace(
            "    judged: true\n",
            "    judged: true\n    description: how a judge is told to mark this\n",
          ),
        );
      }),
    ).toThrow(/carries a 'description'/);
  });

  it("refuses band anchors", () => {
    expect(
      withCopy((dir) => {
        const p = join(dir, RUBRIC);
        writeFileSync(
          p,
          readFileSync(p, "utf8") +
            "band_anchors:\n  - band: distinction\n    min_scaled: 70\n    anchor: what a distinction looks like\n",
        );
      }),
    ).toThrow(/band_anchors/);
  });

  it("refuses a prompts directory", () => {
    expect(
      withCopy((dir) => {
        const p = join(dir, "tracks", "t3-reasoning", "prompts");
        mkdirSync(p);
        writeFileSync(
          join(p, "screening.en.md"),
          "---\nlocale: en\ntranslation_provenance: source\n---\nJudge the analysis.\n",
        );
      }),
    ).toThrow(/carries judge prompts/);
  });

  it("still refuses a rubric whose points do not sum (redaction relaxes nothing else)", () => {
    expect(
      withCopy((dir) => {
        const p = join(dir, RUBRIC);
        writeFileSync(p, readFileSync(p, "utf8").replace("    points: 50\n", "    points: 51\n"));
      }),
    ).toThrow(InstrumentValidationError);
  });
});
