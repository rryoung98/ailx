/**
 * OpenRouter OAuth PKCE "quick SSO" — https://openrouter.ai/docs/oauth
 *
 * Flow (all client-side; this is a static site):
 *  1. generateCodeVerifier() -> random verifier, stored locally
 *  2. computeCodeChallenge() -> S256 challenge (SHA-256, base64url)
 *  3. redirect to buildAuthUrl(callbackUrl, challenge)
 *  4. OpenRouter redirects back with ?code=...
 *  5. exchangeCodeForKey() POSTs the code + verifier to /api/v1/auth/keys
 *     and receives a USER-SCOPED key (the user spends their own credits)
 *  6. the key goes into the same localStorage slot as a pasted key
 *
 * Crypto and fetch are injected so every helper is unit-testable without a
 * browser or network. No secrets live in this module — the repo is public.
 */
import { DEFAULT_BASE_URL, OpenRouterError } from "./openrouter.js";

export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const OPENROUTER_KEY_EXCHANGE_URL = `${DEFAULT_BASE_URL}/auth/keys`;
/** Where the in-flight PKCE verifier waits out the redirect round-trip. */
export const PKCE_VERIFIER_STORAGE = "ailx:openrouter-pkce-verifier";

/** RFC 4648 §5 base64url (no padding) over raw bytes. Pure. */
export function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of view) bin += String.fromCharCode(b);
  // btoa is available in browsers and Node >= 16.
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type GetRandomValues = (array: Uint8Array) => Uint8Array;

/**
 * RFC 7636 code_verifier: 32 random bytes, base64url encoded (43 chars,
 * all within the unreserved charset). getRandomValues is injected.
 */
export function generateCodeVerifier(getRandomValues: GetRandomValues): string {
  const bytes = new Uint8Array(32);
  getRandomValues(bytes);
  return base64Url(bytes);
}

export interface DigestLike {
  digest(algorithm: "SHA-256", data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
}

/** RFC 7636 S256: base64url(sha256(ascii(verifier))). subtle is injected. */
export async function computeCodeChallenge(
  verifier: string,
  subtle: DigestLike,
): Promise<string> {
  const data = new TextEncoder().encode(verifier) as Uint8Array<ArrayBuffer>;
  const hash = await subtle.digest("SHA-256", data);
  return base64Url(hash);
}

/** The OpenRouter /auth redirect URL for a given callback + challenge. */
export function buildAuthUrl(callbackUrl: string, codeChallenge: string): string {
  const q = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${OPENROUTER_AUTH_URL}?${q.toString()}`;
}

export interface KeyExchangePayload {
  code: string;
  code_verifier: string;
  code_challenge_method: "S256";
}

/** POST body for /api/v1/auth/keys. Pure. */
export function buildKeyExchangePayload(
  code: string,
  verifier: string,
): KeyExchangePayload {
  return { code, code_verifier: verifier, code_challenge_method: "S256" };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Exchange the callback ?code= for a user-scoped OpenRouter key.
 * fetch injected; throws OpenRouterError with a user-facing message.
 */
export async function exchangeCodeForKey(
  fetchImpl: FetchLike,
  code: string,
  verifier: string,
): Promise<string> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(OPENROUTER_KEY_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildKeyExchangePayload(code, verifier)),
    });
  } catch {
    throw new OpenRouterError("Network error during OpenRouter sign-in.", null);
  }
  if (!res.ok) {
    throw new OpenRouterError(
      `OpenRouter sign-in failed (HTTP ${res.status}). Try connecting again.`,
      res.status,
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new OpenRouterError("OpenRouter sign-in returned unparseable JSON.", res.status);
  }
  const key = (json as { key?: unknown })?.key;
  if (typeof key !== "string" || key.length === 0) {
    throw new OpenRouterError("OpenRouter sign-in reply had no key.", res.status);
  }
  return key;
}

/** Read the OAuth ?code= from a location.search string. Pure. */
export function extractCallbackCode(search: string): string | null {
  try {
    const code = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("code");
    return code && code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

/**
 * Return href with the OAuth params stripped (for history.replaceState and
 * as the callback_url we hand to /auth). Pure.
 */
export function cleanCallbackUrl(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.delete("code");
    u.hash = "";
    return u.toString();
  } catch {
    return href;
  }
}
