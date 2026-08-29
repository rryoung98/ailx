import { defineWorkspace } from "vitest/config";

/**
 * The project list for the single-process run (`pnpm test` -> `vitest run
 * --workspace vitest-workspace.ts`). Each entry keeps its own vitest config —
 * environment, aliases, setup files — and they share ONE capped worker pool
 * (vitest.config.ts).
 *
 * `!packages/tracks` because that directory holds the track packages but is
 * not one itself: matching it makes a nameless project rooted there that
 * collects every track test a SECOND time.
 *
 * The file is deliberately NOT named `vitest.workspace.ts`: vitest searches
 * PARENT directories for that name, so a package without a config of its own
 * would pick this list up and try to resolve `apps/web` inside itself. Naming
 * it out of that pattern keeps `vitest run` inside one package working.
 */
export default defineWorkspace([
  "packages/*",
  "!packages/tracks",
  "packages/tracks/*",
  "apps/web",
  "services/*",
]);
