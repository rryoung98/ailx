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
 * THE SHARED HALF IS HASHED TOO, since 2026-09-01. It was not, and that was
 * the weakest part of this digest: `@ailx/core` holds the score ALLOCATION
 * (`allocation.ts`), the canonical judgment ORDER and the order-invariant mean
 * and median (`judgments.ts`) and `round3` (`rounding.ts`). Rewriting any of
 * them changes all four track scores while every hashed track file stays
 * byte-identical, and the digest used to move only because somebody
 * remembered a version bump. A digest that a forgotten version bump defeats is
 * a convention, not a content address.
 *
 * So an import of a WORKSPACE dependency is followed into that package's own
 * source, and those bytes are hashed under a package-qualified path
 * (`@ailx/core/src/rounding.ts`), alongside the resolved version in
 * `externals`. Three limits keep that from becoming "hash the world":
 *
 *  - Only `workspace:` dependencies are followed. A registry dependency is
 *    still `name@range`: it is an immutable published artifact, and its files
 *    are not in this tree.
 *  - Only the SYMBOLS actually imported are followed through the dependency's
 *    barrel to the module that defines them, so a track that imports `round3`
 *    hashes `rounding.ts` and not `zip.ts`. A namespace or default import
 *    (`import * as core`) hides which symbols are used, so it conservatively
 *    pulls the dependency's whole entry closure. The barrel itself is always
 *    hashed: it decides where a symbol comes from.
 *  - Every followed file must live inside the package it was resolved from.
 *    The walk cannot leave a workspace package, reach a build artifact
 *    (`dist/`) or reach `node_modules`, because it only ever follows a
 *    relative specifier from a file already inside the package root.
 *
 * The record is deterministic across machines: paths are package-qualified
 * rather than layout-relative, separators are normalised to '/', and the file
 * list is sorted.
 *
 * REMAINING BOUNDARY, stated narrowly: this digest addresses SOURCE, not the
 * toolchain. The TypeScript version, the runtime and ICU are not in it (see
 * AGENTS.md on cross-runtime identity), and a registry dependency is trusted
 * at its range.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { canonicalJson } from "@ailx/core";

/**
 * One hashed source file.
 *
 * `path` is relative to the scorer package root for the package's own files,
 * and package-qualified (`@ailx/core/src/rounding.ts`) for a workspace
 * dependency's. Package-qualified rather than `../../core/src/rounding.ts` so
 * the record does not encode where the repository happens to lay packages out.
 */
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
  /**
   * Every source file in the score() import closure — the track's own files
   * AND the workspace-dependency files it imports — sorted by path.
   */
  sources: ScorerSourceFile[];
  /** Non-relative dependencies of the closure, as 'name@version|range', sorted. */
  externals: string[];
  /** sha256 of the canonical JSON of everything above — THE audit digest. */
  digest: string;
}

/** `ailx` block a package declares to opt into source addressing. */
interface AilxPackageBlock {
  /** Track packages only: the short track id. */
  trackId?: string;
  /** Track packages only: the file `score()` is reached from. */
  scoringEntry?: string;
  /**
   * The entry a DEPENDENT follows when hashing this package's source.
   * Defaults to `src/index.ts`, which is what every workspace package here
   * publishes as `dist/index.js`.
   */
  sourceEntry?: string;
}

interface PackageManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  ailx?: AilxPackageBlock;
}

/** A package the walk is currently inside. */
interface PackageScope {
  /** Realpath of the package root; nothing outside it may be hashed. */
  root: string;
  /** '' for the scorer package itself, else the dependency's package name. */
  label: string;
  deps: Record<string, string>;
}

/** Accumulated state of one record's walk. */
interface Walk {
  files: Map<string, ScorerSourceFile>;
  text: Map<string, string>;
  expanded: Set<string>;
  externals: Set<string>;
}

/** The default source entry of a workspace package. See AilxPackageBlock. */
const DEFAULT_SOURCE_ENTRY = "src/index.ts";

/**
 * Static specifiers only, with the clause that precedes them. `from "x"`
 * covers `import`, `import type` and re-exporting `export … from`. Dynamic
 * `import()` is deliberately NOT followed — the one dynamic import in a track
 * plugin is `ui()`, which lazy-loads the Runner. The Runner draws pixels; it
 * must not move the scoring digest.
 *
 * The clause cannot contain a quote or a semicolon, so the match can never
 * run past the end of one statement into the `from` of a later one.
 */
const FROM_RE = /\b(?:import|export)\s+((?:type\s+)?[^"';]*?)\s*from\s*["']([^"']+)["']/g;

/** Side-effect `import "x"`, which has no clause. */
const SIDE_EFFECT_RE = /\bimport\s*["']([^"']+)["']/g;

/** An `export { … }` with no `from`: a local re-export, i.e. defined here. */
const LOCAL_EXPORT_LIST_RE = /export\s*\{([^}]*)\}(?!\s*from)/g;

/** `null` means "every symbol": a namespace import, a default import, `export *`. */
type SymbolSet = ReadonlySet<string> | null;

interface ParsedImport {
  spec: string;
  symbols: SymbolSet;
}

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/** Every static import in a file, clause parsed into the symbols it names. */
function parseImports(text: string): ParsedImport[] {
  const out: ParsedImport[] = [];
  for (const m of text.matchAll(FROM_RE)) out.push({ spec: m[2], symbols: importedSymbols(m[1]) });
  for (const m of text.matchAll(SIDE_EFFECT_RE)) out.push({ spec: m[1], symbols: new Set() });
  return out;
}

/**
 * Which symbols a clause names, or null when it cannot be narrowed.
 *
 * `{ a, b as c }` names a and b. Anything OUTSIDE the braces — `* as ns`, a
 * default binding — hides the usage, so the answer is null and the caller
 * hashes the whole entry closure rather than guessing.
 */
export function importedSymbols(clause: string): SymbolSet {
  const trimmed = clause.replace(/^type\s+/, "").trim();
  const braces = trimmed.match(/\{([^}]*)\}/);
  const outside = trimmed.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
  if (outside.length > 0) return null;
  if (!braces) return null;
  return namedList(braces[1], (local) => local);
}

/**
 * Names in a `{ … }` list. `pick` chooses which side of `as` matters: the
 * LOCAL name for an import (`{ round3 as r }` imports round3), the EXPORTED
 * name for a re-export (`{ r as round3 }` exports round3).
 */
function namedList(inner: string, pick: (local: string, exported: string) => string): Set<string> {
  const names = new Set<string>();
  for (const part of inner.split(",")) {
    const cleaned = part.trim().replace(/^type\s+/, "").trim();
    if (cleaned.length === 0) continue;
    const [local, exported] = cleaned.split(/\s+as\s+/).map((s) => s.trim());
    const name = pick(local, exported ?? local);
    if (name.length > 0 && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
  }
  return names;
}

/** Does this module DEFINE `name` (rather than forward it from elsewhere)? */
function declaresSymbol(text: string, name: string): boolean {
  const decl = new RegExp(
    `\\bexport\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?` +
      `(?:const|let|var|function\\*?|class|interface|type|enum)\\s+${escapeRe(name)}\\b`,
  );
  if (decl.test(text)) return true;
  for (const m of text.matchAll(LOCAL_EXPORT_LIST_RE)) {
    if (namedList(m[1], (_local, exported) => exported).has(name)) return true;
  }
  return false;
}

/**
 * How a non-relative import is identified in the digest.
 *
 * A registry dependency is `name@range`, which is what the manifest pins and
 * what a published artifact makes immutable.
 *
 * A WORKSPACE dependency (`workspace:*`) is not pinned by anything: the range
 * never changes, so `@ailx/core@workspace:*` would address whatever that
 * package happens to contain today. It is recorded at its RESOLVED VERSION,
 * read from the dependency's own manifest — and, since the source closure is
 * hashed as well, the version is now a label on bytes rather than the only
 * thing standing between an edit and an unchanged digest.
 */
export function externalId(
  packageDir: string,
  range: string | undefined,
  spec: string,
): string {
  if (range === undefined) return spec;
  if (!range.startsWith("workspace:")) return `${spec}@${range}`;
  return `${spec}@${workspaceDependency(packageDir, spec).manifest.version}`;
}

interface WorkspaceDependency {
  dir: string;
  manifest: PackageManifest & { version: string };
}

/**
 * A workspace dependency's own directory and manifest.
 *
 * The dependency is reached through the package manager's own link
 * (`<pkg>/node_modules/<spec>`), walking up so a hoisted layout works too.
 * That is the same path the compiler resolves, so what is recorded is what
 * was actually built against. The directory is REALPATHed: pnpm links a
 * workspace package as a symlink, and the files must be reached — and
 * containment-checked — at their real location.
 */
function workspaceDependency(packageDir: string, spec: string): WorkspaceDependency {
  let dir = resolve(packageDir);
  for (let depth = 0; depth < 8; depth++) {
    const p = join(dir, "node_modules", ...spec.split("/"), "package.json");
    if (existsSync(p)) {
      const manifest = JSON.parse(readFileSync(p, "utf8")) as PackageManifest;
      if (manifest.name === spec && typeof manifest.version === "string") {
        return { dir: realpathSync(dirname(p)), manifest: manifest as WorkspaceDependency["manifest"] };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new ScorerSourceError(
    `${packageDir}: workspace dependency '${spec}' has no resolvable package.json version`,
  );
}

/** Path recorded in the digest: package-qualified, '/'-separated, layout-free. */
function labelPath(scope: PackageScope, file: string): string {
  const rel = relative(scope.root, file).split(sep).join("/");
  return scope.label === "" ? rel : `${scope.label}/${rel}`;
}

/** Refuse anything the walk reached outside the package it came from. */
function assertInside(scope: PackageScope, file: string, from: string): string {
  const real = realpathSync(file);
  if (real !== scope.root && !real.startsWith(scope.root + sep)) {
    throw new ScorerSourceError(
      `${labelPath(scope, from)}: import escapes ${scope.label || "the scorer package"} (${real})`,
    );
  }
  return real;
}

/** A file's text, read once. Reading is NOT hashing: see findSymbolModule. */
function readCached(walk: Walk, file: string): string {
  const cached = walk.text.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(file, "utf8");
  walk.text.set(file, text);
  return text;
}

/** Hash a file's bytes into the record. Idempotent; returns its text. */
function includeFile(walk: Walk, scope: PackageScope, file: string): string {
  const text = readCached(walk, file);
  if (!walk.files.has(file)) {
    walk.files.set(file, { path: labelPath(scope, file), sha256: sha256Hex(text) });
  }
  return text;
}

/** Record a bare specifier as an external, without following it. */
function recordExternal(walk: Walk, scope: PackageScope, spec: string): string | undefined {
  const range = scope.deps[spec];
  walk.externals.add(externalId(scope.root, range, spec));
  return range;
}

/** Hash a module and, transitively, everything it statically imports. */
function expandModule(walk: Walk, scope: PackageScope, file: string): void {
  if (walk.expanded.has(file)) return;
  walk.expanded.add(file);
  const text = includeFile(walk, scope, file);
  for (const { spec, symbols } of parseImports(text)) {
    if (spec.startsWith(".")) {
      const next = resolveSource(file, spec);
      if (next === null) {
        throw new ScorerSourceError(`${labelPath(scope, file)}: cannot resolve '${spec}'`);
      }
      expandModule(walk, scope, assertInside(scope, next, file));
    } else {
      followBare(walk, scope, spec, symbols);
    }
  }
}

/** Record a non-relative import, and follow it if it is a workspace package. */
function followBare(walk: Walk, scope: PackageScope, spec: string, symbols: SymbolSet): void {
  const range = recordExternal(walk, scope, spec);
  if (range === undefined || !range.startsWith("workspace:")) return;
  const dep = workspaceDependency(scope.root, spec);
  const depScope: PackageScope = {
    root: dep.dir,
    label: dep.manifest.name ?? spec,
    deps: dep.manifest.dependencies ?? {},
  };
  const entryRel = dep.manifest.ailx?.sourceEntry ?? DEFAULT_SOURCE_ENTRY;
  const entry = resolve(dep.dir, entryRel);
  if (!existsSync(entry)) {
    throw new ScorerSourceError(
      `workspace dependency '${spec}' has no source entry at '${entryRel}' — ` +
        `the audit digest cannot address its bytes (set ailx.sourceEntry in its package.json)`,
    );
  }
  assertInside(depScope, entry, entry);
  if (symbols === null) {
    expandModule(walk, depScope, entry);
    return;
  }
  // The barrel is hashed even when nothing is taken from it: it decides where
  // a symbol comes from, so re-pointing an `export * from` must move the digest.
  const barrel = includeFile(walk, depScope, entry);
  for (const im of parseImports(barrel)) {
    if (!im.spec.startsWith(".")) recordExternal(walk, depScope, im.spec);
  }
  for (const symbol of symbols) {
    const chain = findSymbolModule(walk, depScope, entry, symbol, new Set());
    if (chain === null) {
      throw new ScorerSourceError(
        `workspace dependency '${depScope.label}' exports no '${symbol}' reachable from ` +
          `'${entryRel}' — refusing to hash a closure the digest cannot prove complete`,
      );
    }
    // The barrels crossed on the way are hashed; the module that defines the
    // symbol is expanded whole, so its own imports come with it.
    for (const link of chain) includeFile(walk, depScope, link);
    expandModule(walk, depScope, chain[chain.length - 1]);
  }
}

/**
 * The re-export chain from `file` to the module that DEFINES `symbol`,
 * definer last, or null.
 *
 * Only the path is returned. A barrel sibling that was read and did not
 * declare the symbol is NOT part of the answer: TypeScript rejects an
 * ambiguous `export *`, so a declaration appearing in a sibling cannot
 * silently re-point a symbol, and hashing every module the search happened to
 * open would make the digest depend on the ORDER of lines in a barrel.
 */
function findSymbolModule(
  walk: Walk,
  scope: PackageScope,
  file: string,
  symbol: string,
  seen: Set<string>,
): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  const text = readCached(walk, file);
  if (declaresSymbol(text, symbol)) return [file];

  const stars: string[] = [];
  for (const m of text.matchAll(FROM_RE)) {
    const clause = m[1].replace(/^type\s+/, "").trim();
    const spec = m[2];
    if (!m[0].trimStart().startsWith("export") || !spec.startsWith(".")) continue;
    const next = resolveSource(file, spec);
    if (next === null) {
      throw new ScorerSourceError(`${labelPath(scope, file)}: cannot resolve '${spec}'`);
    }
    const target = assertInside(scope, next, file);
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      // `export { round3 } from "./rounding.js"` — named, so this is the one.
      if (namedList(braces[1], (_local, exported) => exported).has(symbol)) return [file, target];
    } else if (clause.startsWith("*")) {
      stars.push(target);
    }
  }
  // `export * from` hides the names, so each star target has to be asked.
  for (const target of stars) {
    const found = findSymbolModule(walk, scope, target, symbol, seen);
    if (found !== null) return [file, ...found];
  }
  return null;
}


/** Content-address one track package's score() closure. */
export function scorerRecord(packageDir: string): ScorerRecord {
  const pkgPath = join(packageDir, "package.json");
  if (!existsSync(pkgPath)) throw new ScorerSourceError(`${packageDir}: no package.json`);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageManifest;
  const ailx = pkg.ailx;
  if (!ailx || !ailx.trackId || !ailx.scoringEntry) {
    throw new ScorerSourceError(
      `${packageDir}: package.json needs an 'ailx' block with trackId and scoringEntry`,
    );
  }
  const root = realpathSync(packageDir);
  const entry = resolve(root, ailx.scoringEntry);
  if (!existsSync(entry)) {
    throw new ScorerSourceError(`${packageDir}: scoringEntry '${ailx.scoringEntry}' not found`);
  }

  const scope: PackageScope = { root, label: "", deps: pkg.dependencies ?? {} };
  const walk: Walk = { files: new Map(), text: new Map(), expanded: new Set(), externals: new Set() };
  expandModule(walk, scope, entry);

  const sources = [...walk.files.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const body = {
    trackId: ailx.trackId,
    packageName: pkg.name ?? "",
    packageVersion: pkg.version ?? "",
    sources,
    externals: [...walk.externals].sort(),
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
