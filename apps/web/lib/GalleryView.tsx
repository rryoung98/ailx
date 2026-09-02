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
import { API_RESPONSE_SCHEMAS, apiPath, type GalleryQuery } from "@ailx/contract";
import { GalleryCard } from "./GalleryCard";
import { PageError, PageLoading } from "./PageNotice";
import { firstValueQuery, useService } from "./serviceFetch";

const EYEBROW = "PUBLIC GALLERY · PUBLISHED BY THEIR OWNERS";
const TITLE = "What people can actually do with AI.";

/** A gallery URL with some of the query changed; empty values drop out. */
function href(query: GalleryQuery, over: Partial<Record<"type" | "sort" | "site" | "offset", string | null>> = {}): string {
  const params = new URLSearchParams();
  const merged = {
    type: query.type,
    sort: query.sort === "recent" ? null : query.sort,
    site: query.withSite ? "1" : null,
    offset: query.offset > 0 ? String(query.offset) : null,
    ...over,
  };
  for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
  const qs = params.toString();
  return qs === "" ? "/gallery" : `/gallery?${qs}`;
}

const SORTS: { key: GalleryQuery["sort"]; label: string }[] = [
  { key: "recent", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "type", label: "By type" },
];

export function GalleryView() {
  const search = useSearchParams();
  // The schema comes from the manifest, keyed by the same route key the path
  // is built from, so the body this page believes is the body the route
  // declares. A response that is not that shape renders the error notice.
  const result = useService(apiPath("gallery", {}, firstValueQuery(search)), {
    schema: API_RESPONSE_SCHEMAS.gallery,
  });
  if (result.state === "loading") return <PageLoading eyebrow={EYEBROW} title={TITLE} />;
  // The wall is public and unauthenticated, so a non-200 is an outage, not a
  // state with a story. Saying "nobody has published a card yet" because the
  // service was down would be a lie about other people's work.
  if (result.state !== "ready") {
    return (
      <PageError
        eyebrow={EYEBROW}
        title={TITLE}
        message={result.state === "error" ? result.message : undefined}
      />
    );
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
          run. A card is a player type, a four-track shape and a band — never an exam item, an
          answer or anything personal. Cards that carry a built site are listed only after a
          human has looked at the site.
        </p>
        <p className="muted" style={{ marginTop: "-0.4rem" }}>
          <Link href="/world">See how the whole cohort is doing →</Link>{" "}
          <span className="faint">·</span>{" "}
          <Link href="/exam">Play a run and get your own type →</Link>
        </p>

        {/* Filters over nothing are chrome that implies content. They appear
            once there is something to filter. */}
        {listed === 0 ? null : (
        <nav className="gallery-filters" aria-label="Filter and sort the gallery">
          <div className="filter-row" role="group" aria-label="Player type">
            <Link
              className={`chip${query.type === null ? " on" : ""}`}
              href={href(query, { type: null, offset: null })}
              aria-current={query.type === null ? "true" : undefined}
            >
              All types <span className="faint">{listed}</span>
            </Link>
            {facets.map((f) => (
              <Link
                key={f.code}
                className={`chip${query.type === f.code ? " on" : ""}`}
                href={href(query, { type: f.code, offset: null })}
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
                href={href(query, { sort: s.key === "recent" ? null : s.key, offset: null })}
                aria-current={query.sort === s.key ? "true" : undefined}
              >
                {s.label}
              </Link>
            ))}
            <Link
              className={`chip${query.withSite ? " on" : ""}`}
              href={href(query, { site: query.withSite ? null : "1", offset: null })}
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
              Nobody has published a card yet, so this wall is genuinely empty rather than
              broken. Finish a run and publish yours from the report — a player-type card
              appears here the moment you do, one carrying the site you built waits for a
              moderator first, and you can revoke either just as fast.
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
            <Link className="btn" href={href(query, { offset: String(Math.max(0, query.offset - query.limit)) })}>
              ← Newer
            </Link>
          ) : null}
          {shown < total ? (
            <Link className="btn" href={href(query, { offset: String(query.offset + query.limit) })}>
              Older →
            </Link>
          ) : null}
        </nav>

        <p className="small faint" style={{ maxWidth: "62ch" }}>
          Publishing is opt-in and reversible: the owner of any card can revoke it, and it stops
          being served here and everywhere else immediately. Bands are quota bands over the demo
          cohort computed by the instrument&rsquo;s own scorers — the summit judging pipeline is
          not part of them, and no card on this wall claims a judged score.
        </p>
      </div>
    </main>
  );
}
