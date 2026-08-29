import { defineConfig } from "vitest/config";

/**
 * Pool policy for the single-process monorepo run (`pnpm test`), whose project
 * list is `vitest-workspace.ts`.
 *
 * `pnpm -r test` starts a vitest per package, each with its own CPU-count
 * worker pool, so an 11-package repo opened 11 pools and paid for every heavy
 * fixture (jsdom, PGlite) once per pool. One workspace run shares one pool.
 *
 * Concurrency is capped because the ceiling here is MEMORY, not CPU: one fork
 * running a jsdom or PGlite file holds hundreds of MB, so an uncapped
 * CPU-count pool asked for gigabytes it could not spend on speed.
 * `AILX_TEST_FORKS` lets a bigger CI runner raise it.
 *
 * `forks` (child processes), not `threads`: a wasm-heavy worker returns its
 * memory to the OS only when the process exits, and a stuck worker can be
 * killed without taking the run down with it.
 */
const maxForks = Number(process.env.AILX_TEST_FORKS) || 4;

export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: { forks: { maxForks, minForks: 1 } },
    // A worker that ignores teardown is what becomes an orphan holding its
    // heap when a run is interrupted; fail loudly instead of leaking quietly.
    teardownTimeout: 10_000,
  },
});
