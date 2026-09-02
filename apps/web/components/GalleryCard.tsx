/**
 * One gallery tile: a published player-type card, rendered from the FROZEN
 * share payload and nothing else.
 *
 * Presentational and server-safe (no hooks, no browser API), so the browse
 * grid and the reviewer queue render exactly the same card — a reviewer must
 * see what the public will see, not a different summary of it.
 *
 * The tile links to /s/<token>, the share view the card came from. That is
 * safe because a tile only exists for a LISTED entry: its owner published it,
 * the view serves the same payload the tile shows, and revoking kills both.
 */
import Link from "next/link";
import type { GalleryEntry } from "@ailx/contract";
import { shareUrlPath } from "@ailx/contract";
import { shareMinutes } from "@ailx/report";
import { TRACK_IDS } from "@ailx/session";
import { CharacterPortrait } from "./CharacterPortrait";
import { siteHref } from "../lib/mode";
import { TrackRadar } from "./TrackRadar";

export function GalleryCard({
  entry,
  children,
}: {
  entry: GalleryEntry;
  /** Reviewer controls; nothing on the public wall. */
  children?: React.ReactNode;
}) {
  const p = entry.payload;
  const site = siteHref(p.site);
  const day = entry.at.slice(0, 10);
  return (
    <article className="gallery-card type-tile" data-testid="gallery-card">
      <div className="type-tile-head">
        {/* role="img": aria-label is not valid on a bare <p>, and this reads
            better as one spelled-out label than four stray letters. */}
        <p className="ptype-code" role="img" aria-label={`Type code ${p.playerType.code.split("").join(" ")}`}>
          {p.playerType.poles.map((pole) => (
            <span
              key={pole.track}
              className={`ptype-letter small${pole.high ? " hi" : ""}`}
              title={`${pole.track.toUpperCase()}: ${pole.label}`}
            >
              {pole.letter}
            </span>
          ))}
        </p>
        <span className={`badge band-${p.band}`}>{p.band}</span>
      </div>
      <div className="ptype-intro">
        <CharacterPortrait code={p.playerType.code} size={64} />
        <div>
          <h3 className="type-tile-name">{p.playerType.name}</h3>
          <p className="gallery-note">{p.playerType.tagline}</p>
        </div>
      </div>
      {p.note !== null ? <blockquote className="share-quote">{p.note}</blockquote> : null}
      <TrackRadar
        values={p.tracks}
        size={150}
        label={`Track shape: ${TRACK_IDS.map((t) => `${t.toUpperCase()} ${p.tracks[t]}`).join(", ")}`}
      />
      <dl className="type-tile-tracks">
        {TRACK_IDS.map((t) => (
          <div key={t}>
            <dt className="mono small">{t.toUpperCase()}</dt>
            <dd className="mono small">{p.tracks[t].toFixed(1)}</dd>
          </div>
        ))}
      </dl>
      <p className="small faint type-tile-meta">
        <span className="mono">{p.instrument}</span> · listed {day}
        {p.process !== null ? ` · ${shareMinutes(p.process.totalActiveSeconds)} min on task` : ""}
        {site ? null : " · card only"}
      </p>
      <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: 0 }}>
        <Link className="btn small-btn" href={shareUrlPath(entry.token)}>
          See the full card
        </Link>
        {site ? (
          <a className="btn small-btn" href={site} target="_blank" rel="noreferrer">
            See what they built <span aria-hidden>↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </p>
      {children}
    </article>
  );
}
