import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { workspaceSourceAliases } from "../../vitest.shared";

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
      // ...then every workspace package, read from SOURCE rather than from
      // its last build. The table is shared with every other vitest project
      // in the repo; see `vitest.shared.ts` at the repo root.
      ...workspaceSourceAliases,
    ],
  },
  // e2e/ is Playwright's (it needs a server); vitest must not try to run it.
  test: { passWithNoTests: true, exclude: [...configDefaults.exclude, "e2e/**"] },
});
