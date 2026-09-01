"use client";
/**
 * The only sign-in affordance, and deliberately the only one.
 *
 * AILX has an anonymous on-ramp: the game plays without an account, and the
 * dev identity keeps a run coherent inside one browser. Signing in buys the
 * things an identity is actually needed for — a sitting that can be scored on
 * the record, and progress that survives a new device — so it is a link in the
 * nav, never a gate in front of `/practice` or `/exam`.
 *
 * `useAuth()` rather than `<SignedIn>` / `<SignedOut>`: Clerk Core 3 (the
 * @clerk/nextjs v7 line) REMOVED those control components, and their
 * replacements throw at render — which is a failed build, found by the hosted
 * `next build` and pinned by `test/clerkMount.test.tsx` so the next person
 * copying a Clerk snippet from the internet finds out in a second, not in a
 * deploy.
 *
 * `isSignedIn` is undefined until Clerk has loaded, and that renders NOTHING:
 * showing "Sign in" to somebody who is already signed in, for one frame on
 * every page, is worse than a nav item that appears a moment late.
 */
import { UserButton, useAuth } from "@clerk/nextjs";
import { NavLink } from "../NavLink";

export function AuthNav() {
  const { isSignedIn } = useAuth();
  if (isSignedIn === undefined) return null;
  return isSignedIn ? <UserButton /> : <NavLink href="/sign-in">Sign in</NavLink>;
}
