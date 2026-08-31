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
