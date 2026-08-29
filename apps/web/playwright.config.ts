import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * E2E suite (FRONTEND.md §6.3–6.5). NOT part of `pnpm -r test`: it needs a
 * real server, so it lives behind `pnpm e2e` and the default unit run stays
 * fast and dependency-free.
 *
 * Two ways to run:
 *  - default: Playwright boots the PRODUCTION server build itself
 *    (`next build && next start` with AILX_BACKEND=1) — the CI gate, and the
 *    only configuration in which the redirect/CSP behaviour is reproducible.
 *  - `AILX_E2E_BASE_URL=…`: run the same specs against an already-running
 *    deployment (staging smoke). No server is booted.
 *
 * Both need a Postgres `DATABASE_URL`; nothing here ever hardcodes one.
 */
const port = Number(process.env.AILX_E2E_PORT ?? 3210);
const externalBaseUrl = process.env.AILX_E2E_BASE_URL;
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${port}`;

/**
 * Disposable local Postgres — never staging, never a shared database (see
 * e2e/README.md for the one-command bootstrap). Not a secret, and not a
 * credential to commit: it is the documented default for local runs only.
 */
const databaseUrl = process.env.DATABASE_URL ?? "postgres://ailx:ailx@localhost:55432/ailx_e2e";

export default defineConfig({
  testDir: "./e2e",
  // One attempt per test and a unique dev user per test: no shared state.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Flake policy (§6.5): never retried locally, at most once in CI with a trace.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(externalBaseUrl === undefined
    ? {
        webServer: {
          command: `next build && next start -p ${port}`,
          url: baseURL,
          timeout: 300_000,
          reuseExistingServer: !process.env.CI,
          stdout: "pipe",
          env: {
            AILX_BACKEND: "1",
            NEXT_PUBLIC_BASE_PATH: "",
            AILX_AUTH: "dev",
            DATABASE_URL: databaseUrl,
            // The origin a browser really reaches: it is baked into the T1
            // sandbox CSP allowlist and the canonicalising 308, so a wrong
            // value is exactly the class of bug the site spec must catch.
            AILX_PUBLIC_ORIGIN: baseURL,
            // Per-run snapshot root: a stale snapshot must never make a
            // serve test pass (or fail) for the previous run's reasons.
            AILX_SNAPSHOT_DIR: mkdtempSync(join(tmpdir(), "ailx-e2e-snapshots-")),
          },
        },
      }
    : {}),
});
