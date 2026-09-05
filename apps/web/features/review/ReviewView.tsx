"use client";

/**
 * /review — the AILX moderation dashboard.
 *
 * This is staff tooling, not the playful surface (docs/UX-DIRECTION.md): dense
 * rows, real dates, no decoration, everything reachable from the keyboard by
 * being ordinary links and form controls. It shows the same three things a
 * moderator actually needs — what is WAITING, what a candidate has APPEALED,
 * and what has already been DECIDED, by whom and why.
 *
 * A CLIENT component reading `GET /moderation/cases` through `apiBase()`
 * (docs/ARCHITECTURE.md §10.1). Access is still enforced on the SERVER, in
 * the same place the API twin enforces it: `handleModerationCases` runs
 * `withReviewer` (AuthProvider + the AILX_REVIEWERS allowlist). Nothing here
 * is a UI condition — the page renders a 404 because the SERVICE refused, and
 * it can only ask because it sends an identity.
 *
 * IDENTITY. `identity: "required"`, so the reviewer's `x-ailx-dev-user` (or Clerk
 * bearer) rides the header. The `ailx_dev_user` cookie is `SameSite=Lax` and
 * would simply not arrive once the exam service is on another origin, so the
 * header is the only transport that works on both hosts.
 *
 * A caller who is not a moderator gets a 404 page, because the queue holds
 * sites nobody has vetted yet — the API twin still answers 401/403, because a
 * script needs to know why it was refused.
 */
import Link from "next/link";
import { notFound, useSearchParams } from "next/navigation";
import {
  apiPath,
  CASE_LANES,
  type CaseLane,
  type CaseListing,
  type ModerationCase,
} from "@ailx/contract";
import { GalleryCard } from "../../components/GalleryCard";
import { PageError, PageLoading } from "../../components/PageNotice";
import { ReviewActions } from "./ReviewActions";
import { firstValueQuery, useService } from "../../lib/data/serviceFetch";

const EYEBROW = "AILX MODERATION · STAFF ONLY";
const TITLE = "What is waiting, and what we decided.";

const LANE_COPY: Record<CaseLane, { label: string; blurb: string; empty: string }> = {
  pending: {
    label: "Waiting",
    blurb:
      "A player-type card publishes itself. A share carrying the candidate's own site or their own words puts unvetted content on a public wall. It is listed only after somebody here opens it and says yes. Both decisions stamp your identity on the row. Refusing also stores your reason, which the candidate is shown.",
    empty: "The queue is empty. Nothing is waiting.",
  },
  appeals: {
    label: "Answered back",
    blurb:
      "A refused candidate has responded. The refusal itself stands and is terminal for that share, but the case is back in front of a human. Answer them, or leave an internal note saying why the decision holds.",
    empty: "Nobody is waiting on an answer.",
  },
  decided: {
    label: "History",
    blurb:
      "Every human decision, newest first: what, when, by whom, and the reason the candidate was shown. Nothing here can be edited; a change of mind is a new record.",
    empty: "No decisions recorded yet.",
  },
};

const day = (at: string | null): string => (at === null ? "—" : at.slice(0, 10));

/** One dense history/appeal row. The card grid is for cases you must LOOK at. */
function CaseRow({ item }: { item: ModerationCase }) {
  return (
    <tr>
      <td>
        <Link href={`/review/${item.entry.id}`}>{item.entry.payload.playerType.name}</Link>
        <span className="faint small mono"> {item.entry.payload.playerType.code}</span>
      </td>
      <td>
        <span className={`badge mod-status-${item.status}`}>{item.status}</span>
        {item.appealOpen ? <span className="badge mod-status-appeal">appeal open</span> : null}
      </td>
      <td className="mono small">{day(item.decidedAt ?? item.submittedAt)}</td>
      <td className="mono small">{item.decidedBy ?? "—"}</td>
      <td className="small">{item.rejectReason ?? "—"}</td>
      <td className="mono small">{item.comments}</td>
    </tr>
  );
}


export function ReviewView() {
  const search = useSearchParams();
  const result = useService<{ listing: CaseListing }>(
    apiPath("moderationCases", {}, firstValueQuery(search)),
    { identity: "required" },
  );
  if (result.state === "loading") return <PageLoading eyebrow={EYEBROW} title={TITLE} />;
  // An unreachable service is NOT a refusal, and must not be dressed as one:
  // a moderator told "404" by a network blip would think they lost access.
  if (result.state === "error") return <PageError eyebrow={EYEBROW} title={TITLE} />;
  if (result.state === "missing") notFound();

  const listing = result.data.listing;
  const lane = listing.query.lane;
  const copy = LANE_COPY[lane];

  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">{EYEBROW}</p>
        <h1 style={{ maxWidth: "22ch" }}>{TITLE}</h1>

        <nav className="mod-lanes" aria-label="Moderation lanes">
          {CASE_LANES.map((key) => (
            <Link
              key={key}
              className="mod-lane"
              href={key === "pending" ? "/review" : `/review?lane=${key}`}
              aria-current={key === lane ? "page" : undefined}
            >
              {LANE_COPY[key].label} <span className="mono">{listing.counts[key]}</span>
            </Link>
          ))}
        </nav>

        <p className="small muted" style={{ maxWidth: "72ch" }}>{copy.blurb}</p>

        {listing.cases.length === 0 ? (
          <p className="muted">{copy.empty}</p>
        ) : lane === "pending" ? (
          <>
            <p className="small faint">
              Open every site before you decide — it is served sandboxed, in a new tab.
            </p>
            <div className="gallery-grid">
              {listing.cases.map((item) => (
                <GalleryCard key={item.entry.id} entry={item.entry}>
                  <ReviewActions
                    shareId={item.entry.id}
                    name={item.entry.payload.playerType.name}
                  />
                  <p className="small" style={{ margin: 0 }}>
                    <Link href={`/review/${item.entry.id}`}>
                      Open the case
                      <span className="sr-only"> for {item.entry.payload.playerType.name}</span>
                      {item.comments > 0 ? ` · ${item.comments} on the record` : ""}
                    </Link>
                  </p>
                </GalleryCard>
              ))}
            </div>
          </>
        ) : (
          <table className="mod-table">
            <caption className="sr-only">{copy.label}</caption>
            <thead>
              <tr>
                <th scope="col">Submission</th>
                <th scope="col">State</th>
                <th scope="col">Date</th>
                <th scope="col">Decided by</th>
                <th scope="col">Reason shown to the candidate</th>
                <th scope="col">Trail</th>
              </tr>
            </thead>
            <tbody>
              {listing.cases.map((item) => (
                <CaseRow key={item.entry.id} item={item} />
              ))}
            </tbody>
          </table>
        )}

        {lane === "decided" ? (
          <p className="small faint">
            <Link href={`/review?lane=decided${listing.query.includeAuto ? "" : "&auto=1"}`}>
              {listing.query.includeAuto
                ? "Hide auto-published cards"
                : "Include auto-published cards"}
            </Link>{" "}
            — a derived player-type card carries no authored content and publishes itself, so no
            human decided it.
          </p>
        ) : null}

        {listing.total > listing.cases.length + listing.query.offset ? (
          <p className="small">
            <Link
              href={`/review?lane=${lane}${listing.query.includeAuto ? "&auto=1" : ""}&offset=${
                listing.query.offset + listing.query.limit
              }`}
            >
              Next {listing.query.limit} →
            </Link>
          </p>
        ) : null}
        {listing.query.offset > 0 ? (
          <p className="small">
            <Link
              href={`/review?lane=${lane}${listing.query.includeAuto ? "&auto=1" : ""}&offset=${Math.max(
                0,
                listing.query.offset - listing.query.limit,
              )}`}
            >
              ← Previous {listing.query.limit}
            </Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}
