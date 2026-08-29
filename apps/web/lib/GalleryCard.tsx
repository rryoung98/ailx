/**
 * One gallery tile: a published player-type card, rendered from the FROZEN
 * share payload and nothing else.
 *
 * Presentational and server-safe (no hooks, no browser API), so the browse
 * grid and the reviewer queue render exactly the same card — a reviewer must
 * see what the public will see, not a different summary of it.
 *
 * There is no link back to /s/<token>: the database stores only sha256(token),
 * so no server can rebuild the capability URL. The tile is self-contained.
 */
import type { GalleryEntry } from "@ailx/backend";
import { TRACK_IDS } from "@ailx/session";
import { TrackRadar } from "./TrackRadar";

/** Same-origin snapshot paths only — never render an arbitrary stored href. */
const SITE_PATH_RE = /^\/api\/site\/[^"'\s]+$/;

export function safeSitePath(site: string | null): string | null {
  return site !== null && SITE_PATH_RE.test(site) ? site : null;
}

export function GalleryCard({
  entry,
  children,
}: {
  entry: GalleryEntry;
  /** Reviewer controls; nothing on the public wall. */
  children?: React.ReactNode;
}) {
  const site = safeSitePath(entry.site);
  const day = entry.at.slice(0, 10);
  return (
    <article className="gallery-card type-tile" data-testid="gallery-card">
      <div className="type-tile-head">
        <p className="ptype-code" aria-label={`Type code ${entry.playerType.code.split("").join(" ")}`}>
          {entry.playerType.poles.map((pole) => (
            <span
              key={pole.track}
              className={`ptype-letter small${pole.high ? " hi" : ""}`}
              title={`${pole.track.toUpperCase()}: ${pole.label}`}
            >
              {pole.letter}
            </span>
          ))}
        </p>
        <span className={`badge band-${entry.band}`}>{entry.band}</span>
      </div>
      <h3 className="type-tile-name">{entry.playerType.name}</h3>
      <p className="gallery-note">{entry.playerType.tagline}</p>
      <TrackRadar
        values={entry.tracks}
        size={150}
        label={`Track shape: ${TRACK_IDS.map((t) => `${t.toUpperCase()} ${entry.tracks[t]}`).join(", ")}`}
      />
      <dl className="type-tile-tracks">
        {TRACK_IDS.map((t) => (
          <div key={t}>
            <dt className="mono small">{t.toUpperCase()}</dt>
            <dd className="mono small">{entry.tracks[t].toFixed(1)}</dd>
          </div>
        ))}
      </dl>
      <p className="small faint type-tile-meta">
        <span className="mono">{entry.instrument}</span> · listed {day}
        {site ? null : " · card only"}
      </p>
      {site ? (
        <p style={{ margin: 0 }}>
          <a className="btn small-btn" href={site} target="_blank" rel="noreferrer">
            See what they built <span aria-hidden>↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      ) : null}
      {children}
    </article>
  );
}
