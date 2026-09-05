"use client";

/**
 * ONE way for the browser to reach the exam service's MODEL GATEWAY.
 *
 * The provider key used to live in this browser, in localStorage, and the
 * browser did the OAuth PKCE exchange itself. It no longer does either
 * (TEN-62). The service holds the key, sealed against the caller's identity;
 * the browser starts a connection, is redirected, comes back with a code, and
 * hands that code to the service — which exchanges it. What the browser ends
 * up holding is a 12-hex FINGERPRINT, which is not a credential and buys
 * nothing.
 *
 * Every route here is mounted behind the service's auth seam, so an
 * unauthenticated caller is refused with 401 before a body is read. That is
 * also why the STATIC EXPORT cannot use this module at all: GitHub Pages has
 * no exam service and no identity, so it keeps the standalone shared-demo
 * proxy (`services/openrouter-proxy`) instead. `modelGatewayAvailable()` is
 * the one place that difference is decided.
 *
 * No path is spelled here: `apiPath()` builds every one from the manifest in
 * `@ailx/contract`, and `apiBase()` in `lib/mode.ts` stays the only module
 * that knows which host answers.
 */
import { apiPath, MODEL_ROOT, type ApiPath } from "@ailx/contract";
import type { StorageLike } from "@ailx/session";
import { serviceHeaders } from "./traceparent";
import { apiBase, apiOrigin, isServerMode } from "../mode";

/** What the service says about a stored key. Never the key. */
export interface KeyStatus {
  readonly connected: boolean;
  readonly provider: string;
  /** 12 hex characters. Enough to recognise a key, useless to spend. */
  readonly fingerprint?: string;
  readonly connectedAt?: string;
}

/**
 * A status the service AUTHORITATIVELY gave (200), or a refusal with its
 * status.
 *
 * The two used to be flattened into `{ connected: false }`, and a review
 * caught what that costs: a 500 on DELETE told the reader their key had been
 * deleted when the service may still hold it, and a 401 on GET silently
 * cleared the stored endpoint. A refusal is a different fact from "there is
 * no key", and the panel says so.
 */
export type KeyStatusResult =
  | { readonly ok: true; readonly status: KeyStatus }
  | { readonly ok: false; readonly httpStatus: number };

/** 12 lowercase hex. Anything else is not a fingerprint, whatever it claims. */
const FINGERPRINT_RE = /^[0-9a-f]{12}$/;

/**
 * Read a status body, keeping only what the contract promises.
 *
 * The body was cast before, and a review pointed out what that means: this
 * page claims it "sees only a fingerprint", and an unchecked cast makes that
 * a claim about the SERVICE rather than about this code. A `fingerprint` that
 * is not 12 hex characters — an OpenRouter key, say — is DROPPED here, so the
 * claim is true of the browser no matter what arrives.
 */
export function readStatusBody(body: unknown): KeyStatus | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;
  if (typeof raw.connected !== "boolean") return null;
  const print = typeof raw.fingerprint === "string" && FINGERPRINT_RE.test(raw.fingerprint) ? raw.fingerprint : undefined;
  return {
    connected: raw.connected,
    provider: typeof raw.provider === "string" ? raw.provider : "openrouter",
    fingerprint: print,
    connectedAt: typeof raw.connectedAt === "string" ? raw.connectedAt : undefined,
  };
}

/** Where the browser is sent, and the state the service expects back. */
export interface ConnectStart {
  readonly state: string;
  readonly authorizeUrl: string;
}

/** The `?code=&state=` a provider redirect left in the address bar. */
export interface ModelCallback {
  readonly code: string;
  readonly state: string;
}

/**
 * Is there a service to hold a key at all?
 *
 * BOTH conditions, and a review found out why. `AILX_BACKEND=1` alone means
 * "this build compiles the database-reading pages"; it does not mean a model
 * gateway answers. This repo has NO api routes (AGENTS.md, "The repository
 * split"), so a hosted build with `NEXT_PUBLIC_AILX_API_BASE` unset would
 * offer a Connect button that calls `/api/model/connect/start` — a 404 on its
 * own origin. The gateway lives on the exam service or nowhere.
 */
export function modelGatewayAvailable(): boolean {
  return isServerMode() && apiOrigin() !== "";
}

/**
 * The OpenAI-compatible base URL a track runner talks to in hosted mode.
 *
 * `<service>/v1/model` + `/chat/completions` is the shape an OpenAI client
 * already builds, so the runners keep ONE request builder for the gateway and
 * for a local endpoint. Built from `MODEL_ROOT`, never spelled here.
 */
export function modelGatewayBase(): string {
  return `${apiBase()}${MODEL_ROOT}`;
}

/** The browser's own store, or null where there is none. Never fabricated. */
function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : (window.localStorage as StorageLike | null);
  } catch {
    return null;
  }
}

/**
 * One identified request at the gateway, as `(status, body)`.
 *
 * A non-200 is returned rather than thrown, because every caller here has to
 * tell 401 ("this build has no identity") from 501 ("this deployment holds no
 * keys") from 404 ("that callback was already spent"), and an exception
 * flattens all three into "something went wrong".
 */
async function gatewayCall(
  path: ApiPath,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const storage = browserStorage();
  const identity = storage === null ? {} : await serviceHeaders(storage);
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...identity, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* an empty or unreadable body is reported by its status alone */
  }
  return { status: res.status, body };
}

/**
 * `fetch` with this browser's identity attached — what a track runner is
 * handed instead of an API key.
 *
 * The runner builds the request; this adds WHO is asking. It cannot add a
 * provider credential, because it does not have one.
 *
 * IDENTITY IS ONLY EVER SENT TO THE GATEWAY. A runner's endpoint can be a
 * local Ollama, or the standalone demo proxy, or anything a reader typed into
 * the manual box; sending them `x-ailx-dev-user` (or a Clerk JWT) would hand
 * this browser's identity to a third party for no benefit, and in the static
 * export EVERY endpoint is a third party. So the prefix is checked, and a
 * request that is not going to the gateway goes out bare.
 */
export async function modelGatewayFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const storage = browserStorage();
  const toGateway = modelGatewayAvailable() && input.startsWith(`${modelGatewayBase()}/`);
  const identity = storage === null || !toGateway ? {} : await serviceHeaders(storage);
  return fetch(input, { ...init, headers: { ...safeCallerHeaders(init.headers), ...identity } });
}

/**
 * Headers a track runner is allowed to set on a model call.
 *
 * An ALLOWLIST, because a review pointed out that forwarding the caller's
 * headers verbatim leaves the credential-free boundary open: a runner could
 * still put `Authorization` or `X-API-Key` on a request and this function
 * would carry it. Nothing in `packages/tracks` sets either today — that is
 * the point of keeping it impossible rather than merely absent. Identity is
 * added afterwards and cannot be spoofed by a caller, because it is spread
 * last.
 */
const CALLER_HEADERS = new Set(["content-type", "accept"]);

export function safeCallerHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers === undefined) return out;
  const entries =
    headers instanceof Headers
      ? [...headers.entries()]
      : Array.isArray(headers)
        ? headers
        : Object.entries(headers);
  for (const [name, value] of entries) {
    if (CALLER_HEADERS.has(String(name).toLowerCase())) out[String(name)] = String(value);
  }
  return out;
}

/** Connected or not, and under which fingerprint. */
export async function readKeyStatus(): Promise<KeyStatusResult> {
  let answered: { status: number; body: unknown };
  try {
    answered = await gatewayCall(apiPath("modelKey"));
  } catch {
    return { ok: false, httpStatus: 0 };
  }
  const status = readStatusBody(answered.body);
  if (answered.status !== 200 || status === null) return { ok: false, httpStatus: answered.status };
  return { ok: true, status };
}

/** Forget the stored key. Revoking it at the provider is the owner's to do. */
export async function disconnectKey(): Promise<KeyStatusResult> {
  let answered: { status: number; body: unknown };
  try {
    answered = await gatewayCall(apiPath("disconnectModelKey"), { method: "DELETE" });
  } catch {
    return { ok: false, httpStatus: 0 };
  }
  const status = readStatusBody(answered.body);
  if (answered.status !== 200 || status === null) return { ok: false, httpStatus: answered.status };
  return { ok: true, status };
}

/** What a failed read or delete means, by status. Said once. */
export function statusFailureCopy(httpStatus: number): string {
  if (httpStatus === 401) return "The Foray service does not know who you are, so it will not say what it holds. Sign in.";
  if (httpStatus === 0) return "The Foray service could not be reached, so what it holds is unknown. Nothing here was changed.";
  return `The Foray service refused (HTTP ${httpStatus}), so what it holds is unknown. Nothing here was changed.`;
}

/**
 * What a refusal MEANS, in the words a candidate is shown.
 *
 * Said once so the two call sites cannot disagree, and stated by status
 * because each one is a different fact about this deployment.
 */
export function connectFailureCopy(status: number): string {
  if (status === 401) return "Sign in before connecting a model: the service stores your key against your identity.";
  if (status === 501) return "This deployment holds no provider keys, so there is nothing to connect to yet.";
  if (status === 429) return "Too many connection attempts. Wait a minute and try again.";
  return "The Foray service could not start an OpenRouter connection. Try again in a moment.";
}

/**
 * Begin a connection. The reply carries the URL to send the browser to; it
 * carries no secret, because the PKCE verifier never leaves the service.
 */
export async function startConnect(): Promise<{ ok: true; start: ConnectStart } | { ok: false; message: string }> {
  const { status, body } = await gatewayCall(apiPath("startModelConnect"), { method: "POST", body: "{}" });
  const start = body as Partial<ConnectStart> | null;
  if (status !== 200 || typeof start?.authorizeUrl !== "string" || typeof start?.state !== "string") {
    return { ok: false, message: connectFailureCopy(status) };
  }
  return { ok: true, start: { authorizeUrl: start.authorizeUrl, state: start.state } };
}

/** What a callback refusal means. Each status is a different fact. */
export function callbackFailureCopy(status: number): string {
  if (status === 401) return "Sign in before connecting a model: the service stores your key against your identity.";
  if (status === 404) return "That sign-in was already used or was never started here. Connect again.";
  if (status === 410) return "That sign-in took too long and expired. Connect again.";
  if (status === 502) return "OpenRouter did not return a key for that sign-in. Connect again.";
  return "The Foray service could not finish the OpenRouter connection. Connect again.";
}

/**
 * Hand the code to the service, which exchanges it. The browser never sees
 * what comes back from the provider — only a fingerprint.
 */
export async function finishConnect(
  claim: ModelCallback,
): Promise<{ ok: true; status: KeyStatus } | { ok: false; message: string }> {
  const { status, body } = await gatewayCall(apiPath("finishModelConnect"), {
    method: "POST",
    body: JSON.stringify({ code: claim.code, state: claim.state }),
  });
  if (status !== 200 || typeof body !== "object" || body === null) {
    return { ok: false, message: callbackFailureCopy(status) };
  }
  return { ok: true, status: body as KeyStatus };
}

/**
 * The `?code=&state=` of a provider redirect, taken OUT of the URL before it
 * is returned — and therefore claimable exactly once.
 *
 * An authorization code is single-use. React StrictMode runs an effect twice
 * in development, and the second pass used to spend an already-spent code and
 * paint an error over a sign-in that had worked (TEN-64 defect 1). The read
 * IS the cleanup, so the second caller finds nothing and asks for nothing.
 *
 * A code with no state still clears the URL: it can be redeemed by nobody
 * here, and leaving it in the address bar and in history is the same exposure
 * with none of the use. There is no verifier to look for any more — the
 * service holds it, which is the point of the change.
 */
/**
 * Codes this page load has already claimed.
 *
 * Taking the code out of the URL is the primary one-shot, and a review found
 * the hole: when `history.replaceState` throws — a locked-down browser, an
 * iframe — the code stays in `location.search` and the next caller redeems it
 * again. An in-memory record cannot outlive the page, which is exactly the
 * scope a single-use authorization code needs.
 */
const claimedCodes = new Set<string>();

/**
 * Forget what this page load claimed. TESTS ONLY — a real page load starts
 * with an empty set, and there is no browser event that should empty it.
 */
export function resetClaimedCallbacks(): void {
  claimedCodes.clear();
}

export function claimModelCallback(): ModelCallback | null {
  let code: string | null = null;
  let state: string | null = null;
  try {
    const params = new URLSearchParams(window.location.search);
    code = params.get("code");
    state = params.get("state");
  } catch {
    return null;
  }
  if (code === null || code === "" || claimedCodes.has(code)) return null;
  claimedCodes.add(code);
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* history unavailable — the claim still stands, the URL keeps the code */
  }
  return state === null || state === "" ? null : { code, state };
}
