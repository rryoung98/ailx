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
 * Rendered only where Clerk is mounted (`AuthShell`), because in the static
 * export `/sign-in` does not exist.
 */
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { NavLink } from "../NavLink";

export function AuthNav() {
  return (
    <>
      <SignedOut>
        <NavLink href="/sign-in">Sign in</NavLink>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </>
  );
}
