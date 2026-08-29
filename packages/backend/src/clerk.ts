/**
 * Clerk adapter for the AuthProvider seam. Verifies the session JWT locally
 * against Clerk\u2019s JWKS (spec §11: "verified locally at the edge of every
 * Cloud Run handler ... never by an API call per request" — @clerk/backend\u2019s
 * verifyToken caches the JWKS).
 */

import { verifyToken } from "@clerk/backend";
import type { AuthContext, AuthProvider, HeaderMap } from "./auth.js";

export class ClerkAuthProvider implements AuthProvider {
  readonly name = "clerk";

  constructor(private readonly secretKey: string) {}

  async verify(headers: HeaderMap): Promise<AuthContext | null> {
    const auth = headers["authorization"];
    if (!auth?.startsWith("Bearer ")) return null;
    try {
      const payload = await verifyToken(auth.slice("Bearer ".length), {
        secretKey: this.secretKey,
      });
      const sub = (payload as { sub?: unknown }).sub;
      return typeof sub === "string" && sub.length > 0 ? { authRef: `clerk:${sub}` } : null;
    } catch {
      return null; // Expired / malformed / wrong-instance token — unauthenticated.
    }
  }
}
