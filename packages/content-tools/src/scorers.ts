/**
 * Build-time content addressing of scorer SOURCE (spec §14, FRONTEND.md §2.1).
 *
 * The audit digest must identify the scoring code, not the bundle that
 * happened to ship it. Hashing `Function.prototype.toString()` in the browser
 * fails that test: a minifier bump moves the digest with no source change.
 *
 * Here the digest is computed from files on disk at build time. Starting at a
 * track package's declared `scoringEntry`, every RELATIVE import is followed
 * transitively, so the closure is discovered rather than maintained by hand —
 * a scorer that starts delegating to a new module cannot slip out of the hash.
 *
 * KNOWN BOUNDARY: cross-package imports (`@ailx/core`) are pinned by
 * `name@version` from the package manifest, not by their file bytes. Editing
 * a dependency in place without a version bump is therefore not caught. That
 * is a deliberate scope line: workspace packages are versioned artifacts.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { canonicalJson } from "@ailx/core";

/** One hashed source file, path relative to the package root. */
export interface ScorerSourceFile {
  path: string;
  sha256: string;
}

export interface ScorerRecord {
  /** Short track id used by the platform ('t1'…'t4'). */
  trackId: string;
  /** Workspace package that owns the scorer. */
  packageName: string;
  packageVersion: string;
  /** Every source file in the score() import closure, sorted by path. */
  sources: ScorerSourceFile[];
  /** Non-relative dependencies of the closure, as 'name@range', sorted. */
  externals: string[];
  /** sha256 of the canonical JSON of everything above — THE audit digest. */
  digest: string;
}

/** `ailx` block a track package declares to opt into source addressing. */
interface AilxPackageBlock {
  trackId: string;
  scoringEntry: string;
}

/**
 * Static specifiers only: `from "x"` and side-effect `import "x"`. Dynamic
 * `import()` is deliberately NOT followed — the one dynamic import in a track
 * plugin is `ui()`, which lazy-loads the Runner. The Runner draws pixels; it
 * must not move the scoring digest.
 */
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s+)["']([^"']+)["']/g;

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Resolve a NodeNext specifier ('./score.js') to the source file it came from. */
function resolveSource(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

export class ScorerSourceError extends Error {}

/** Content-address one track package's score() closure. */
export function scorerRecord(packageDir: string): ScorerRecord {
  const pkgPath = join(packageDir, "package.json");
  if (!existsSync(pkgPath)) throw new ScorerSourceError(`${packageDir}: no package.json`);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    name?: string; version?: string; dependencies?: Record<string, string>; ailx?: AilxPackageBlock;
  };
  const ailx = pkg.ailx;
  if (!ailx || !ailx.trackId || !ailx.scoringEntry) {
    throw new ScorerSourceError(
      `${packageDir}: package.json needs an 'ailx' block with trackId and scoringEntry`,
    );
  }
  const entry = resolve(packageDir, ailx.scoringEntry);
  if (!existsSync(entry)) throw new ScorerSourceError(`${packageDir}: scoringEntry '${ailx.scoringEntry}' not found`);

  const seen = new Map<string, string>(); // absolute path -> source text
  const externals = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    const text = readFileSync(file, "utf8");
    seen.set(file, text);
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (spec.startsWith(".")) {
        const next = resolveSource(file, spec);
        if (!next) {
          throw new ScorerSourceError(`${relative(packageDir, file)}: cannot resolve '${spec}'`);
        }
        queue.push(next);
      } else {
        const range = pkg.dependencies?.[spec];
        externals.add(range ? `${spec}@${range}` : spec);
      }
    }
  }

  const sources: ScorerSourceFile[] = [...seen.entries()]
    .map(([abs, text]) => ({ path: relative(packageDir, abs), sha256: sha256Hex(text) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const body = {
    trackId: ailx.trackId,
    packageName: pkg.name ?? "",
    packageVersion: pkg.version ?? "",
    sources,
    externals: [...externals].sort(),
  };
  return { ...body, digest: sha256Hex(canonicalJson(body)) };
}

/** Content-address several packages, sorted by trackId for a stable snapshot. */
export function scorerRecords(packageDirs: ReadonlyArray<string>): ScorerRecord[] {
  const out = packageDirs.map((d) => scorerRecord(d));
  const ids = new Set(out.map((r) => r.trackId));
  if (ids.size !== out.length) throw new ScorerSourceError("duplicate trackId across scorer packages");
  return out.sort((a, b) => (a.trackId < b.trackId ? -1 : 1));
}

/**
 * Content-address every scorer package under `tracksRoot` (one directory per
 * track package). Discovery, not a hand-kept list: a new track cannot ship
 * without an audit digest, and the build script and the CI freshness gate
 * cannot disagree about which packages count.
 */
export function scorerRecordsIn(tracksRoot: string): ScorerRecord[] {
  const dirs = readdirSync(tracksRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(tracksRoot, e.name))
    .filter((d) => {
      const p = join(d, "package.json");
      if (!existsSync(p)) return false;
      return (JSON.parse(readFileSync(p, "utf8")) as { ailx?: unknown }).ailx !== undefined;
    })
    .sort();
  if (dirs.length === 0) throw new ScorerSourceError(`${tracksRoot}: no packages declare an 'ailx' block`);
  return scorerRecords(dirs);
}
