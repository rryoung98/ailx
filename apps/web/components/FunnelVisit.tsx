"use client";
/**
 * Open a browsing session on EVERY page, and render nothing.
 *
 * Step one of docs/KPI.md is "a browser opened Foray", and it was measuring
 * something narrower: `visit_started` rides out with the first event a page
 * asks for, so a page that emits no step of its own emitted nothing at all.
 * Six top-level routes are in that state — /progress, /report, /gallery,
 * /world, /validate and /methodology — and one of them, /progress, is where a
 * returning player goes first. A return that leaves no row is a return D1
 * cannot see.
 *
 * Mounted in `app/layout.tsx` rather than in `AuthShell`, so it does not
 * depend on Clerk being configured: a hosted build on the asserted dev
 * identity is a real mode and its visits are real visits. It is null, it
 * cannot throw (the emitter swallows its own failures) and it is silent in
 * the static export, which has no backend to post to.
 */
import { useEffect } from "react";
import { funnel } from "../lib/data/funnel";

export function FunnelVisit(): null {
  useEffect(() => {
    funnel().visit();
  }, []);
  return null;
}
