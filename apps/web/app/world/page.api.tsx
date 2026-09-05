import type { Metadata } from "next";
import { WorldView } from "../../features/world/WorldView";

/**
 * /world — public aggregates.
 *
 * Still `page.api.tsx`: that extension is what keeps the page out of the
 * static GitHub Pages export (next.config.mjs `pageExtensions`), and a page
 * that needs a database must stay out of it. The extension controls static
 * INCLUSION; it does not oblige the file to be server-only.
 *
 * So this file is now a two-line server shell whose only job is `metadata`
 * (a client component may not export it). The page itself is
 * `features/world/WorldView.tsx`, which fetches `apiBase()/aggregates` over HTTP instead
 * of importing an `@ailx/backend` handler in-process — docs/ARCHITECTURE.md
 * §10.1, step 2 of deleting the duplicate host.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Foray — how the world is doing at keeping up with AI",
  description:
    "Honest distributions from real Foray runs: participation, player types, track shapes, item exposure and the trend over time. No percentiles, no judged scores.",
};

export default function WorldPage() {
  return <WorldView />;
}
