import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "../../components/PageNotice";
import { ReviewView } from "../../lib/ReviewView";

/**
 * /review — the moderation dashboard.
 *
 * Still `page.api.tsx`: the extension keeps a database-backed page out of the
 * static GitHub Pages export (next.config.mjs `pageExtensions`). It does not
 * oblige the file to be server-only, so this is a shell around
 * `lib/ReviewView.tsx` that exists to export `metadata` — a client component
 * may not.
 *
 * The view fetches `apiBase()/moderation/cases` and sends the reviewer's
 * identity in the HEADER: the `ailx_dev_user` cookie is `SameSite=Lax` and
 * does not cross to the exam service's origin (docs/ARCHITECTURE.md §10.1).
 * The gate itself is unchanged and still lives on the server.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AILX — moderation",
  robots: { index: false, follow: false },
};

export default function ModerationPage() {
  return (
    <Suspense
      fallback={
        <PageLoading eyebrow="AILX MODERATION · STAFF ONLY" title="What is waiting, and what we decided." />
      }
    >
      <ReviewView />
    </Suspense>
  );
}
