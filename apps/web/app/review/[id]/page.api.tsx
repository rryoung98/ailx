import type { Metadata } from "next";
import { ModerationCaseView } from "../../../features/review/ModerationCaseView";

/**
 * /review/<share id> — one moderation case.
 *
 * Still `page.api.tsx`: the extension keeps a database-backed page out of the
 * static GitHub Pages export, and it does not oblige the file to be
 * server-only. This shell exists to export `metadata`, which a client
 * component cannot; the page is `features/review/ModerationCaseView.tsx`,
 * which fetches `apiBase()/moderation/<id>` with the reviewer's identity in
 * the header (docs/ARCHITECTURE.md §10.1).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AILX — moderation case",
  robots: { index: false, follow: false },
};

export default function ModerationCasePage() {
  return <ModerationCaseView />;
}
