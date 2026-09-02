"use client";
/**
 * The claim: when an anonymous player signs in, the practice days this
 * browser has been holding move to their new account.
 *
 * It is mounted once, beside the token bridge, and renders nothing. The
 * moment somebody finally signs up is the worst possible moment to lose their
 * streak, so this runs on its own rather than waiting for them to visit a
 * page that happens to ask.
 *
 * Once per account per page life: `claimed` is keyed by account id, so a
 * re-render, a token refresh or a route change never re-posts. Re-posting
 * would be harmless anyway — the server takes the larger of each count, never
 * the sum — but "harmless if it happens twice" is not a reason to do it twice.
 *
 * NO Clerk import. `identityState` is published by `ClerkTokenBridge`, which
 * is the one module in the app that talks to the SDK; this component only
 * needs to know that an identity arrived.
 */
import { useEffect, useRef } from "react";
import { claimLocalPractice } from "../localPractice";
import { useIdentity } from "./identityState";

export function ClaimProgress(): null {
  const identity = useIdentity();
  const claimed = useRef(new Set<string>());
  useEffect(() => {
    if (identity.status !== "signed-in") return;
    // A signed-in identity with no id is the asserted dev identity, which is
    // the same identity the drill was already recording against — there is
    // nothing to move.
    const key = identity.userId;
    if (key === null || claimed.current.has(key)) return;
    claimed.current.add(key);
    void claimLocalPractice(window.localStorage);
  }, [identity]);
  return null;
}
