/**
 * AuthProvider seam — spec §11 "Identity ... behind a thin internal
 * AuthProvider interface. The interface exists so that replacing Clerk is a
 * swap, not a rewrite." `participants.auth_ref` stores the provider-scoped
 * reference (`clerk:<sub>` / `dev:<id>`), so identities from different
 * providers can never collide.
 */

export interface AuthContext {
  /** Provider-scoped stable identity, stored in participants.auth_ref. */
  authRef: string;
}

/** Lower-cased header map — framework-agnostic (Fetch Headers, node, tests). */
export type HeaderMap = Readonly<Record<string, string | undefined>>;

export interface AuthProvider {
  readonly name: string;
  /** Resolve the caller’s identity, or null when unauthenticated. */
  verify(headers: HeaderMap): Promise<AuthContext | null>;
}

export const DEV_USER_HEADER = "x-ailx-dev-user";
const DEV_USER_RE = /^[A-Za-z0-9_.@-]{1,64}$/;

/**
 * Dev/test adapter: identity is asserted, never proven. Accepts either the
 * `x-ailx-dev-user: <id>` header or `Authorization: Bearer dev:<id>`.
 * Never enable outside local development.
 */
export class DevAuthProvider implements AuthProvider {
  readonly name = "dev";

  async verify(headers: HeaderMap): Promise<AuthContext | null> {
    let user = headers[DEV_USER_HEADER];
    if (!user) {
      const auth = headers["authorization"];
      if (auth?.startsWith("Bearer dev:")) user = auth.slice("Bearer dev:".length);
    }
    if (!user || !DEV_USER_RE.test(user)) return null;
    return { authRef: `dev:${user}` };
  }
}

export type AuthMode = "dev" | "clerk";

/**
 * Wrap an identity that has ALREADY been verified, so an adapter that
 * authenticates before it reaches the handler (see apps/web `apiRoute`,
 * which must know the caller before it buffers a request body) does not pay
 * for — or diverge from — a second `verify()` call.
 */
export function verifiedAuthProvider(name: string, identity: AuthContext): AuthProvider {
  return { name, verify: async () => identity };
}

/** Opt-in that re-enables assert-only dev auth under NODE_ENV=production. */
export const DEV_AUTH_OVERRIDE = "AILX_ALLOW_INSECURE_DEV_AUTH";

/**
 * Select the provider from the environment — FAIL CLOSED. `AILX_AUTH` has no
 * default: an unset (or unknown) value refuses to start rather than silently
 * granting the assert-only dev identity to anyone who sends a header.
 * `AILX_AUTH=clerk` requires `CLERK_SECRET_KEY`; `AILX_AUTH=dev` is refused
 * under `NODE_ENV=production` unless `AILX_ALLOW_INSECURE_DEV_AUTH=1` is also
 * set (the e2e suite runs a production build against a throw-away database).
 */
export async function authProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<AuthProvider> {
  const mode = env.AILX_AUTH;
  if (mode === undefined || mode === "") {
    throw new Error(
      'AILX_AUTH is not set: refusing to start. Set AILX_AUTH=clerk (with CLERK_SECRET_KEY) for any deployment real participants can reach, or AILX_AUTH=dev for local development only — dev auth accepts an asserted identity with no proof.',
    );
  }
  if (mode === "dev") {
    if (env.NODE_ENV === "production" && env[DEV_AUTH_OVERRIDE] !== "1") {
      throw new Error(
        `AILX_AUTH=dev is refused under NODE_ENV=production: dev auth accepts an asserted identity with no proof, so anyone could impersonate any participant. Set AILX_AUTH=clerk with CLERK_SECRET_KEY, or — only for a throw-away test deployment — set ${DEV_AUTH_OVERRIDE}=1.`,
      );
    }
    return new DevAuthProvider();
  }
  if (mode === "clerk") {
    const secretKey = env.CLERK_SECRET_KEY;
    if (!secretKey) throw new Error("AILX_AUTH=clerk requires CLERK_SECRET_KEY");
    // Dynamic import: @clerk/backend is only loaded when Clerk is selected.
    const { ClerkAuthProvider } = await import("./clerk.js");
    return new ClerkAuthProvider(secretKey);
  }
  throw new Error(`unknown AILX_AUTH mode: ${mode} (expected "dev" or "clerk")`);
}
