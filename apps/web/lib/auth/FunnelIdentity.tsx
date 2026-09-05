"use client";
/**
 * The identity step: an account exists and this browser is holding it.
 *
 * Mounted beside `ClaimProgress`, and separate from it, because they answer
 * different questions — the claim MOVES practice days to a new account, this
 * one COUNTS that an account arrived. Folding the count into the claim would
 * tie a KPI to whether there happened to be days to move.
 *
 * NO account id travels (the funnel schema forbids it). This says "somebody
 * signed in during this session", which is the whole of what the funnel needs.
 *
 * `"signed-in"` and nothing else. A hosted build with no Clerk key publishes
 * `"asserted"` — a dev id the service accepts with no account behind it — and
 * it used to be called signed-in too, so every page load on such a deployment
 * counted step 6, which docs/KPI.md defines as "an account exists and this
 * browser holds it" (TEN-153).
 */
import { useEffect } from "react";
import { funnel } from "../data/funnel";
import { useIdentity } from "./identityState";

export function FunnelIdentity(): null {
  const identity = useIdentity();
  useEffect(() => {
    if (identity.status === "signed-in") funnel().step("signed_in");
  }, [identity.status]);
  return null;
}
