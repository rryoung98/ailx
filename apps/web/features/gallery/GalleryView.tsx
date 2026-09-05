"use client";

/**
 * /gallery — the public wall of published player-type cards.
 *
 * A CLIENT component that reads the service over HTTP (`GET /gallery?...`)
 * through `apiBase()`, instead of importing `handleListGallery` in-process
 * (docs/ARCHITECTURE.md §10.1). The wall is public, so this page sends NO
 * identity: what is listed does not depend on who is looking.
 *
 * WHAT IS ON THIS PAGE. Only rows the store considers listed: approved and
 * not revoked. A derived card is auto-approved at publish time; a share
 * carrying a candidate-built SITE is held at `submitted` until a human stamps
 * it (docs/SHARING.md §3), and that decision is made from the stored
 * `site_digest` column, never from anything a request can say.
 *
 * FILTERS ARE STILL URLS. They were server-rendered links over query
 * parameters; they are the SAME links now, read back with `useSearchParams`
 * and forwarded to the service verbatim. Every state stays a URL somebody can
 * send to a friend — which is the whole point of a gallery — and the query is
 * still normalized by the backend parser, never trusted here.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  API_RESPONSE_SCHEMAS,
  apiPath,
  galleryQueryString,
  parseGalleryQuery,
  type GalleryQuery,
} from "@ailx/contract";
import { GalleryCard } from "../../components/GalleryCard";
import { PageError, PageLoading } from "../../components/PageNotice";
import {
  firstValues,
  serviceRefusedCopy,
  useService,
  type ServiceState,
} from "../../lib/data/serviceFetch";

const EYEBROW = "PUBLIC GALLERY · PUBLISHED BY THEIR OWNERS";
const TITLE = "What people can actually do with AI.";

/**
 * A gallery URL with some of the query changed.
 *
 * The string is written by the CONTRACT (`galleryQueryString`), not here.
 * This function used to spell the parameters itself, which is how the browser
 * came to hold a second vocabulary the parser had never heard of — the page
 * also forwarded its own URL to the service verbatim, so `?sort=top&site=0`
 * reached the wire and came back 400 (TEN-107).
 */
function href(query: GalleryQuery, over: Partial<GalleryQuery> = {}): string {
  return `/gallery${galleryQueryString({ ...query, ...over })}`;
}

/**
 * The URL asked for a filter this wall does not have — `?sort=top`, a made-up
 * player type, a limit past the cap. Read HERE now, from the same parser the
 * service uses, so the request is never made: a query the contract refuses is
 * not one the browser should spend a round trip finding out about.
 *
 * It is not an outage and must not be reported as one.
 */
export const BAD_QUERY_COPY =
  "That filter is not one this wall can show. Open the gallery without it to see every published card.";

/**
 * The sentence for a failed read. Three different facts, three different
 * sentences: the call never landed, the call landed and was refused, or the
 * body could not be read (TEN-107).
 */
function notice(result: ServiceState<unknown>): string | undefined {
  if (result.state === "error") return result.message;
  if (result.state === "missing") {
    return result.status === 400 ? BAD_QUERY_COPY : serviceRefusedCopy(result.status, result.reason);
  }
  return undefined;
}

const SORTS: { key: GalleryQuery["sort"]; label: string }[] = [
  { key: "recent", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "type", label: "By type" },
];

export function GalleryView() {
  const search = useSearchParams();
  // The page's own URL, read by the CONTRACT's parser before anything is
  // asked for. It used to be forwarded verbatim, so any spelling a visitor
  // was handed became a request; now the only queries that reach the wire are
  // the ones this repo and the service both agree exist, written back
  // canonically by the one writer (TEN-107).
  const parsed = parseGalleryQuery(firstValues(search));
  // The schema comes from the manifest, keyed by the same route key the path
  // is built from, so the body this page believes is the body the route
  // declares. A response that is not that shape renders the error notice.
  const result = useService(
    parsed.ok ? apiPath("gallery", {}, galleryQueryString(parsed.query)) : null,
    {
      schema: API_RESPONSE_SCHEMAS.gallery,
      // PUBLIC read: send the identity this browser already has, mint none.
      // Every /v1 route is behind auth today, so a returning browser keeps
      // working and a first-time visitor is told the truth about the refusal
      // rather than shown a page that invented a caller.
      identity: "optional",
    },
  );
  if (!parsed.ok) return <PageError eyebrow={EYEBROW} title={TITLE} message={BAD_QUERY_COPY} />;
  if (result.state === "loading") return <PageLoading eyebrow={EYEBROW} title={TITLE} />;
  // Never "nobody has published a card yet" for a failed read: that would be
  // a lie about other people's work. What the reader gets instead is which
  // failure it was.
  if (result.state !== "ready") {
    return <PageError eyebrow={EYEBROW} title={TITLE} message={notice(result)} />;
  }

  const { entries, total, facets, query } = result.data.gallery;
  const shown = query.offset + entries.length;
  // Facet counts are over the whole listed gallery, so this is the unfiltered size.
  const listed = facets.reduce((a, f) => a + f.count, 0);

  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">{EYEBROW}</p>
        <h1 style={{ maxWidth: "18ch" }}>{TITLE}</h1>
        <p className="lede">
          Every card here was published on purpose by the person who earned it, from a finished
          run. A card is a player type, a four-track shape and a band. It is never an exam item,
          an answer or anything personal. A card carrying a built site is listed only after a
          human opens that site.
        </p>
        <p className="muted" style={{ marginTop: "-0.4rem" }}>
          <Link href="/world">See the whole cohort →</Link>{" "}
          <span className="faint">·</span>{" "}
          <Link href="/exam">Play a run, get your type →</Link>
        </p>

        {/* Filters over nothing are chrome that implies content. They appear
            once there is something to filter. */}
        {listed === 0 ? null : (
        <nav className="gallery-filters" aria-label="Filter and sort the gallery">
          <div className="filter-row" role="group" aria-label="Player type">
            <Link
              className={`chip${query.type === null ? " on" : ""}`}
              href={href(query, { type: null, offset: 0 })}
              aria-current={query.type === null ? "true" : undefined}
            >
              All types <span className="faint">{listed}</span>
            </Link>
            {facets.map((f) => (
              <Link
                key={f.code}
                className={`chip${query.type === f.code ? " on" : ""}`}
                href={href(query, { type: f.code, offset: 0 })}
                aria-current={query.type === f.code ? "true" : undefined}
                title={f.name}
              >
                {f.code} <span className="faint">{f.count}</span>
              </Link>
            ))}
          </div>
          <div className="filter-row" role="group" aria-label="Sort and filter">
            {SORTS.map((s) => (
              <Link
                key={s.key}
                className={`chip${query.sort === s.key ? " on" : ""}`}
                href={href(query, { sort: s.key, offset: 0 })}
                aria-current={query.sort === s.key ? "true" : undefined}
              >
                {s.label}
              </Link>
            ))}
            <Link
              className={`chip${query.withSite ? " on" : ""}`}
              href={href(query, { withSite: !query.withSite, offset: 0 })}
              aria-current={query.withSite ? "true" : undefined}
            >
              With a built site
            </Link>
          </div>
        </nav>
        )}

        {/* One message, not two. This used to print "Nothing published yet."
            and "No cards match this filter yet." one under the other, which
            contradict each other: an empty gallery is not a filter miss, and
            a filter miss on a full gallery is not an empty gallery. */}
        {total > 0 ? (
          <p className="small faint" aria-live="polite">
            {`Showing ${query.offset + 1}–${shown} of ${total} published card${total === 1 ? "" : "s"}.`}
          </p>
        ) : null}

        {entries.length === 0 ? (
          listed === 0 ? (
            <p className="muted" style={{ maxWidth: "52ch" }} aria-live="polite">
              Nobody has published a card yet, so this wall is empty rather than broken. Finish
              a run and publish yours from the report. A player-type card appears here at once.
              One carrying the site you built waits for a moderator. You can revoke either just
              as fast.
            </p>
          ) : (
            <p className="muted" style={{ maxWidth: "52ch" }} aria-live="polite">
              No published card matches this filter.{" "}
              <Link href="/gallery">Clear the filters</Link> to see all {listed} of them.
            </p>
          )
        ) : (
          <div className="gallery-grid">
            {entries.map((entry) => (
              <GalleryCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        <nav className="gallery-pager" aria-label="Gallery pages">
          {query.offset > 0 ? (
            <Link className="btn" href={href(query, { offset: Math.max(0, query.offset - query.limit) })}>
              ← Newer
            </Link>
          ) : null}
          {shown < total ? (
            <Link className="btn" href={href(query, { offset: query.offset + query.limit })}>
              Older →
            </Link>
          ) : null}
        </nav>

        <p className="small faint" style={{ maxWidth: "62ch" }}>
          Publishing is opt-in and reversible. The owner can revoke a card, and it stops being
          served here and everywhere else at once. Bands are quota bands over the demo cohort,
          computed by the instrument&rsquo;s own scorers. The summit judging pipeline is not part
          of them, and no card here claims a judged score.
        </p>
      </div>
    </main>
  );
}
