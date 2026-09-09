"use client";
/**
 * The footer's provenance line, as the browser can actually tell it.
 *
 * `footerModeCopy()` is pure and the model endpoint is a localStorage slot,
 * so somebody has to read it: this component does, in an effect, and renders
 * nothing else. The first (server) paint is deliberately the unconnected
 * sentence — the static export is prerendered once for every visitor, so a
 * connected sentence in the HTML would be both a hydration mismatch and a
 * claim about a browser the build has never met.
 */
import { useEffect, useState } from "react";
import { footerModeCopy } from "../lib/mode";

/**
 * The slot the T1 and T4 runners read, spelled here rather than imported.
 *
 * `@ailx/track-t1` exports it (`LLM_BASE_URL_STORAGE`) and this component is
 * in the ROOT LAYOUT, so importing the constant from that package drags the
 * T1 barrel — Runner and all — into the chunk every page loads: +11 kB gzip
 * on all nine prerendered pages, measured, and three budgets in
 * `test/bundleBudget.test.ts` went red. One string is the cheaper copy, and
 * `test/mode.test.tsx` pins it EQUAL to the track's own constant, so the two
 * cannot drift.
 */
export const MODEL_ENDPOINT_SLOT = "foray:llm-base-url";

export function FooterMode(): React.ReactElement {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  useEffect(() => {
    try {
      setEndpoint(window.localStorage.getItem(MODEL_ENDPOINT_SLOT));
    } catch {
      // A locked-down profile has no slot, which is the unconnected case.
    }
  }, []);
  return <p>{footerModeCopy(endpoint)}</p>;
}
