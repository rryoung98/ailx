"use client";
/**
 * /wall — community wall of shared T4 final sets.
 *
 * NOT the public gallery: /gallery is the server-rendered wall of published
 * player-type cards (app/gallery/page.api.tsx), which needs a database and so
 * exists only in the hosted build. This page reads a public demo service and
 * works in the static export, which is where it is linked from.
 *
 * Reads the public gallery service (Vercel Blob behind the shared-demo
 * proxy). Upvotes are a HUMAN AESTHETIC SIGNAL only: they never touch the
 * scored instrument — the composite is computed from your run alone.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Annotation } from "../../components/ui/Annotation";

const GALLERY_API = "https://ailx-shared-demo.vercel.app/api/gallery";

interface Sub {
  id: string;
  url: string;
  votes: number;
  doc?: { images: string[]; note: string; model: string; ts: string };
}

const VOTED_KEY = "ailx:gallery-voted";

function votedSet(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(VOTED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export default function GalleryPage() {
  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"top" | "new">("top");

  // Extracted from the effect so the failure state can offer a retry: the
  // shared demo service is a third party this page does not control, and a
  // bare "unreachable" line with no way forward is a dead end.
  const load = useCallback(async () => {
    setError(null);
    setSubs(null);
    try {
      const res = await fetch(GALLERY_API);
      if (!res.ok) throw new Error(String(res.status));
      const { items } = (await res.json()) as { items: Sub[] };
      const docs = await Promise.all(
        items.map(async (it) => {
          try {
            const d = await fetch(it.url);
            return { ...it, doc: await d.json() };
          } catch {
            return it;
          }
        }),
      );
      setSubs(docs.filter((d) => d.doc));
    } catch {
      setError("The shared demo service did not answer.");
    }
  }, []);

  useEffect(() => {
    setVoted(votedSet());
    void load();
  }, [load]);

  // The service answers with the count it now holds, and that count wins.
  // A vote is one per IP, so a second browser on the same address changes
  // nothing; before TEN-131 this page added one anyway and the next load took
  // it away, which read as a write the service had thrown out.
  const vote = async (id: string) => {
    if (voted.has(id)) return;
    const before = voted;
    const next = new Set(voted); next.add(id);
    setVoted(next);
    setSubs((s) => s?.map((x) => (x.id === id ? { ...x, votes: x.votes + 1 } : x)) ?? null);
    const remember = (set: Set<string>) => {
      try {
        window.localStorage.setItem(VOTED_KEY, JSON.stringify([...set]));
      } catch {
        /* private mode: the vote still counts, this browser just forgets it */
      }
    };
    remember(next);
    try {
      const res = await fetch(`${GALLERY_API}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { votes } = (await res.json()) as { votes?: number };
      if (typeof votes === "number") {
        setSubs((s) => s?.map((x) => (x.id === id ? { ...x, votes } : x)) ?? null);
      }
    } catch {
      // Nothing was stored, so say nothing was: put the count and the button
      // back. Leaving them is what made the page claim a vote it had lost.
      setVoted(before);
      setSubs((s) => s?.map((x) => (x.id === id ? { ...x, votes: x.votes - 1 } : x)) ?? null);
      remember(before);
    }
  };

  const ordered = subs
    ? [...subs].sort((a, b) => (sort === "top" ? b.votes - a.votes : a.id < b.id ? -1 : 1))
    : null;

  return (
    <main className="page">
      <div className="container">
        {/* `page` + `container`, like every other page. This used to be a bare
            `main.container` with its own padding, so the wall sat on a
            different left edge from the rest of the site, and its eyebrow used
            a `kicker` class that does not exist in globals.css — it rendered as
            unstyled body text. */}
        <p className="eyebrow">COMMUNITY WALL · T4 GENERATIVE DIRECTION</p>
        <h1 style={{ maxWidth: "14ch" }}>Sets people chose to show.</h1>
        <p className="muted" style={{ maxWidth: "52ch" }}>
          Final image sets shared from real runs, with the direction note behind
          them. Votes are a human read on the work
          {" "}<Annotation>never part of the score</Annotation> — the instrument
          grades only your own run.
        </p>
        <div
          role="group"
          aria-label="Sort the wall"
          style={{ display: "flex", gap: 8, margin: "1.2rem 0 1.8rem" }}
        >
          {/* `aria-pressed`, because these are a toggle pair and not two
              unrelated actions: without it the current sort is conveyed by
              colour alone. */}
          <button
            type="button"
            className={`btn${sort === "top" ? " primary" : ""}`}
            aria-pressed={sort === "top"}
            onClick={() => setSort("top")}
          >
            Top
          </button>
          <button
            type="button"
            className={`btn${sort === "new" ? " primary" : ""}`}
            aria-pressed={sort === "new"}
            onClick={() => setSort("new")}
          >
            New
          </button>
        </div>
        {error ? (
          <div role="alert" style={{ display: "grid", gap: "0.7rem", justifyItems: "start" }}>
            <p className="muted" style={{ margin: 0, maxWidth: "52ch" }}>
              {error} The sets are held by that service, not by this page, so they come back
              when it does.
            </p>
            <p style={{ display: "flex", gap: "1rem", alignItems: "center", margin: 0 }}>
              <button type="button" className="btn primary" onClick={() => void load()}>
                Try again
              </button>
              <Link href="/gallery">See the published cards instead →</Link>
            </p>
          </div>
        ) : null}
        {!error && !ordered ? <p className="muted">Loading the wall…</p> : null}
        {ordered && ordered.length === 0 ? (
          <p className="muted">Nothing here yet. Finish a run and share your set from the report.</p>
        ) : null}
        <div className="gallery-grid">
          {ordered?.map((s) => (
            <article key={s.id} className="gallery-card" data-testid="gallery-card">
              <div className="gallery-imgs" data-count={s.doc!.images.length}>
                {s.doc!.images.map((u, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={u} alt={`Shared T4 final ${i + 1}`} loading="lazy" />
                ))}
              </div>
              {s.doc!.note ? <p className="gallery-note">{s.doc!.note}</p> : null}
              <div className="gallery-meta">
                <span className="small faint mono">{s.doc!.model || "model unlisted"}</span>
                {/* The glyph is decorative; without a label the accessible
                    name of this control is the string "▲ 3". */}
                <button
                  type="button"
                  className={`btn gallery-vote${voted.has(s.id) ? " voted" : ""}`}
                  aria-pressed={voted.has(s.id)}
                  aria-label={`${voted.has(s.id) ? "You upvoted this set" : "Upvote this set"} — ${s.votes} vote${s.votes === 1 ? "" : "s"}`}
                  onClick={() => vote(s.id)}
                >
                  <span aria-hidden>▲</span> {s.votes}
                </button>
              </div>
            </article>
          ))}
        </div>
        <p className="small faint" style={{ marginTop: "2rem" }}>
          Every set here is AI-generated and shared voluntarily. Sharing is opt-in
          from your report; nothing uploads during a run.
        </p>
      </div>
    </main>
  );
}
