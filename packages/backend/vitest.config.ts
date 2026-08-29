import { defineConfig } from "vitest/config";

export default defineConfig({
  // The setup file closes the reused PGlite when a file finishes; see test/helpers.ts.
  test: { setupFiles: ["./test/setup.ts"] },
});
