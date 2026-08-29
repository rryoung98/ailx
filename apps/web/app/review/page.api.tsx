import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { handleReviewQueue, type GalleryEntry } from "@ailx/backend";
import { withApiContext } from "../../lib/server/api";
import { GalleryCard } from "../../lib/GalleryCard";
import { ReviewActions } from "../../lib/ReviewActions";

/**
 * /review — the reviewer surface for the one privileged decision this product
 * has: may a candidate-built SITE be publicly listed?
 *
 * Access is enforced on the SERVER, twice over and in the same place both
 * times: this page and the POST route both go through `withReviewer`
 * (@ailx/backend), which verifies the caller through the AuthProvider seam
 * and then checks the `AILX_REVIEWERS` allowlist. There is no roles table and
 * no client-side gate — a hidden button is not access control.
 *
 * A caller who is not a reviewer gets a 404, not a 403 page: the queue's
 * contents include sites nobody has vetted yet, so the surface does not
 * confirm itself to strangers. (The API twin still answers 401/403, because a
 * script needs to know why it was refused.)
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AILX — gallery review queue",
  robots: { index: false, follow: false },
};

export default async function ReviewPage() {
  const h = await headers();
  const headerMap: Record<string, string> = {};
  h.forEach((value, key) => {
    headerMap[key.toLowerCase()] = value;
  });

  const result = await withApiContext((ctx) => handleReviewQueue(ctx, headerMap, process.env));
  if (result.status !== 200) notFound();
  const submissions = result.body.submissions as GalleryEntry[];

  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">REVIEW QUEUE · SITE-CARRYING SUBMISSIONS</p>
        <h1 style={{ maxWidth: "20ch" }}>Sites waiting for a human.</h1>
        <p className="lede">
          A player-type card publishes itself. A share that carries the candidate&rsquo;s own
          built site — or their own words — puts content nobody vetted on a public wall, so it is
          listed only after somebody here opens it and says yes. Both decisions stamp your
          identity on the row. Refusing also stores your reason, which the candidate is shown,
          and stops the share being served publicly at all.
        </p>
        <p className="small faint">
          Open every site before you decide — it is served sandboxed, in a new tab.
        </p>

        {submissions.length === 0 ? (
          <p className="muted">The queue is empty. Nothing is waiting.</p>
        ) : (
          <div className="gallery-grid">
            {submissions.map((entry) => (
              <GalleryCard key={entry.id} entry={entry}>
                <ReviewActions shareId={entry.id} name={entry.payload.playerType.name} />
              </GalleryCard>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
