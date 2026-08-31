import { defineConfig, devices } from "@playwright/test";
import { hasExamService, serviceOrigin } from "./e2e/service";

/**
 * E2E suite (FRONTEND.md §6.3–6.5). NOT part of `pnpm -r test`: it needs a
 * real server, so it lives behind `pnpm e2e` and the default unit run stays
 * fast and dependency-free.
 *
 * Two ways to run:
 *  - default: Playwright boots the PRODUCTION frontend build itself
 *    (`next build && next start`) — the CI gate, and the only configuration in
 *    which the redirect/CSP behaviour is reproducible.
 *  - `AILX_E2E_BASE_URL=…`: run the same specs against an already-running
 *    deployment (staging smoke). No server is booted.
 *
 * BOTH need a running EXAM SERVICE at `AILX_E2E_API_BASE`, because this app no
 * longer has API routes of its own: it is a frontend, and `services/api` in
 * the private repo is the backend (docs/ARCHITECTURE.md §10.1). The service
 * owns the database, the auth mode and the T1 snapshot store, so none of
 * `DATABASE_URL`, `AILX_AUTH` or `AILX_SNAPSHOT_DIR` is set here any more —
 * setting them would describe a server this config does not start.
 *
 * `AILX_BACKEND=1` stays, and now means only what its name says for a
 * frontend: put `page.api.tsx` into `pageExtensions` so the seven
 * database-reading pages exist at all. See next.config.mjs.
 */
const port = Number(process.env.AILX_E2E_PORT ?? 3210);
const externalBaseUrl = process.env.AILX_E2E_BASE_URL;
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${port}`;

/**
 * The service, if there is one. NOT a hard failure and NOT a default: a
 * default would either seed nothing (localhost) or seed STAGING, and a hard
 * failure would stop the measurement specs, which need no backend at all.
 * Seeded specs skip themselves with a reason instead (e2e/service.ts).
 */
const apiBase = hasExamService() ? serviceOrigin() : undefined;

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
  expect: {
    timeout: 10_000,
    /**
     * Screenshot baselines (e2e/visual-baselines.spec.ts). Animations are
     * frozen and the caret hidden, because a blinking cursor or a 200ms ease
     * is the difference between a baseline and a flake. The diff ratio is
     * deliberately small: these are element shots of copy-only surfaces, so
     * anything past antialiasing noise is a real change.
     */
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css", maxDiffPixelRatio: 0.01 },
  },
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
          /**
           * OPT-IN, not the default, and CI is not the reason.
           *
           * `reuseExistingServer: !CI` means "if something is already
           * listening on this port, test that instead". It cost us a full
           * debugging session on 2026-08-31: a next-server left behind by an
           * agent that died the previous DAY still held 3210, so the suite
           * silently drove a 24-hour-old build — a 216px header and a landing
           * page with no drill — and reported green. A green that describes a
           * binary nobody built is worse than a red one.
           *
           * Playwright cannot tell a stale server from a fresh one; only a
           * human knows. So the fast inner loop stays available and has to be
           * ASKED for by name. If you set it, you own what is on the port.
           */
          reuseExistingServer: process.env.AILX_E2E_REUSE_SERVER === "1",
          stdout: "pipe",
          env: {
            // Only `page.api.tsx` page extensions; there are no API routes.
            AILX_BACKEND: "1",
            NEXT_PUBLIC_BASE_PATH: "",
            // The seam, at BUILD time: `NEXT_PUBLIC_*` is inlined by the
            // compiler, so the browser under test calls `<service>/v1/...`
            // rather than an origin that answers nothing.
            ...(apiBase === undefined ? {} : { NEXT_PUBLIC_AILX_API_BASE: apiBase }),
          },
        },
      }
    : {}),
});
