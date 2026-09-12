/**
 * Mount Clerk, or do not — one decision, made once, for the whole tree.
 *
 * The hosted build wraps the app in `<ClerkProvider>` and mounts the token
 * bridge; the static GitHub Pages export renders its children untouched and
 * has no auth at all. Both facts live here rather than in `app/layout.tsx`,
 * which is shared by both builds and should not grow a second concern.
 *
 * `isClerkEnabled()` is true whenever `AILX_BACKEND=1`. If the publishable
 * key is missing, `ClerkProvider` throws on first render — that is the
 * correct outcome: a hosted deploy without a key is a configuration error,
 * not a silently degraded app.
 */
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { isClerkEnabled } from "../mode";
import { ClaimProgress } from "./ClaimProgress";
import { ClerkTokenBridge } from "./ClerkTokenBridge";
import { FunnelIdentity } from "./FunnelIdentity";

export function AuthShell({ children }: { children: ReactNode }) {
  if (!isClerkEnabled()) return <>{children}</>;
  return (
    <ClerkProvider>
      <ClerkTokenBridge />
      {/* After the bridge, never before it: the claim needs the identity the
          bridge publishes, and the token that goes with it. */}
      <ClaimProgress />
      {/* Counts that an account arrived, and nothing about whose it is. */}
      <FunnelIdentity />
      {children}
    </ClerkProvider>
  );
}
