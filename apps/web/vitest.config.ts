import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Next's app files use the automatic JSX runtime (no `import React`);
  // mirror that in the vitest/esbuild transform so page components render
  // in jsdom tests exactly as they build.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      // next/font needs the Next build pipeline; tests use a stable double.
      "next/font/google": fileURLToPath(new URL("./test/mocks/nextFontGoogle.ts", import.meta.url)),
    },
  },
  test: { passWithNoTests: true },
});
