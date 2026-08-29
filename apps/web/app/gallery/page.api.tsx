import type { Metadata } from "next";
import Link from "next/link";
import {
  handleListGallery,
  type GalleryListing,
  type GalleryQuery,
} from "@ailx/backend";
import { withApiContext } from "../../lib/server/api";
import { GalleryCard } from "../../lib/GalleryCard";

/**
 * /gallery — the public wall of published player-type cards.
 *
 * `page.api.tsx`, not `page.tsx`: it reads the database, so it exists only in
 * the AILX_BACKEND=1 build (FRONTEND.md §2.3.1). The static Pages export links
 * to the T4 community wall at /wall instead.
 *
 * WHAT IS ON THIS PAGE. Only rows the store considers listed: approved and
 * not revoked. A derived card is auto-approved at publish time; a share
 * carrying a candidate-built SITE is held at `submitted` until a human stamps
 * it (docs/SHARING.md §3), and that decision is made from the stored
 * `site_digest` column, never from anything a request can say.
 *
 * Filtering and sorting are plain links over query parameters, rendered on
 * the server: no client bundle, no JavaScript requirement, every state is a
 * URL somebody can send to a friend — which is the whole point of a gallery.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AILX gallery — how people are actually doing with AI",
  description:
    "Player-type cards people chose to publish from real AILX runs: what they built, how their four tracks came out, and the type it adds up to.",
};

type GalleryParams = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** First value only — a repeated parameter must not become an array here. */
function one(raw: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

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

export default async function GalleryPage({ searchParams }: GalleryParams) {
  const raw = one(await searchParams);
  const { gallery } = (await withApiContext((ctx) => handleListGallery(ctx, raw))).body as {
    gallery: GalleryListing;
  };
  const { entries, total, facets, query } = gallery;
  const shown = query.offset + entries.length;
  // Facet counts are over the whole listed gallery, so this is the unfiltered size.
  const listed = facets.reduce((a, f) => a + f.count, 0);

  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">PUBLIC GALLERY · PUBLISHED BY THEIR OWNERS</p>
        <h1 style={{ maxWidth: "18ch" }}>What people can actually do with AI.</h1>
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

        <p className="small faint" aria-live="polite">
          {total === 0
            ? "Nothing published yet."
            : `Showing ${query.offset + 1}–${shown} of ${total} published card${total === 1 ? "" : "s"}.`}
        </p>

        {entries.length === 0 ? (
          <p className="muted">
            No cards match this filter yet. Finish a run, then publish your card from the report —
            it appears here the moment you do.
          </p>
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
