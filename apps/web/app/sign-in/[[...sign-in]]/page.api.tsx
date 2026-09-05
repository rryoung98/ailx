/**
 * Sign-in, and only where signing in is possible.
 *
 * `page.api.tsx` is the hosted-build-only naming convention
 * (`next.config.mjs` pageExtensions): the static GitHub Pages export has no
 * auth provider, so it must not ship a route that can only fail. The catch-all
 * segment is Clerk's requirement — the component owns the sub-steps
 * (factor two, reset, SSO callback) under this one path.
 *
 * Nothing on this site redirects here. AILX has an anonymous on-ramp: the game
 * plays without an account, and signing in buys a scored sitting and progress
 * that outlives one browser (docs/ARCHITECTURE.md §10.2).
 *
 * THE ROUTE IS GATED ON THE KEY, not only on the build (TEN-155). The naming
 * convention keeps it out of the static export, but a hosted build with no
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — which is what `vercel env pull`
 * produces, and what any deploy that forgets the key has — compiled it all the
 * same. `isClerkEnabled()` is false there, so no `<ClerkProvider>` is mounted,
 * and `<SignIn>` calls `useSession`, which THROWS: the one screen that would
 * tell you the key is missing was the one screen that crashed. A 404 is the
 * true answer — on that deployment there is no sign-in.
 */
import { notFound } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { isClerkEnabled } from "../../../lib/mode";

export const metadata = { title: "Sign in — Foray" };

export default function SignInPage() {
  if (!isClerkEnabled()) notFound();
  return (
    <main className="container" style={{ display: "grid", justifyContent: "center", padding: "3rem 0" }}>
      <SignIn path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
    </main>
  );
}
