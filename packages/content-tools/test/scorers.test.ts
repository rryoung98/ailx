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

  it("records external dependencies at their declared range", () => {
    const r = scorerRecord(fixture({
      "src/plugin.ts": `import { sha256Hex } from "@ailx/core";\nimport { scoreT9 } from "./score.js";\nexport const plugin = { sha256Hex, scoreT9 };\n`,
      "src/score.ts": SCORE,
    }));
    expect(r.externals).toEqual(["@ailx/core@workspace:*"]);
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

  it("gives every track a distinct digest", () => {
    expect(new Set(records.map((r) => r.digest)).size).toBe(records.length);
  });

  it("is deterministic across runs", () => {
    expect(scorerRecordsIn(TRACKS)).toEqual(records);
  });
});
