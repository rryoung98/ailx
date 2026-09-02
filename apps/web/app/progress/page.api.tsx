import type { Metadata } from "next";
import { ProgressView } from "../../features/progress/ProgressView";

/**
 * /progress — one person's trajectory.
 *
 * Still `page.api.tsx`: the extension is what keeps a database-backed page
 * out of the static GitHub Pages export (next.config.mjs `pageExtensions`).
 * It does not oblige the file to be server-only, so this is now a shell
 * around `features/progress/ProgressView.tsx` whose only job is `metadata` — including the
 * `noindex` that matters most here, because the page is one person's history.
 *
 * The view fetches `apiBase()/progress` and carries its identity in the
 * HEADER, not the `ailx_dev_user` cookie: the cookie is `SameSite=Lax` and
 * never crosses to the exam service's origin (docs/ARCHITECTURE.md §10.1).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AILX — your progress",
  description: "Your practice streak, your accuracy over time, and what actually changed between sittings.",
  robots: { index: false, follow: false },
};

export default function ProgressPage() {
  return <ProgressView />;
}
