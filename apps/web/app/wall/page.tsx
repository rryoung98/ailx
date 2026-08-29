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
import { useEffect, useState } from "react";
import { Annotation } from "../../lib/Annotation";

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

  useEffect(() => {
    setVoted(votedSet());
    let cancelled = false;
    (async () => {
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
        if (!cancelled) setSubs(docs.filter((d) => d.doc));
      } catch {
        if (!cancelled) setError("The gallery service is unreachable right now.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const vote = async (id: string) => {
    if (voted.has(id)) return;
    const next = new Set(voted); next.add(id);
    setVoted(next);
    setSubs((s) => s?.map((x) => (x.id === id ? { ...x, votes: x.votes + 1 } : x)) ?? null);
    try {
      window.localStorage.setItem(VOTED_KEY, JSON.stringify([...next]));
      await fetch(`${GALLERY_API}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* optimistic; the count self-corrects on next load */
    }
  };

  const ordered = subs
    ? [...subs].sort((a, b) => (sort === "top" ? b.votes - a.votes : a.id < b.id ? -1 : 1))
    : null;

  return (
    <main className="container" style={{ padding: "3.5rem 0 5rem" }}>
      <p className="kicker">COMMUNITY WALL · T4 GENERATIVE DIRECTION</p>
      <h1 style={{ maxWidth: "14ch" }}>Sets people chose to show.</h1>
      <p className="muted" style={{ maxWidth: "52ch" }}>
        Final image sets shared from real runs, with the direction note that
        steered them. Votes are a human read on the work
        {" "}<Annotation>never part of the score</Annotation> — the instrument
        only ever grades your own run.
      </p>
      <div style={{ display: "flex", gap: 8, margin: "1.2rem 0 1.8rem" }}>
        <button className={`btn${sort === "top" ? " primary" : ""}`} onClick={() => setSort("top")}>Top</button>
        <button className={`btn${sort === "new" ? " primary" : ""}`} onClick={() => setSort("new")}>New</button>
      </div>
      {error ? <p className="muted">{error}</p> : null}
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
              <button
                className={`btn gallery-vote${voted.has(s.id) ? " voted" : ""}`}
                aria-pressed={voted.has(s.id)}
                onClick={() => vote(s.id)}
              >
                ▲ {s.votes}
              </button>
            </div>
          </article>
        ))}
      </div>
      <p className="small faint" style={{ marginTop: "2rem" }}>
        Everything on this wall is AI-generated and voluntarily shared. Sharing
        is opt-in from your report; nothing uploads during a run.
      </p>
    </main>
  );
}
