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
 *
 * It also LISTENS. Reading once on mount was TEN-121 narrowed, not closed:
 * the only writer of the slot is `ConnectPanel`, which lives on /exam, so
 * the page where a candidate connects the shared proxy is exactly the page
 * where a mount-only read is already stale. The slot key and the event are
 * `@ailx/core`'s (`connection.ts`) — one spelling for the footer, the panel
 * and both runners, in a leaf module the root layout can afford.
 */
import { CONNECTION_CHANGED_EVENT, MODEL_ENDPOINT_SLOT } from "@ailx/core";
import { useCallback, useEffect, useState } from "react";
import { footerModeCopy } from "../lib/mode";

export function FooterMode(): React.ReactElement {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const read = useCallback(() => {
    try {
      setEndpoint(window.localStorage.getItem(MODEL_ENDPOINT_SLOT));
    } catch {
      // A locked-down profile has no slot, which is the unconnected case.
      setEndpoint(null);
    }
  }, []);
  useEffect(() => {
    read();
    window.addEventListener(CONNECTION_CHANGED_EVENT, read);
    return () => window.removeEventListener(CONNECTION_CHANGED_EVENT, read);
  }, [read]);
  return <p>{footerModeCopy(endpoint)}</p>;
}
