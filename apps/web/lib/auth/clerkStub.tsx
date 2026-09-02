/**
 * The static export's stand-in for `@clerk/nextjs`.
 *
 * The GitHub Pages build has no auth at all (docs/ARCHITECTURE.md §10.2), and
 * it must not carry an auth SDK it can never use: `next.config.mjs` aliases
 * `@clerk/nextjs` to THIS module whenever AILX_BACKEND is unset, so the export
 * resolves the imports below instead of ~100 kB of provider it would never
 * mount. Nothing here ever renders in that build either — `isClerkEnabled()`
 * is false without a server build — so these are shapes, not behaviour.
 *
 * Keep the export list equal to what `lib/auth/*` actually imports; a missing
 * name is a static-export build failure, and `test/clerkMount.test.tsx` pins
 * the pair together so the two cannot drift.
 */
import type { ReactNode } from "react";

export function ClerkProvider({ children }: { children?: ReactNode }): ReactNode {
  return children ?? null;
}

/** Nobody is ever signed in here, so the bridge registers no token source. */
export function useAuth(): {
  isSignedIn: boolean;
  userId: string | null;
  getToken: () => Promise<string | null>;
} {
  return { isSignedIn: false, userId: null, getToken: async () => null };
}

/** Never reached: `AuthNav` only renders where Clerk is mounted. */
export function UserButton(): ReactNode {
  return null;
}
