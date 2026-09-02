"use client";
/**
 * The one place a Clerk session becomes an `Authorization` header.
 *
 * `lib/authHeaders.ts` owns WHICH credential travels with a request and stays
 * SDK-free so the static export never pulls an auth provider into its bundle
 * (docs/ARCHITECTURE.md §10.2). This component is the other half: mounted once
 * inside `<ClerkProvider>`, it registers `() => getToken()` while somebody is
 * signed in and unregisters on sign-out. No call site changes, and no second
 * module learns the rule.
 *
 * It also publishes the same fact to `lib/auth/identityState.ts`, in the same
 * effect, because they are one fact: WHO the browser is. A second module
 * asking Clerk the same question separately is how two answers appear.
 *
 * Unregistering matters as much as registering: a stale source belonging to a
 * signed-out user would make every request wait on a refresh that can only
 * fail, and `authHeaders()` would then fall back to the dev id anyway — one
 * doomed round trip per call.
 */
import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { setAuthTokenSource } from "../authHeaders";
import { publishIdentity } from "./identityState";

export function ClerkTokenBridge(): null {
  const { isSignedIn, getToken, userId } = useAuth();
  useEffect(() => {
    // `isSignedIn` is UNDEFINED until Clerk has loaded, and that is the whole
    // loading guard: only a literal true is a session. There is no separate
    // `isLoaded` check because it could never disagree — a mutation test
    // proved it dead rather than defensive.
    if (isSignedIn !== true) {
      setAuthTokenSource(null);
      // `undefined` is Clerk still loading, `false` is a resolved anonymous
      // visitor. A view that showed the anonymous state for the first is
      // wrong for one frame on every page load, and the drill would deal a
      // round a signed-in account never hears about.
      publishIdentity(
        isSignedIn === false
          ? { status: "anonymous", userId: null }
          : { status: "pending", userId: null },
      );
      return;
    }
    setAuthTokenSource(() => getToken());
    publishIdentity({ status: "signed-in", userId: userId ?? null });
    return () => setAuthTokenSource(null);
  }, [isSignedIn, getToken, userId]);
  return null;
}
