/**
 * The connected model endpoint, as the whole browser agrees to spell it.
 *
 * ONE slot and ONE announcement, in a leaf module with no React, no DOM and
 * no track imports, so every reader can have them at no cost. That matters
 * because the readers are on both sides of a bundle boundary: the T1 and T4
 * runners read the slot, `ConnectPanel` writes it, and `FooterMode` — which
 * is in the ROOT LAYOUT — must read it too. Importing the constant from
 * `@ailx/track-t1` dragged the T1 barrel (Runner and all) into the chunk
 * every page loads: +11 kB gzip on all nine prerendered pages, measured, and
 * six budgets in `apps/web/test/bundleBudget.test.ts` went red. The answer
 * was a duplicated string, which is two spellings of one fact — the exact
 * thing `storageKeys.ts` argues against — and it cost a live defect: the
 * footer read the slot once and never heard the change.
 *
 * It lives in `@ailx/core` rather than `apps/web/lib` because a package
 * cannot import from an app. Core is the ONLY workspace package all four
 * readers already depend on, and the root layout already imports it, so this
 * module is free in the shared chunk.
 *
 * The slot holds a URL, NEVER a credential. TEN-62 moved the provider key to
 * the exam service, sealed against the caller's identity; a browser that
 * holds this value holds an OpenAI-compatible base URL and nothing more.
 */

/** Persisted OpenAI-compatible API base (the gateway, the demo proxy, Ollama). */
export const MODEL_ENDPOINT_SLOT = "foray:llm-base-url";

/**
 * Fired on `window` after every write to the slot, by the one writer.
 *
 * A `storage` event is no substitute: the browser does not deliver it to the
 * tab that made the change, and the tab that made the change is the one
 * showing the sentence that just stopped being true.
 */
export const CONNECTION_CHANGED_EVENT = "foray:connection-changed";
