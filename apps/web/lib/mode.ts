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
 * Footer provenance line. The static showcase really is offline — the
 * hosted build is not, and claiming "no network calls" there is a lie the
 * dogfooder caught on every page.
 */
export function footerModeCopy(): string {
  return isServerMode()
    ? "AILX 2026.1 · hosted build. Your run — event log, responses and any published site snapshot — is saved on the AILX backend. Model calls go to the model you connect; without one, every model call is a deterministic simulator seeded by SHA-256 of its inputs."
    : "AILX 2026.1 · static demo build. Every model call is a deterministic simulator, seeded by SHA-256 of its inputs. No network calls. Everything runs in your browser.";
}

/** Where the event log lives, for the run-intro lede. */
export function eventLogCopy(): string {
  return isServerMode()
    ? "Your event log is saved on the AILX backend as you play, so you can pick the run back up."
    : "The event log stays in this browser.";
}
