"use client";
/**
 * Count one view of THIS share card, and render nothing.
 *
 * A component for the same reason `FunnelStep` is one: the share view is
 * already deep in a render when it learns the card resolved, and a metric
 * must never change the shape of a page. It draws nothing, blocks nothing
 * and cannot fail a render — `countShareView` swallows its own errors
 * (lib/data/shareViews.ts).
 *
 * MOUNTED ONLY IN THE RESOLVED BRANCH, beside `<FunnelStep step="share_opened" />`,
 * so a 404, a revoked token or an unreachable service counts nothing. The
 * effect is deduped per token per browsing session, so React's strict-mode
 * double mount, a re-render and a reload are one view.
 */
import { useEffect } from "react";
import { countShareView } from "../lib/data/shareViews";

export function ShareViewCount({ token }: { token: string }): null {
  useEffect(() => {
    countShareView(token);
  }, [token]);
  return null;
}
