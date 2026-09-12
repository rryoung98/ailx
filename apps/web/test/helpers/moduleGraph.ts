/**
 * The app's own import graph, parsed by TypeScript, for the guards that ask
 * WHAT A SURFACE REACHES.
 *
 * This machinery grew inside `test/dailyChallenge.test.tsx` (TEN-52), which
 * asks whether the daily reaches a scoring module. A second guard now asks
 * the same kind of question of `features/report/**` and zod (TEN-216), so the
 * walk lives here rather than being copied — one parser, one resolver, one
 * graph, and a fix to any of them reaches every guard that uses it.
 *
 * Specifiers come from the TypeScript parser — `import`, `export … from`,
 * dynamic `import()`, `require()` and `import x = require()` — so one written
 * in a comment or a string is not one, and the shape of the file does not
 * matter. Only RELATIVE specifiers are resolved; a package name is a leaf,
 * which is what a guard over this app's own modules wants.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import { BROWSER_ROOTS, WEB_ROOT } from "./browserSources";

export { WEB_ROOT };

/** Every source file under `dir`, as a "/"-spelled path relative to apps/web. */
export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    // Keys are "/"-spelled whatever the platform, so a test can name one.
    // `.js`/`.jsx` are read too: next.config.mjs keeps them in pageExtensions,
    // so a page written in JavaScript is a page.
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(relative(WEB_ROOT, full).split(sep).join("/"));
  }
  return out;
}

/** One import: where it points, and the names it brings in ("" when none). */
export interface ParsedImport {
  specifier: string;
  bindings: string;
  /** The names taken from the module; "*" when the whole namespace is taken. */
  names: string[];
  /**
   * The names taken as VALUES — everything in `names` that a bundler must
   * emit code for. `import type { X }`, `import { type X }` and
   * `export type { X } from` contribute nothing here, because a type is
   * erased before a byte is bundled. A namespace import, a dynamic
   * `import()` and a `require()` contribute "*": they take the module whole.
   */
  valueNames: string[];
}

/**
 * The names an import clause takes FROM the module, one per binding.
 *
 * `{ a as b }` yields "a", because "a" is what the package handed over. A
 * clause that takes the whole namespace — `import * as c`, `export * from`,
 * a bare side-effect import, a dynamic `import()` — yields "*", so a check
 * over an allowlist of names cannot be dodged by taking everything at once.
 *
 * `valuesOnly` drops the bindings TypeScript erases, so a guard about what
 * ships can tell `import type { X }` from `import { X }`.
 */
function clauseNames(
  clause: ts.ImportClause | ts.NamedExportBindings | undefined,
  valuesOnly = false,
): string[] {
  if (!clause) return ["*"];
  const isImport = ts.isImportClause(clause);
  // `import type { … }` / `export type { … }`: the whole clause is erased.
  if (valuesOnly && isImport && clause.isTypeOnly) return [];
  const named = isImport ? clause.namedBindings : clause;
  const out: string[] = [];
  if (isImport && clause.name) out.push("default");
  if (!named) return out.length > 0 ? out : ["*"];
  if (ts.isNamespaceImport(named) || ts.isNamespaceExport(named)) return [...out, "*"];
  for (const element of named.elements) {
    // `import { type X }` — one erased binding among value ones.
    if (valuesOnly && element.isTypeOnly) continue;
    out.push((element.propertyName ?? element.name).text);
  }
  return out;
}

export function parseImports(source: string, name = "in.tsx"): ParsedImport[] {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const out: ParsedImport[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : node.exportClause;
      // `export type { X } from "y"` erases the whole clause, exactly as
      // `import type` does, and the flag for it sits on the declaration.
      const typeOnlyDecl = ts.isExportDeclaration(node) && node.isTypeOnly;
      out.push({
        specifier: node.moduleSpecifier.text,
        bindings: clause?.getText() ?? "",
        names: clauseNames(clause),
        valueNames: typeOnlyDecl ? [] : clauseNames(clause, true),
      });
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      // A dynamic import and a require() both hand over the whole module
      // namespace. require() is read because the graph covers .js and .mjs
      // files, where it is how a module is reached.
      out.push({ specifier: node.arguments[0].text, bindings: "", names: ["*"], valueNames: ["*"] });
    }
    // `import x = require("y")`, which TypeScript still compiles.
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      out.push({
        specifier: node.moduleReference.expression.text,
        bindings: "",
        names: ["*"],
        valueNames: ["*"],
      });
    }
    node.forEachChild(visit);
  };
  visit(file);
  return out;
}

export const parseSpecifiers = (source: string): string[] =>
  parseImports(source).map((i) => i.specifier);

export const fileImports = (rel: string): ParsedImport[] =>
  parseImports(readFileSync(join(WEB_ROOT, rel), "utf8"), rel);

/**
 * A specifier as a path under `apps/web`, or null if it is a package. Both
 * spellings of an app module resolve: relative, and the `@/*` alias that
 * `apps/web/tsconfig.json` points at this same root.
 */
export function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  const base = spec.startsWith("@/")
    ? join(WEB_ROOT, spec.slice(2))
    : join(WEB_ROOT, dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(WEB_ROOT, candidate).split(sep).join("/");
    }
  }
  return null;
}

/** Every browser source file, with its imports and the app modules they reach. */
export const MODULE_GRAPH = new Map<string, { imports: ParsedImport[]; files: string[] }>(
  BROWSER_ROOTS.flatMap((root) => sourceFiles(join(WEB_ROOT, root))).map((rel) => {
    const imports = fileImports(rel);
    const files = imports
      .map((i) => resolveImport(rel, i.specifier))
      .filter((f): f is string => f !== null);
    return [rel, { imports, files }];
  }),
);

/** Everything `start` imports, transitively, `start` included. */
export function reachable(start: string): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of MODULE_GRAPH.get(current)?.files ?? []) stack.push(next);
  }
  return seen;
}
