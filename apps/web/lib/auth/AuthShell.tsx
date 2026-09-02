/**
 * Mount Clerk, or do not — one decision, made once, for the whole tree.
 *
 * The hosted build wraps the app in `<ClerkProvider>` and mounts the token
 * bridge; the static GitHub Pages export renders its children untouched and
 * has no auth at all. Both facts live here rather than in `app/layout.tsx`,
 * which is shared by both builds and should not grow a second concern.
 *
 * `isClerkEnabled()` is false when the publishable key is missing, so a hosted
 * build (or a local `AILX_BACKEND=1 next build`) without Clerk configured is a
 * working app on dev auth — not a provider that throws on first render. That
 * is what makes the cutover in docs/ARCHITECTURE.md §10.2 reversible: with no
 * provider mounted, `authHeaders()` is already back on the asserted dev id.
 */
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { isClerkEnabled } from "../mode";
import { ClaimProgress } from "./ClaimProgress";
import { ClerkTokenBridge } from "./ClerkTokenBridge";

export function AuthShell({ children }: { children: ReactNode }) {
  if (!isClerkEnabled()) return <>{children}</>;
  return (
    <ClerkProvider>
      <ClerkTokenBridge />
      {/* After the bridge, never before it: the claim needs the identity the
          bridge publishes, and the token that goes with it. */}
      <ClaimProgress />
      {children}
    </ClerkProvider>
  );
}
