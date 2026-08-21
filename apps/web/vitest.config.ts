import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next's app files use the automatic JSX runtime (no `import React`);
  // mirror that in the vitest/esbuild transform so page components render
  // in jsdom tests exactly as they build.
  esbuild: { jsx: "automatic" },
  test: { passWithNoTests: true },
});
