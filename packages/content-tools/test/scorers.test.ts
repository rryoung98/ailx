/**
 * Build-time scorer source addressing (packages/content-tools/src/scorers.ts).
 *
 * The property under test is the one the old browser digest could not offer:
 * the digest moves if and only if the scoring SOURCE moves.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scorerRecord, scorerRecords, scorerRecordsIn, ScorerSourceError } from "../src/scorers.js";

const TRACKS = fileURLToPath(new URL("../../tracks", import.meta.url));

/**
 * Fake a package-manager link so a workspace dep resolves — to a version AND
 * to source, because the digest now hashes the dependency's bytes too.
 *
 * `files` defaults to a small barrel + two modules shaped like `@ailx/core`:
 * one that scoring imports (`round3`) and one that it does not (`zip`).
 */
function linkWorkspaceDep(
  dir: string,
  spec: string,
  version: string,
  files: Record<string, string> = DEP_FILES,
  manifest: Record<string, unknown> = {},
): string {
  const target = join(dir, "node_modules", ...spec.split("/"));
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "package.json"), JSON.stringify({ name: spec, version, ...manifest }));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(target, p, ".."), { recursive: true });
    writeFileSync(join(target, p), body);
  }
  return target;
}

const DEP_FILES: Record<string, string> = {
  "src/index.ts": `export * from "./rounding.js";\nexport * from "./zip.js";\n`,
  "src/rounding.ts": `export function round3(x: number) { return Math.round(x * 1000) / 1000; }\nexport const sha256Hex = (s: string) => s;\n`,
  "src/zip.ts": `export function zip() { return new Uint8Array(); }\n`,
};

/** A throwaway track package: package.json + the source files given. */
function fixture(files: Record<string, string>, ailx: unknown = { trackId: "t9", scoringEntry: "src/plugin.ts" }): string {
  // `null` means "omit the ailx block" — `undefined` would silently take the default.
  const dir = mkdtempSync(join(tmpdir(), "ailx-scorer-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "@ailx/track-t9", version: "1.2.3",
    dependencies: { "@ailx/core": "workspace:*" },
    ...(ailx === null ? {} : { ailx }),
  }));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

const PLUGIN = `import { scoreT9 } from "./score.js";
import type { Cfg } from "./types.js";
export const plugin = { id: "t9@1", score: (i: unknown, c: Cfg) => scoreT9(i, c), ui: () => import("./Runner.js") };
`;
const SCORE = `export function scoreT9(i: unknown, c: unknown) { return 1; }\n`;
const TYPES = `export interface Cfg { a: number }\n`;
const RUNNER = `export const Runner = () => null;\n`;

describe("scorerRecord", () => {
  it("hashes the whole static import closure, sorted by path", () => {
    const r = scorerRecord(fixture({
      "src/plugin.ts": PLUGIN, "src/score.ts": SCORE, "src/types.ts": TYPES, "src/Runner.tsx": RUNNER,
    }));
    expect(r.sources.map((s) => s.path)).toEqual(["src/plugin.ts", "src/score.ts", "src/types.ts"]);
    expect(r.trackId).toBe("t9");
    expect(r.packageName).toBe("@ailx/track-t9");
    expect(r.packageVersion).toBe("1.2.3");
    expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does NOT follow the dynamic ui() import — a Runner is not a scorer", () => {
    const withRunner = { "src/plugin.ts": PLUGIN, "src/score.ts": SCORE, "src/types.ts": TYPES, "src/Runner.tsx": RUNNER };
    const a = scorerRecord(fixture(withRunner));
    const b = scorerRecord(fixture({ ...withRunner, "src/Runner.tsx": "export const Runner = () => 'redesigned';\n" }));
    expect(b.digest).toBe(a.digest);
  });

  it("moves when a delegated scorer body changes", () => {
    const base = { "src/plugin.ts": PLUGIN, "src/score.ts": SCORE, "src/types.ts": TYPES };
    const a = scorerRecord(fixture(base));
    const b = scorerRecord(fixture({ ...base, "src/score.ts": "export function scoreT9() { return 2; }\n" }));
    expect(b.digest).not.toBe(a.digest);
  });

  it("moves when the package version changes, and is otherwise stable", () => {
    const base = { "src/plugin.ts": PLUGIN, "src/score.ts": SCORE, "src/types.ts": TYPES };
    const dir = fixture(base);
    const a = scorerRecord(dir);
    expect(scorerRecord(dir).digest).toBe(a.digest);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(dir, "package.json"), JSON.stringify({ ...pkg, version: "1.2.4" }));
    expect(scorerRecord(dir).digest).not.toBe(a.digest);
  });

  it("records a registry dependency at its declared range", () => {
    const dir = fixture({
      "src/plugin.ts": `import { z } from "zod";\nimport { scoreT9 } from "./score.js";\nexport const plugin = { z, scoreT9 };\n`,
      "src/score.ts": SCORE,
    });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(dir, "package.json"), JSON.stringify({ ...pkg, dependencies: { zod: "^3.1.0" } }));
    expect(scorerRecord(dir).externals).toEqual(["zod@^3.1.0"]);
  });

  /**
   * A workspace range never changes, so `@ailx/core@workspace:*` used to
   * address whatever that package happened to contain. It now holds the SCORE
   * ALLOCATION, so a re-weighting could have changed what every score means
   * without moving a single digest. The record pins the RESOLVED version.
   */
  it("records a workspace dependency at its RESOLVED version, not its range", () => {
    const dir = fixture({
      "src/plugin.ts": `import { sha256Hex } from "@ailx/core";\nimport { scoreT9 } from "./score.js";\nexport const plugin = { sha256Hex, scoreT9 };\n`,
      "src/score.ts": SCORE,
    });
    linkWorkspaceDep(dir, "@ailx/core", "9.9.9");
    expect(scorerRecord(dir).externals).toEqual(["@ailx/core@9.9.9"]);
  });

  it("moves the digest when a workspace dependency's version moves", () => {
    const mk = (version: string) => {
      const dir = fixture({
        "src/plugin.ts": `import { sha256Hex } from "@ailx/core";\nimport { scoreT9 } from "./score.js";\nexport const plugin = { sha256Hex, scoreT9 };\n`,
        "src/score.ts": SCORE,
      });
      linkWorkspaceDep(dir, "@ailx/core", version);
      return scorerRecord(dir).digest;
    };
    expect(mk("0.1.0")).not.toBe(mk("0.2.0"));
  });

  it("refuses a workspace dependency it cannot resolve, rather than guessing", () => {
    const dir = fixture({
      "src/plugin.ts": `import { sha256Hex } from "@ailx/core";\nexport const plugin = { sha256Hex };\n`,
    });
    expect(() => scorerRecord(dir)).toThrow(/no resolvable package.json version/);
  });

  it("pins the real tracks to the real @ailx/core version", () => {
    const core = JSON.parse(
      readFileSync(join(TRACKS, "..", "core", "package.json"), "utf8"),
    ) as { version: string };
    for (const r of scorerRecordsIn(TRACKS)) {
      expect(r.externals, r.trackId).toContain(`@ailx/core@${core.version}`);
    }
  });

  it("resolves extensionless and index specifiers", () => {
    const r = scorerRecord(fixture({
      "src/plugin.ts": `import "./helpers";\nimport "./nested/index.js";\nexport const plugin = {};\n`,
      "src/helpers.ts": "export const h = 1;\n",
      "src/nested/index.ts": "export const n = 1;\n",
    }));
    expect(r.sources.map((s) => s.path).sort()).toEqual(["src/helpers.ts", "src/nested/index.ts", "src/plugin.ts"]);
  });

  it("survives an import cycle", () => {
    const r = scorerRecord(fixture({
      "src/plugin.ts": `import "./a.js";\nexport const plugin = {};\n`,
      "src/a.ts": `import "./plugin.js";\nexport const a = 1;\n`,
    }));
    expect(r.sources).toHaveLength(2);
  });

  it("fails closed on a missing ailx block, a bad entry, or an unresolvable import", () => {
    expect(() => scorerRecord(fixture({ "src/plugin.ts": SCORE }, null))).toThrow(ScorerSourceError);
    expect(() => scorerRecord(fixture({}, { trackId: "t9", scoringEntry: "src/nope.ts" }))).toThrow(/not found/);
    expect(() => scorerRecord(fixture({ "src/plugin.ts": `import "./gone.js";\n` }))).toThrow(/cannot resolve/);
    expect(() => scorerRecord(join(tmpdir(), "ailx-not-a-package"))).toThrow(/no package.json/);
  });

  it("rejects two packages claiming the same trackId", () => {
    const a = fixture({ "src/plugin.ts": SCORE });
    const b = fixture({ "src/plugin.ts": SCORE });
    expect(() => scorerRecords([a, b])).toThrow(/duplicate trackId/);
  });
});

/**
 * THE SHARED HALF. `@ailx/core` holds the score allocation, the canonical
 * judgment order, the order-invariant mean and median, and `round3`. Until
 * 2026-09-01 the digest addressed it by `name@version` only, so all four
 * track scores could change while every hashed track file stayed
 * byte-identical and only a hand-made version bump moved the digest.
 */
describe("scorerRecord: workspace dependency source", () => {
  const IMPORT_ROUND3 = `import { round3 } from "@ailx/core";\nimport { scoreT9 } from "./score.js";\nexport const plugin = { round3, scoreT9 };\n`;

  /** A track that imports `round3`, linked to a fake `@ailx/core`. */
  function trackWithDep(
    files: Record<string, string> = DEP_FILES,
    entry = IMPORT_ROUND3,
    manifest: Record<string, unknown> = {},
  ): { dir: string; dep: string } {
    const dir = fixture({ "src/plugin.ts": entry, "src/score.ts": SCORE });
    const dep = linkWorkspaceDep(dir, "@ailx/core", "1.0.0", files, manifest);
    return { dir, dep };
  }

  it("hashes the dependency's source under a package-qualified path", () => {
    const r = scorerRecord(trackWithDep().dir);
    expect(r.sources.map((s) => s.path)).toEqual([
      "@ailx/core/src/index.ts",
      "@ailx/core/src/rounding.ts",
      "src/plugin.ts",
      "src/score.ts",
    ]);
    // Package-qualified, not '../../core/src/rounding.ts': the record must not
    // encode where this machine lays the repository out.
    for (const s of r.sources) expect(s.path).not.toContain("..");
    expect(r.externals).toEqual(["@ailx/core@1.0.0"]);
  });

  it("MOVES when the dependency's source changes and NOTHING else does", () => {
    const a = trackWithDep();
    const before = scorerRecord(a.dir).digest;
    writeFileSync(
      join(a.dep, "src/rounding.ts"),
      `export function round3(x: number) { return Math.round(x * 10000) / 10000; }\nexport const sha256Hex = (s: string) => s;\n`,
    );
    const after = scorerRecord(a.dir).digest;
    expect(after).not.toBe(before);
    // …with the track package and the dependency VERSION untouched.
    expect(scorerRecord(a.dir).externals).toEqual(["@ailx/core@1.0.0"]);
  });

  it("follows only the symbols imported, not the whole dependency", () => {
    const a = trackWithDep();
    const before = scorerRecord(a.dir).digest;
    writeFileSync(join(a.dep, "src/zip.ts"), `export function zip() { return "rewritten"; }\n`);
    expect(scorerRecord(a.dir).digest).toBe(before);
    expect(scorerRecord(a.dir).sources.map((s) => s.path)).not.toContain("@ailx/core/src/zip.ts");
  });

  it("hashes the barrel, so re-pointing an export moves the digest", () => {
    const a = trackWithDep();
    const before = scorerRecord(a.dir).digest;
    writeFileSync(
      join(a.dep, "src/index.ts"),
      `export * from "./zip.js";\nexport * from "./rounding.js";\n`,
    );
    expect(scorerRecord(a.dir).digest).not.toBe(before);
  });

  it("follows an explicit re-export to the module it names", () => {
    const r = scorerRecord(trackWithDep({
      "src/index.ts": `export { round3 } from "./rounding.js";\nexport * from "./zip.js";\n`,
      "src/rounding.ts": DEP_FILES["src/rounding.ts"],
      "src/zip.ts": DEP_FILES["src/zip.ts"],
    }).dir);
    expect(r.sources.map((s) => s.path)).toContain("@ailx/core/src/rounding.ts");
    expect(r.sources.map((s) => s.path)).not.toContain("@ailx/core/src/zip.ts");
  });

  it("follows a re-export chain through nested barrels", () => {
    const r = scorerRecord(trackWithDep({
      "src/index.ts": `export * from "./math/index.js";\n`,
      "src/math/index.ts": `export * from "./rounding.js";\n`,
      "src/math/rounding.ts": `export function round3(x: number) { return x; }\n`,
    }).dir);
    expect(r.sources.map((s) => s.path)).toEqual([
      "@ailx/core/src/index.ts",
      "@ailx/core/src/math/index.ts",
      "@ailx/core/src/math/rounding.ts",
      "src/plugin.ts",
      "src/score.ts",
    ]);
  });

  it("expands the defining module's own imports too", () => {
    const a = trackWithDep({
      "src/index.ts": `export * from "./rounding.js";\n`,
      "src/rounding.ts": `import { EPS } from "./eps.js";\nexport function round3(x: number) { return x + EPS; }\n`,
      "src/eps.ts": `export const EPS = 0;\n`,
    });
    expect(scorerRecord(a.dir).sources.map((s) => s.path)).toContain("@ailx/core/src/eps.ts");
    const before = scorerRecord(a.dir).digest;
    writeFileSync(join(a.dep, "src/eps.ts"), `export const EPS = 1e-9;\n`);
    expect(scorerRecord(a.dir).digest).not.toBe(before);
  });

  /**
   * A namespace or default binding hides which symbols are used, so narrowing
   * would be a guess. It hashes the whole entry closure instead — a superset
   * is a false alarm; a subset is the hole this closes.
   */
  it("falls back to the whole entry closure for a namespace import", () => {
    const r = scorerRecord(trackWithDep(
      DEP_FILES,
      `import * as core from "@ailx/core";\nexport const plugin = { core };\n`,
    ).dir);
    expect(r.sources.map((s) => s.path)).toContain("@ailx/core/src/zip.ts");
  });

  it("honours a declared ailx.sourceEntry", () => {
    const r = scorerRecord(trackWithDep(
      { "src/entry.ts": `export function round3(x: number) { return x; }\n` },
      IMPORT_ROUND3,
      { ailx: { sourceEntry: "src/entry.ts" } },
    ).dir);
    expect(r.sources.map((s) => s.path)).toContain("@ailx/core/src/entry.ts");
  });

  it("refuses a dependency whose source it cannot find", () => {
    expect(() => scorerRecord(trackWithDep({ "dist/index.js": "export const round3 = 1;\n" }).dir))
      .toThrow(/no source entry/);
  });

  it("refuses a symbol the dependency does not export, rather than dropping it", () => {
    expect(() => scorerRecord(trackWithDep(
      DEP_FILES,
      `import { medianForDimension } from "@ailx/core";\nexport const plugin = { medianForDimension };\n`,
    ).dir)).toThrow(/exports no 'medianForDimension'/);
  });

  it("does not follow a REGISTRY dependency into node_modules", () => {
    const dir = fixture({
      "src/plugin.ts": `import { z } from "zod";\nexport const plugin = { z };\n`,
    });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(dir, "package.json"), JSON.stringify({ ...pkg, dependencies: { zod: "^3.1.0" } }));
    linkWorkspaceDep(dir, "zod", "3.1.4", { "src/index.ts": "export const z = 1;\n" });
    const r = scorerRecord(dir);
    expect(r.externals).toEqual(["zod@^3.1.0"]);
    expect(r.sources.map((s) => s.path)).toEqual(["src/plugin.ts"]);
  });

  it("refuses an import that escapes the package it came from", () => {
    const dir = fixture({ "src/plugin.ts": `import "../../outside.js";\nexport const plugin = {};\n` });
    writeFileSync(join(dir, "..", "outside.ts"), "export const x = 1;\n");
    expect(() => scorerRecord(dir)).toThrow(/escapes/);
  });

  it("survives a cycle between the dependency's modules", () => {
    const r = scorerRecord(trackWithDep({
      "src/index.ts": `export * from "./rounding.js";\n`,
      "src/rounding.ts": `import "./helper.js";\nexport function round3(x: number) { return x; }\n`,
      "src/helper.ts": `import "./rounding.js";\nexport const h = 1;\n`,
    }).dir);
    expect(r.sources.map((s) => s.path)).toContain("@ailx/core/src/helper.ts");
  });

  it("is deterministic: the same tree hashes the same twice", () => {
    const a = trackWithDep();
    expect(scorerRecord(a.dir)).toEqual(scorerRecord(a.dir));
  });
});

describe("scorerRecordsIn(packages/tracks)", () => {
  const records = scorerRecordsIn(TRACKS);

  it("addresses all four real tracks, in order", () => {
    expect(records.map((r) => r.trackId)).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("hashes each plugin's real scoring closure and nothing else", () => {
    for (const r of records) {
      const paths = r.sources.map((s) => s.path);
      expect(paths).toContain("src/plugin.ts");
      expect(paths.some((p) => /score|scoring/i.test(p))).toBe(true);
      expect(paths.some((p) => p.endsWith(".tsx"))).toBe(false);
      expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  /** The regression this closes: the shared half is bytes now, not a version. */
  it("hashes @ailx/core's scoring modules, and only those", () => {
    for (const r of records) {
      const paths = r.sources.map((s) => s.path);
      expect(paths, r.trackId).toContain("@ailx/core/src/index.ts");
      expect(paths, r.trackId).toContain("@ailx/core/src/rounding.ts");
      expect(paths, r.trackId).toContain("@ailx/core/src/plugin.ts");
      // Core modules no track's score() reaches must stay OUT, or every UI or
      // packaging edit would move an audit digest that means nothing changed.
      for (const absent of ["zip.ts", "ui.ts", "purity.ts"]) {
        expect(paths, `${r.trackId}/${absent}`).not.toContain(`@ailx/core/src/${absent}`);
      }
      // Never a build artifact, and never anything reached through the link.
      for (const p of paths) {
        expect(p).not.toContain("node_modules");
        expect(p).not.toMatch(/(^|\/)dist\//);
        expect(p).not.toContain("..");
      }
    }
  });

  it("hashes the judgment arithmetic for every JUDGED track", () => {
    // T2 is model-free; T1/T3/T4 aggregate stored judgments through core.
    for (const r of records) {
      const has = r.sources.some((s) => s.path === "@ailx/core/src/judgments.ts");
      expect(has, r.trackId).toBe(r.trackId !== "t2");
    }
  });

  it("gives every track a distinct digest", () => {
    expect(new Set(records.map((r) => r.digest)).size).toBe(records.length);
  });

  it("is deterministic across runs", () => {
    expect(scorerRecordsIn(TRACKS)).toEqual(records);
  });
});
