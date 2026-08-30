import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { handleViewShare, shareCardPath, shareUrlPath } from "@ailx/backend";
import { shareMinutes, type SharePayload } from "@ailx/report";
import { TRACK_IDS } from "@ailx/session";
import { CharacterPortrait, CharacterVoice } from "../../../lib/CharacterPortrait";
import { pageOrigin, withApiContext } from "../../../lib/server/api";
import { TrackRadar } from "../../../lib/TrackRadar";

/**
 * The share VIEW: what a stranger sees when a candidate sends their link.
 *
 * `page.api.tsx`, not `page.tsx` — the `.api.*` extensions are only in
 * `pageExtensions` for the AILX_BACKEND=1 build (next.config.mjs), so this
 * server-only page simply does not exist in the GitHub Pages static export.
 * That is the page twin of the long-standing `route.api.ts` rule; without it
 * the export would either fail to build or ship a route that can never work.
 *
 * The token in the URL is the capability. There is no auth, no account, and
 * no cookie: the reader is anonymous, and we keep it that way (the only
 * record kept is one day-granular view row, see db/schema.sql).
 *
 * UNLISTED IS NOT PUBLISHED. This page is `noindex` and unlisted; the spec's
 * approval-required public gallery gate (§ "Gallery governance") applies to
 * anything that becomes publicly LISTED, which this is not. A human still
 * approves gallery entries; nothing here weakens that.
 */

export const dynamic = "force-dynamic";

type ShareParams = { params: Promise<{ token: string }> };

interface SharedView {
  status: string;
  createdAt: string;
  views: number;
  payload: SharePayload;
}

/** One read path for both metadata and render. `count` is true exactly once. */
async function readShare(token: string, count: boolean): Promise<SharedView | null> {
  const result = await withApiContext((ctx) => handleViewShare(ctx, token, count));
  return result.status === 200 ? (result.body.share as SharedView) : null;
}

export async function generateMetadata({ params }: ShareParams): Promise<Metadata> {
  const { token } = await params;
  const share = await readShare(token, false);
  if (share === null) {
    return { title: "AILX — link not found", robots: { index: false, follow: false } };
  }
  const p = share.payload;
  const origin = await pageOrigin();
  const title = `${p.playerType.code} · ${p.playerType.name} — AILX player type`;
  const description = `${p.playerType.tagline} Band: ${p.band}. Find your own type on AILX.`;
  const url = `${origin}${shareUrlPath(token)}`;
  const image = `${origin}${shareCardPath(token)}`;
  return {
    title,
    description,
    // Unlisted, never indexed: a capability URL must not become a search hit.
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      siteName: "AILX",
      title,
      description,
      url,
      images: [{ url: image, width: 1200, height: 630, alt: `${p.playerType.code} — ${p.playerType.name}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function SharePage({ params }: ShareParams) {
  const { token } = await params;
  // The ONE place a view is counted: rendering the page for a human.
  const share = await readShare(token, true);
  if (share === null) notFound();
  const p = share.payload;
  const issued = new Date(share.createdAt).toISOString().slice(0, 10);

  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <section className="card ptype-card" style={{ marginBottom: "1.6rem" }}>
          <p className="eyebrow" style={{ margin: 0 }}>{p.instrument.toUpperCase()} · PLAYER TYPE</p>
          <div className="ptype-head">
            <div className="ptype-intro">
              <CharacterPortrait code={p.playerType.code} size={104} />
              <div>
                <h1 style={{ margin: "0.2rem 0 0.1rem" }}>{p.playerType.name}</h1>
                <p className="muted" style={{ margin: 0 }}>{p.playerType.tagline}</p>
              </div>
            </div>
            <div className="ptype-code" aria-label={`Type code ${p.playerType.code.split("").join(" ")}`}>
              {p.playerType.poles.map((pole) => (
                <span
                  key={pole.track}
                  className={`ptype-letter${pole.high ? " hi" : ""}`}
                  title={`${pole.track.toUpperCase()}: ${pole.label}`}
                >
                  {pole.letter}
                </span>
              ))}
            </div>
          </div>
          <div className="ptype-axes">
            {p.playerType.poles.map((pole) => (
              <span key={pole.track} className="small muted">
                <span className="mono" style={{ color: "var(--accent)" }}>{pole.track.toUpperCase()}</span> {pole.label}
              </span>
            ))}
          </div>
        </section>

        <section className="share-card" style={{ marginBottom: "1.6rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <h2 style={{ marginTop: 0 }}>How the run was shaped</h2>
              <p className={`reveal-band band-${p.band}`} style={{ margin: 0 }}>{p.band}</p>
              <p className="muted small" style={{ margin: 0 }}>band over the demo cohort · four tracks, 100 points each</p>
            </div>
            <TrackRadar values={p.tracks} label={`Track shape: ${TRACK_IDS.map((t) => `${t.toUpperCase()} ${p.tracks[t]}`).join(", ")}`} />
          </div>
          <div className="share-track-bars">
            {TRACK_IDS.map((t) => (
              <div className="row" key={t}>
                <span className="mono" style={{ color: "var(--accent)" }}>{t.toUpperCase()}</span>
                <div className="meter"><div style={{ width: `${Math.max(0, Math.min(100, p.tracks[t]))}%` }} /></div>
                <span className="mono" style={{ textAlign: "right" }}>{p.tracks[t].toFixed(1)}</span>
              </div>
            ))}
          </div>
        </section>

        {p.note !== null || p.profile !== null || p.process !== null || p.completedOn !== null ? (
          <section className="card" style={{ marginBottom: "1.6rem" }}>
            <h2 style={{ marginTop: 0 }}>What they chose to show</h2>
            <p className="muted small" style={{ marginTop: "-0.4rem" }}>
              Every part below was switched on by the person who made this link. Anything they
              left off is simply not here.
            </p>

            {p.note !== null ? (
              <blockquote className="share-quote">{p.note}</blockquote>
            ) : null}

            {p.process !== null || p.completedOn !== null ? (
              <dl className="share-facts">
                {p.process !== null ? (
                  <div>
                    <dt>Time on task</dt>
                    <dd className="mono">{shareMinutes(p.process.totalActiveSeconds)} min</dd>
                  </div>
                ) : null}
                {p.process !== null ? (
                  <div>
                    <dt>Verification actions</dt>
                    <dd className="mono">
                      {p.process.tracks.reduce((a, t) => a + t.verificationEvents, 0)}
                    </dd>
                  </div>
                ) : null}
                {p.completedOn !== null ? (
                  <div>
                    <dt>Finished</dt>
                    <dd className="mono">{p.completedOn}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}

            {p.process !== null ? (
              <div className="share-process">
                <p className="small muted" style={{ margin: "0.6rem 0 0" }}>
                  Minutes worked per track, against that track&rsquo;s budget. Speed is never
                  rewarded with points — this is how the run was spent, not how well it went.
                </p>
                {p.process.tracks.map((t) => (
                  <div className="row" key={t.track}>
                    <span className="mono">{t.track.toUpperCase()}</span>
                    <div className="meter">
                      <div
                        style={{
                          width: `${t.budgetSeconds > 0 ? Math.min(100, Math.round((t.activeSeconds / t.budgetSeconds) * 100)) : 0}%`,
                        }}
                      />
                    </div>
                    <span className="mono muted">
                      {shareMinutes(t.activeSeconds)} min{t.timedOut ? " · on the clock" : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {p.profile !== null ? (
              <div style={{ marginTop: "1.1rem" }}>
                {p.profile.strengths.length > 0 ? (
                  <>
                    <h3 style={{ margin: "0 0 0.2rem", fontSize: "1rem" }}>What they are good at</h3>
                    <ul className="share-points">
                      {p.profile.strengths.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {p.profile.watchouts.length > 0 ? (
                  <>
                    <h3 style={{ margin: "1rem 0 0.2rem", fontSize: "1rem" }}>What to watch</h3>
                    <ul className="share-points">
                      {p.profile.watchouts.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {p.site ? (
          <section className="card" style={{ marginBottom: "1.6rem" }}>
            <h2 style={{ marginTop: 0 }}>The thing they actually built</h2>
            <p className="muted small">
              Their T1 submission, served live and sandboxed. Shared deliberately and separately —
              it is their own work, not a derived figure.
            </p>
            <p style={{ marginBottom: 0 }}>
              <a className="btn" href={p.site} target="_blank" rel="noreferrer">
                Open the live site <span aria-hidden>↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          </section>
        ) : null}

        <section className="card" style={{ marginBottom: "1.6rem" }}>
          <h2 style={{ marginTop: 0 }}>Find your own type</h2>
          <p className="muted">
            AILX is an AI-literacy exam you can play: build something with a model, spot what is
            synthetic, reason against an assistant that is wrong on purpose, and direct a
            generation to a brief.
          </p>
          <p style={{ marginBottom: 0 }}>
            <Link className="btn primary" href="/exam">Play a run →</Link>{" "}
            <Link className="btn" href="/methodology">How it is scored</Link>
          </p>
        </section>

        <p className="faint small" style={{ marginBottom: 0 }}>
          Issued by AILX on {issued} from a completed run, and served from this origin — that is
          what makes the card checkable. It shows a player type, a four-track shape, a band and the
          extra sections its owner switched on — never an exam item, an answer, a per-question
          result or a personal identifier. Bands
          are derived from the run's stored artifacts by the instrument's own scorers over the demo
          cohort; the summit judging pipeline is not part of this card.{" "}
          <span className="mono">{share.views} view{share.views === 1 ? "" : "s"}</span> · unlisted
          link, not a public gallery entry — the holder can revoke it at any time, and it stops
          resolving immediately.
        </p>
      </div>
    </main>
  );
}
