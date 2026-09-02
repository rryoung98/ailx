"use client";
/**
 * Fire one funnel step when a surface is shown, and render nothing.
 *
 * A component because the surfaces that need it are server components (the
 * landing page) or already deep in a render (the share view), and a metric
 * must never be a reason to make a page a client component. It is `null` on
 * purpose: it draws nothing, blocks nothing and cannot fail a render — the
 * emitter swallows its own errors (lib/funnel.ts).
 *
 * The step is counted once per browsing session, so a reload of the landing
 * page is the same visit, not a second one.
 */
import { useEffect } from "react";
import { funnel, type BareFunnelStep } from "./funnel";

export function FunnelStep({ step }: { step: BareFunnelStep }): null {
  useEffect(() => {
    funnel().step(step);
  }, [step]);
  return null;
}
