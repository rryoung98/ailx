"use client";

/**
 * The OAuth PKCE callback, claimed exactly once.
 *
 * An authorization code is single-use and so is the verifier that redeems it.
 * The old effect read both, started the exchange, and cleaned up in
 * `.finally()` behind an `if (cancelled) return` — so React 18/19 StrictMode
 * ran it twice in development, the second exchange spent an already-spent code
 * and painted an error over a sign-in that had worked (TEN-64 defect 1). An
 * unmount mid-flight left the verifier in storage and the code in the URL and
 * in browser history (defects 2 and 3).
 *
 * Both are taken out of the browser HERE, before any request is made. The
 * second caller finds no code in the URL and no verifier in storage, so it
 * returns null and asks for nothing. Cleanup is not on the success path; it
 * is the read itself.
 */
import { PKCE_VERIFIER_STORAGE, cleanCallbackUrl, extractCallbackCode } from "@ailx/track-t1";

export interface PkceClaim {
  readonly code: string;
  readonly verifier: string;
}

/**
 * The `?code=` and its verifier, removed from the URL and from storage, or
 * null when this page load is not an OAuth callback.
 *
 * A code with no verifier still clears the URL: it cannot be redeemed by
 * anyone here, and leaving it in the address bar and in history is the same
 * exposure with none of the use.
 */
export function claimPkceCallback(): PkceClaim | null {
  const code = extractCallbackCode(window.location.search);
  if (!code) return null;
  let verifier: string | null = null;
  try {
    verifier = window.localStorage.getItem(PKCE_VERIFIER_STORAGE);
    window.localStorage.removeItem(PKCE_VERIFIER_STORAGE);
  } catch {
    /* storage unavailable — there is no verifier to redeem with */
  }
  try {
    window.history.replaceState(null, "", cleanCallbackUrl(window.location.href));
  } catch {
    /* history unavailable — the exchange still runs, the URL keeps the code */
  }
  return verifier ? { code, verifier } : null;
}
