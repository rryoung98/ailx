/**
 * WHERE THE EXAM SERVICE IS, for the E2E suite.
 *
 * The app under test is a FRONTEND. It has no API routes of its own any more
 * (docs/ARCHITECTURE.md §10.1 step 3), so the suite cannot seed a run by
 * posting to its own origin: it has to talk to `services/api`, which lives in
 * the PRIVATE repository and is deployed to Cloud Run.
 *
 * That is a real dependency and it is stated as one. `AILX_E2E_API_BASE` has
 * NO DEFAULT: guessing `http://localhost:8080` would make a suite that seeds
 * nothing pass locally and fail in CI for reasons nobody could read, and
 * guessing the STAGING origin would write append-only rows into a database
 * people are demoing from. Neither is a default worth having.
 *
 * One module reads the variable, the same rule `apps/web/lib/mode.ts` follows
 * for the app itself, so the two path spaces cannot drift apart here either:
 * the versioned API is `/v1` and a served T1 snapshot is `/api/site/<digest>`
 * on the service, exactly as `siteHref()` resolves it in the browser.
 */
import { normalizeOrigin } from "../lib/origin";

/**
 * The service origin, validated. Throws with the recipe rather than letting a
 * half-honoured value produce a wrong URL — `lib/origin.ts` holds the one
 * origin predicate, shared with the app and with `AILX_PUBLIC_ORIGIN`.
 */
export function serviceOrigin(): string {
  const value = (process.env.AILX_E2E_API_BASE ?? "").trim();
  if (value === "") {
    throw new Error(
      "AILX_E2E_API_BASE is not set.\n\n" +
        "This suite drives the frontend against the REAL exam service; the app under test has no\n" +
        "API routes of its own. Start `services/api` from the private ailx-backend repo against a\n" +
        "DISPOSABLE Postgres, then point the suite at it:\n\n" +
        "  AILX_E2E_API_BASE=http://127.0.0.1:8080 pnpm --filter @ailx/web e2e\n\n" +
        "See apps/web/e2e/README.md.",
    );
  }
  const origin = normalizeOrigin(value);
  if (origin === null) {
    throw new Error(
      "AILX_E2E_API_BASE must be a bare absolute http(s) origin with no path, query or fragment; " +
        `got ${value}`,
    );
  }
  return origin;
}

/**
 * Is there a service to drive?
 *
 * Used for a GRANULAR skip, never a whole-suite bail. Only the specs that SEED
 * — the ones that take the `attemptId`, `shareToken` or `publishSite` fixtures
 * — need a backend. The pure measurement specs (`visual-contracts.spec.ts`)
 * load a page and measure it, and must keep running with no service at all:
 * this repo has already shipped tests that could never fail (FRONTEND.md
 * §6.7.3), and a suite that skips itself into silence is the same bug wearing
 * a green tick.
 */
export function hasExamService(): boolean {
  return normalizeOrigin(process.env.AILX_E2E_API_BASE) !== null;
}

/** The reason a seeded spec is skipped, said in full so a report is readable. */
export const REQUIRES_SERVICE =
  "needs a running exam service: set AILX_E2E_API_BASE to a THROW-AWAY services/api " +
  "(private ailx-backend repo). Only seeded specs are skipped; measurement specs still run.";

/** The versioned API the browser calls: `<origin>/v1`. */
export function apiRoot(): string {
  return `${serviceOrigin()}/v1`;
}

/**
 * Where a stored T1 snapshot is served: `<origin>/api`. Deliberately NOT
 * `/v1` — that exact string is frozen inside issued share payloads and
 * credential claims, and those rows are append-only.
 */
export function siteRoot(): string {
  return `${serviceOrigin()}/api`;
}
