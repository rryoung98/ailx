/**
 * The identity CONTRACT — the two names a dev-mode identity travels under,
 * and the header shape every adapter normalizes to.
 *
 * The PROOF of an identity is a server duty and stays there (`@ailx/backend`
 * `auth.ts`: `DevAuthProvider`, Clerk, `authProviderFromEnv`). What is here
 * is only the spelling: the browser writes `ailx_dev_user` next to
 * `localStorage["ailx:dev-user"]` and sends `x-ailx-dev-user`, and the server
 * reads exactly those two names. Two spellings would be an identity nobody
 * receives.
 */

/** Lower-cased header map — framework-agnostic (Fetch Headers, node, tests). */
export type HeaderMap = Readonly<Record<string, string | undefined>>;

export const DEV_USER_HEADER = "x-ailx-dev-user";

/**
 * Cookie twin of `DEV_USER_HEADER`, carrying the SAME asserted id. A header
 * can only ride on a `fetch()` the app itself makes; a server-rendered PAGE
 * is reached by an ordinary document navigation, which carries cookies and
 * nothing else. Without this, `/progress` could never know who the browser
 * is and told every visitor "we do not know who you are".
 *
 * This is a dev-auth convenience, not a session: it is still asserted, never
 * proven, and it is only ever read by `DevAuthProvider`. Clerk remains the
 * real answer anywhere real participants can reach (see docs/DEPLOY.md).
 */
export const DEV_USER_COOKIE = "ailx_dev_user";

/**
 * What a legal asserted dev id looks like — ONE definition, asserted from both
 * sides of the repository split.
 *
 * It has to live here because the guarantee spans two repos and neither can
 * see the other: the BROWSER writes the id (`apps/web/lib/persistence.ts`, the
 * public repo) and `DevAuthProvider` decides whether to accept it (the private
 * one). The public suite used to import `DevAuthProvider` to close that loop,
 * which is exactly the in-process coupling the split removes. So the shape is
 * shared and each side pins its own half against it: the browser only ever
 * emits ids matching this, and the provider only ever accepts ids matching
 * this. A divergence now fails a test instead of silently rejecting everybody.
 *
 * Deliberately narrow. The id reaches a header, a cookie and a `dev:<id>`
 * `auth_ref`, so no whitespace, no separators, no control characters and a
 * bounded length — an id that needed escaping in any of those three places
 * would be a way to say something the other two did not hear.
 */
export const DEV_USER_RE = /^[A-Za-z0-9_.@-]{1,64}$/;

/** Is this a legal asserted dev id? Pure, and the only spelling of the rule. */
export function isDevUserId(value: string | undefined | null): boolean {
  return typeof value === "string" && DEV_USER_RE.test(value);
}
