import { normalizeOrigin } from "./origin";

/**
 * Build-mode seam. `AILX_BACKEND=1` is baked into the client bundle as
 * NEXT_PUBLIC_AILX_BACKEND by next.config.mjs; every surface that must
 * behave (or read) differently in the hosted build asks here instead of
 * re-testing the raw env var — one spelling, one truth.
 *
 * Kept a function (not a module const) so it is read at call time: tests
 * stub the env per case, and Next still inlines the literal at build.
 */
export function isServerMode(): boolean {
  return process.env.NEXT_PUBLIC_AILX_BACKEND === "1";
}

/**
 * Is Clerk mounted in THIS build?
 *
 * Two conditions, and both are load-bearing. A build with no backend has
 * nothing to authenticate against, and a build with no publishable key cannot
 * mount `<ClerkProvider>` without throwing on first render — so a hosted
 * deploy that has not been given a key stays on the asserted dev id and keeps
 * working. That is the reversible half of the atomic switch in
 * docs/ARCHITECTURE.md §10.2: unset the key and the frontend is back where it
 * started, no rollback needed.
 *
 * The ONLY reader of NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in this app, the same
 * one-place rule `apiOrigin()` follows — Clerk's own SDK reads the variable
 * from the environment itself, so no call site needs to pass it around.
 */
export function isClerkEnabled(): boolean {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return isServerMode() && typeof key === "string" && key !== "";
}

/**
 * Footer provenance line. The static showcase really is offline — the
 * hosted build is not, and claiming "no network calls" there is a lie the
 * dogfooder caught on every page.
 *
 * The hosted half also stopped promising a simulator. TEN-62 moved the
 * provider key onto the exam service, which refuses an unconnected caller,
 * so "without one, every model call is a deterministic simulator" is not
 * what a hosted deployment does: the service makes no call at all, and it is
 * each RUNNER that offers a labelled offline fallback. The static build is
 * unchanged, because there the simulator really is every model call.
 */
export function footerModeCopy(): string {
  return isServerMode()
    ? "AILX 2026.1 · hosted build. Your run — event log, responses and any published site snapshot — is saved on the AILX backend. Model calls go through the exam service, which holds the key for the model you connect; this browser never receives one. Connect nothing and the service makes no model call for you; a track that can carry on without one falls back to its own offline simulator and says so on screen."
    : "AILX 2026.1 · static demo build. Every model call is a deterministic simulator, seeded by SHA-256 of its inputs. No network calls. Everything runs in your browser.";
}

/**
 * The landing hero's access line, which is a PROMISE about what a visitor
 * needs before they can play.
 *
 * "free to play · no account" is true of the static GitHub Pages demo and of
 * the practice and daily loops in every build. It is false of a SITTING on a
 * deployment that mounts Clerk (`AILX_AUTH=clerk` on staging): the exam
 * service refuses an anonymous caller, so the run cannot start without an
 * account. One sentence cannot be true of both, so the build says which one
 * it is — and the free half stays said, because it is still true.
 */
export function accessCopy(): string {
  return isClerkEnabled()
    ? "AILX 2026.1 · free to play · a scored sitting needs an account"
    : "AILX 2026.1 · free to play · no account";
}

/**
 * The exam page's own access line, and it is a SEPARATE promise from the
 * landing hero's.
 *
 * "no accounts — just play" was printed beside the start gate in every build.
 * On a deployment that mounts Clerk it is false at the exact moment it matters
 * most — the candidate is standing at the gate they cannot pass — and it was
 * still on screen after `AILX_AUTH=clerk` went live on staging (TEN-125).
 */
export function examAccessCopy(): string {
  return isClerkEnabled() ? "sign in to sit a scored run" : "no accounts — just play";
}

/**
 * The build's basePath — the ONLY place NEXT_PUBLIC_BASE_PATH is read.
 *
 * `next.config.mjs` always bakes the variable ("/ailx" for the Pages export,
 * "" for the hosted build), so the fallback only matters in unit tests, which
 * render components outside a Next build. The fallback deliberately mirrors
 * `next.config.mjs`'s own rule — `env ?? (serverMode ? "" : "/ailx")` — so
 * there is one basePath rule, not two. Six modules used to inline this
 * expression with two different defaults, and the same media file resolved to
 * two different URLs depending on which one asked.
 */
export function basePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? (isServerMode() ? "" : "/ailx");
}

/**
 * Absolute URL for a path served by this build — a file out of
 * `apps/web/public`, or an API route in the hosted build. `path` must start
 * with "/".
 */
export function assetUrl(path: string): string {
  return `${basePath()}${path}`;
}

/**
 * The exam API's own origin, or "" for "this build's same-origin routes".
 *
 * The ONLY place `NEXT_PUBLIC_AILX_API_BASE` is read. Set it and every client
 * call leaves for the separate exam service (Cloud Run); leave it unset and
 * the browser keeps calling `app/api/**` exactly as before, which is what the
 * Playwright suite and every local `AILX_BACKEND=1` run still do.
 *
 * A value that is not a bare absolute http(s) origin is IGNORED rather than
 * half-honoured: a base with a path, a query or a `javascript:` scheme would
 * otherwise be concatenated into every request URL. Same predicate as the
 * server's `AILX_PUBLIC_ORIGIN` (see `lib/origin.ts`) — one origin rule.
 */
export function apiOrigin(): string {
  return normalizeOrigin(process.env.NEXT_PUBLIC_AILX_API_BASE) ?? "";
}

/**
 * Root of the VERSIONED API — the prefix every `/attempts/...`, `/practice`,
 * `/gallery/...` and `/moderation/...` call hangs off.
 *
 * The two hosts spell that prefix differently and always have: the Next
 * routes live under `/api`, the standalone service under `/v1`
 * (`services/api/src/app.ts`). Translating it HERE is the reason there is a
 * seam at all — no call site should know which host it is talking to.
 */
export function apiBase(): string {
  const origin = apiOrigin();
  return origin === "" ? assetUrl("/api") : `${origin}/v1`;
}

/**
 * Root of the SERVED-SITE space. Deliberately not `apiBase()`: a T1 snapshot
 * is served from `/api/site/<digest>/…` on BOTH hosts, because that exact
 * path is already baked into stored share payloads and credential claims
 * (`packages/backend/src/site-url.ts`), and those rows cannot be rewritten.
 */
export function siteApiRoot(): string {
  const origin = apiOrigin();
  return origin === "" ? assetUrl("/api") : `${origin}/api`;
}

/**
 * Stored snapshot PATHS only — never render an arbitrary stored href.
 */
const SITE_PATH_RE = /^\/api\/site\/[^"'\s]+$/;

/**
 * Resolve a server-minted site path (`/api/site/<digest>/index.html`, as it
 * arrives inside a share payload, a gallery entry or a credential) to a URL a
 * browser can actually open — or null when the stored value is not one.
 *
 * Validation and resolution are ONE function on purpose: every caller that
 * needs the URL also needs the check, and a split invited a call site that
 * did the second without the first. Same-origin the result is just the
 * basePath-prefixed path; cross-origin it must name the exam service, or the
 * link would point at a route this frontend does not serve.
 */
export function siteHref(sitePath: string | null | undefined): string | null {
  if (typeof sitePath !== "string" || !SITE_PATH_RE.test(sitePath)) return null;
  return `${siteApiRoot()}${sitePath.slice("/api".length)}`;
}

/** Where the event log lives, for the run-intro lede. */
export function eventLogCopy(): string {
  return isServerMode()
    ? "Your event log is saved on the AILX backend as you play, so you can pick the run back up."
    : "The event log stays in this browser.";
}
