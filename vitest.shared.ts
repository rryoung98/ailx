import { defineProject } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * How every vitest project in this repo resolves `@ailx/*`.
 *
 * Each package's `main` is `dist/index.js`, and node_modules symlinks the
 * package directory in, so an unaliased test run resolves through the LAST
 * BUILD. That costs twice. On a clean clone there is no build, and 75 test
 * files failed to collect with "Failed to resolve entry for package
 * @ailx/core"; with a stale build, the run measured output nobody had
 * regenerated (539d840 found a mutation to a package `src` surviving untested).
 *
 * A workspace project inherits NO `resolve` option from the root
 * `vitest.config.ts` — measured, not assumed — so each package re-exports the
 * project config below from its own `vitest.config.ts`, and `apps/web` mixes
 * the alias table into the config it already had.
 *
 * The Next builds still consume `dist/`, as a published build should: nothing
 * outside vitest reads this file.
 */
const workspacePackageDirs: Record<string, string> = {
  "@ailx/core": "packages/core",
  "@ailx/contract": "packages/contract",
  "@ailx/report": "packages/report",
  "@ailx/session": "packages/session",
  "@ailx/content-tools": "packages/content-tools",
  // The four track packages are named for their TRACK and directoried by their
  // track's NAME, so neither half can be derived from the other.
  "@ailx/track-t1": "packages/tracks/t1-creative-build",
  "@ailx/track-t2": "packages/tracks/t2-discrimination",
  "@ailx/track-t3": "packages/tracks/t3-reasoning",
  "@ailx/track-t4": "packages/tracks/t4-generative",
};

/**
 * Two entries per package, most specific first:
 *
 *  - a SUBPATH, e.g. `@ailx/core/dist/purity.js` (which
 *    `apps/web/lib/instrument/validateChecks.ts` really imports) -> `packages/core/src/purity`.
 *    The `dist/` segment and the `.js` extension are both dropped so vite
 *    resolves the real source file, `.ts` or `.tsx`;
 *  - the bare specifier -> that package's `src/index`.
 *
 * Both are anchored regexes: a bare STRING alias in vite also matches every
 * subpath under it, which would rewrite the import above to
 * `.../src/index.ts/dist/purity.js`.
 */
export const workspaceSourceAliases: Array<{ find: RegExp; replacement: string }> =
  Object.entries(workspacePackageDirs).flatMap(([name, dir]) => {
    const src = fileURLToPath(new URL(`./${dir}/src/`, import.meta.url));
    return [
      { find: new RegExp(`^${name}/(?:dist/)?(.*?)(?:\\.js)?$`), replacement: `${src}$1` },
      { find: new RegExp(`^${name}$`), replacement: `${src}index` },
    ];
  });

/** The whole config for a package that needs nothing but the aliases. */
export default defineProject({
  resolve: { alias: workspaceSourceAliases },
});
