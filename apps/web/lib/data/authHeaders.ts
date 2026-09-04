/**
 * WHO the caller is, and how that travels to the API.
 *
 * One module because there are now two transports for one question, and the
 * choice is a security decision, not a per-call-site detail:
 *
 *  - **Header** — `x-ailx-dev-user` (dev auth) or `Authorization: Bearer`
 *    (Clerk). Works same-origin AND cross-origin, which is the only reason
 *    the Cloud Run cutover is possible at all.
 *  - **Cookie** — `ailx_dev_user`, `SameSite=Lax`, written here as a mirror of
 *    localStorage. It exists ONLY so a same-origin server-rendered page
 *    (`/progress`) can see an identity that a `fetch()` header cannot carry
 *    through a navigation. It is NOT sent to another origin, by design, so it
 *    can never be the identity of record.
 *
 * The server's precedence (`@ailx/backend` `DevAuthProvider`) is header first,
 * cookie last, and an ILLEGAL explicit header is refused outright rather than
 * demoted to whatever cookie the browser happens to carry. Nothing here may
 * weaken that: this module only ever ADDS a header, and the cookie is only
 * ever overwritten from localStorage, never read back into it.
 */
import { DEV_USER_COOKIE, DEV_USER_HEADER } from "@ailx/contract";
import type { StorageLike } from "@ailx/session";

export const DEV_USER_KEY = "ailx:dev-user";

const DEV_USER_RE = /^[A-Za-z0-9_.@-]{1,64}$/;
/** Six months: long enough that a streak survives, short enough to expire. */
const DEV_USER_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

/**
 * Mirror the identity into a cookie so SERVER-RENDERED pages can see it.
 * `x-ailx-dev-user` only exists on fetches this app makes; a navigation to
 * /progress carries cookies and nothing else, so without this the server had
 * to treat every browser as anonymous.
 *
 * Not HttpOnly, and it cannot be: the value is minted here, in the browser,
 * from localStorage — the only writer is this function. Nothing is protected
 * by hiding it from script either, because dev auth is asserted, never
 * proven; anyone can send any id already. Lax keeps it off cross-site
 * requests while still riding a top-level navigation, which is the whole
 * point. localStorage stays the single source of truth: the cookie is only
 * ever overwritten from it, never read back into it, so a cleared browser
 * cannot be silently re-identified as its previous occupant.
 */
function mirrorDevUserCookie(user: string): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${DEV_USER_COOKIE}=${encodeURIComponent(user)}; Path=/; Max-Age=${DEV_USER_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/** Stable per-browser dev identity (dev AuthProvider asserts, never proves). */
export function devUser(storage: StorageLike): string {
  let user = storage.getItem(DEV_USER_KEY);
  if (!user || !DEV_USER_RE.test(user)) {
    user = `web-${Math.random().toString(36).slice(2, 12)}`;
    storage.setItem(DEV_USER_KEY, user);
  }
  mirrorDevUserCookie(user);
  return user;
}

/**
 * Forget this browser's dev identity — BOTH stores, or the next page load
 * would hand the server an id the tab no longer thinks it has.
 */
export function clearDevUser(storage: StorageLike): void {
  storage.removeItem(DEV_USER_KEY);
  if (typeof document === "undefined") return;
  document.cookie = `${DEV_USER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * A bearer token for the current signed-in user, or null when nobody is
 * signed in. Async because every real provider's is (Clerk's `getToken()`
 * refreshes a short-lived JWT).
 */
export type TokenSource = () => Promise<string | null>;

let tokenSource: TokenSource | null = null;

/**
 * DORMANT until the day `AILX_AUTH=clerk`: a mounted provider calls this once
 * with `() => getToken()`, and every call site below starts sending the JWT
 * instead of the asserted dev id — no call site changes.
 *
 * Deliberately a registration, not an import of `@clerk/nextjs`: this module
 * is imported by the static Pages export, which has no auth provider at all
 * and must not pull one into its bundle. Passing null unregisters (sign-out).
 *
 * See docs/ARCHITECTURE.md §10.2 for the atomic switch recipe.
 */
export function setAuthTokenSource(source: TokenSource | null): void {
  tokenSource = source;
}

/** Test/teardown hook: is a real identity provider mounted right now? */
export function hasAuthTokenSource(): boolean {
  return tokenSource !== null;
}

/**
 * How hard a call needs an identity.
 *
 *  - `"required"` — the read is one person's rows, so an id is MINTED if this
 *    browser has none. Without it the service cannot answer the question.
 *  - `"optional"` — a PUBLIC read (`/gallery`, `/world`). It sends the id this
 *    browser already has, so the service can attribute the read while the
 *    policy is "everything behind auth", and sends nothing when there is none.
 *    It must never mint one: minting would hand a first-time visitor an
 *    identity they did not ask for, and would make a page that only works
 *    because it invented a caller (TEN-107).
 */
export type IdentityMode = "required" | "optional";

/**
 * The dev id this browser ALREADY holds, or null. Read-only, deliberately:
 * no mint, no cookie mirror, no side effect a public page could leave behind.
 */
export function existingDevUser(storage: StorageLike): string | null {
  const user = storage.getItem(DEV_USER_KEY);
  return user !== null && DEV_USER_RE.test(user) ? user : null;
}

/**
 * The identity headers for ONE request.
 *
 * A proven token wins over an asserted id, and the two are never sent
 * together: sending both would let a caller pick which one the server reads
 * if the precedence ever changed. A token source that throws or returns
 * nothing falls back to the dev id — the run must not die because a refresh
 * failed, and the server is the thing that decides whether that is enough.
 *
 * On an `"optional"` call the fallback is what this browser already has, and
 * an empty header map when it has nothing.
 */
export async function authHeaders(
  storage: StorageLike,
  mode: IdentityMode = "required",
): Promise<Record<string, string>> {
  if (tokenSource !== null) {
    try {
      const token = await tokenSource();
      if (typeof token === "string" && token !== "") return { authorization: `Bearer ${token}` };
    } catch {
      // Fall through: an expired/refused refresh is the server's call to make.
    }
  }
  if (mode === "required") return { [DEV_USER_HEADER]: devUser(storage) };
  const existing = existingDevUser(storage);
  return existing === null ? {} : { [DEV_USER_HEADER]: existing };
}
