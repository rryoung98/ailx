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
 * Unregistering matters as much as registering: a stale source belonging to a
 * signed-out user would make every request wait on a refresh that can only
 * fail, and `authHeaders()` would then fall back to the dev id anyway — one
 * doomed round trip per call.
 */
import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { setAuthTokenSource } from "../authHeaders";

export function ClerkTokenBridge(): null {
  const { isSignedIn, getToken } = useAuth();
  useEffect(() => {
    // `isSignedIn` is UNDEFINED until Clerk has loaded, and that is the whole
    // loading guard: only a literal true is a session. There is no separate
    // `isLoaded` check because it could never disagree — a mutation test
    // proved it dead rather than defensive.
    if (isSignedIn !== true) {
      setAuthTokenSource(null);
      return;
    }
    setAuthTokenSource(() => getToken());
    return () => setAuthTokenSource(null);
  }, [isSignedIn, getToken]);
  return null;
}
