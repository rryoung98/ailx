"use client";

/**
 * /review/<share id> — one moderation case: the submission as the public
 * would see it, the decision on the record, and the whole trail around it.
 *
 * A CLIENT component reading `GET /moderation/<id>` through `apiBase()`
 * (docs/ARCHITECTURE.md §10.1), with `identified: true` so the reviewer's
 * header travels — the `ailx_dev_user` cookie is `SameSite=Lax` and never
 * reaches the exam service's origin.
 *
 * Same server-side gate as the dashboard and the API twin
 * (`handleModerationCase` → `withReviewer`), and the same answer to a
 * stranger: a 404 page, so the surface does not confirm itself. An
 * unreachable service is told apart from a refusal — a moderator shown "404"
 * by a network blip would think they had lost access.
 */
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { apiPath, type ModerationCaseDetail } from "@ailx/contract";
import { GalleryCard } from "../../components/GalleryCard";
import { ModeratorThread } from "../../components/Moderation";
import { PageError, PageLoading } from "../../components/PageNotice";
import { ReviewActions } from "./ReviewActions";
import { useService } from "../../lib/data/serviceFetch";

const EYEBROW = "MODERATION CASE";

export function ModerationCaseView() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : null;
  const result = useService<{ case: ModerationCaseDetail }>(
    id === null ? null : apiPath("moderationCase", { id }),
    { identified: true },
  );
  if (result.state === "loading") return <PageLoading eyebrow={EYEBROW} title="Moderation case" />;
  if (result.state === "error") return <PageError eyebrow={EYEBROW} title="Moderation case" />;
  if (result.state === "missing") notFound();

  const detail = result.data.case;
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
