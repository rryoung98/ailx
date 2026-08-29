import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { handleModerationCase, type ModerationCaseDetail } from "@ailx/backend";
import { requestHeaderMap, withApiContext } from "../../../lib/server/api";
import { GalleryCard } from "../../../lib/GalleryCard";
import { ReviewActions } from "../../../lib/ReviewActions";
import { ModeratorThread } from "../../../lib/Moderation";

/**
 * /review/<share id> — one moderation case: the submission as the public
 * would see it, the decision on the record, and the whole trail around it.
 *
 * Same server-side gate as the dashboard and the API twin
 * (`handleModerationCase` → `withReviewer`), and the same answer to a
 * stranger: a 404 page, so the surface does not confirm itself.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AILX — moderation case",
  robots: { index: false, follow: false },
};

export default async function ModerationCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withApiContext(async (ctx) =>
    handleModerationCase(ctx, await requestHeaderMap(), id, process.env),
  );
  if (result.status !== 200) notFound();
  const detail = result.body.case as ModerationCaseDetail;
  const decided = detail.status === "published" || detail.status === "rejected";

  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">
          <Link href="/review">← Moderation</Link> · CASE
        </p>
        <h1 style={{ maxWidth: "22ch" }}>{detail.entry.payload.playerType.name}</h1>

        <dl className="mod-facts">
          <div>
            <dt>State</dt>
            <dd>
              <span className={`badge mod-status-${detail.status}`}>{detail.status}</span>
              {detail.appealOpen ? <span className="badge mod-status-appeal">appeal open</span> : null}
            </dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd className="mono">{detail.submittedAt?.slice(0, 16).replace("T", " ") ?? "—"}</dd>
          </div>
          <div>
            <dt>Decided</dt>
            <dd className="mono">{detail.decidedAt?.slice(0, 16).replace("T", " ") ?? "—"}</dd>
          </div>
          <div>
            <dt>Decided by</dt>
            <dd className="mono">{detail.decidedBy ?? "—"}</dd>
          </div>
        </dl>

        {detail.rejectReason !== null ? (
          <p className="mod-reason">
            <strong>Reason shown to the candidate:</strong> {detail.rejectReason}
          </p>
        ) : null}
        {decided ? (
          <p className="small faint" style={{ maxWidth: "72ch" }}>
            A decision is final for this share: a refusal can never become an approval, and neither
            stamp is ever cleared. What a conversation here can change is the NEXT share the
            candidate makes — say what would pass.
          </p>
        ) : null}

        <div className="mod-case">
          <GalleryCard entry={detail.entry}>
            {detail.status === "submitted" ? (
              <ReviewActions
                shareId={detail.entry.id}
                name={detail.entry.payload.playerType.name}
              />
            ) : null}
          </GalleryCard>
          <ModeratorThread shareId={detail.entry.id} trail={detail.trail} />
        </div>
      </div>
    </main>
  );
}
