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
 */
import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign in — Foray" };

export default function SignInPage() {
  return (
    <main className="container" style={{ display: "grid", justifyContent: "center", padding: "3rem 0" }}>
      <SignIn path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
    </main>
  );
}
