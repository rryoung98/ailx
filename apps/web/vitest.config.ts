import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The workspace packages this app imports, mapped to the directory that holds
 * their SOURCE. Their `main` points at `dist/`, and node_modules symlinks the
 * package directory in, so an unaliased test run measures the LAST BUILD
 * rather than the tree the run was started from. That already produced a false
 * green: a mutation to a package `src` survived because no test ever loaded
 * the mutated file. The aliases below make the apps/web suite read `src`.
 *
 * Only vitest reads this file — `next.config.mjs` does not — so the two Next
 * builds keep consuming `dist/` exactly as they did before, which is what a
 * published build should do.
 */
const workspacePackageDirs: Record<string, string> = {
  "@ailx/core": "packages/core",
  "@ailx/contract": "packages/contract",
  "@ailx/report": "packages/report",
  "@ailx/session": "packages/session",
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
 *  - a SUBPATH, e.g. `@ailx/core/dist/purity.js` (which `lib/validateChecks.ts`
 *    really imports) -> `packages/core/src/purity`. The `dist/` segment and the
 *    `.js` extension are both dropped so vite resolves the real source file,
 *    `.ts` or `.tsx`;
 *  - the bare specifier -> that package's `src/index`.
 *
 * Both are anchored regexes: a bare STRING alias in vite also matches every
 * subpath under it, which would rewrite the import above to
 * `.../src/index.ts/dist/purity.js`.
 */
const workspaceSourceAliases = Object.entries(workspacePackageDirs).flatMap(([name, dir]) => {
  const src = fileURLToPath(new URL(`../../${dir}/src/`, import.meta.url));
  return [
    { find: new RegExp(`^${name}/(?:dist/)?(.*?)(?:\\.js)?$`), replacement: `${src}$1` },
    { find: new RegExp(`^${name}$`), replacement: `${src}index` },
  ];
});

export default defineConfig({
  // Next's app files use the automatic JSX runtime (no `import React`);
  // mirror that in the vitest/esbuild transform so page components render
  // in jsdom tests exactly as they build.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      // next/font needs the Next build pipeline; tests use a stable double.
      {
        find: /^next\/font\/google$/,
        replacement: fileURLToPath(new URL("./test/mocks/nextFontGoogle.ts", import.meta.url)),
      },
      // ...then every workspace package, read from SOURCE (see above).
      ...workspaceSourceAliases,
    ],
  },
  // e2e/ is Playwright's (it needs a server); vitest must not try to run it.
  test: { passWithNoTests: true, exclude: [...configDefaults.exclude, "e2e/**"] },
});
