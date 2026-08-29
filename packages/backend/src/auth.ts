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
  /** Resolve the caller\u2019s identity, or null when unauthenticated. */
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
 * Select the provider from the environment. `AILX_AUTH=clerk` requires
 * `CLERK_SECRET_KEY`; the default (`dev`) needs no keys at all, so tests and
 * local dev never touch Clerk.
 */
export async function authProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<AuthProvider> {
  const mode = env.AILX_AUTH ?? "dev";
  if (mode === "dev") return new DevAuthProvider();
  if (mode === "clerk") {
    const secretKey = env.CLERK_SECRET_KEY;
    if (!secretKey) throw new Error("AILX_AUTH=clerk requires CLERK_SECRET_KEY");
    // Dynamic import: @clerk/backend is only loaded when Clerk is selected.
    const { ClerkAuthProvider } = await import("./clerk.js");
    return new ClerkAuthProvider(secretKey);
  }
  throw new Error(`unknown AILX_AUTH mode: ${mode} (expected "dev" or "clerk")`);
}
