"use client";

/**
 * The share VIEW: what a stranger sees when a candidate sends their link.
 *
 * A CLIENT component reading `GET /share/<token>` through `apiBase()`
 * instead of `handleViewShare` in-process (docs/ARCHITECTURE.md §10.1).
 *
 * The token in the URL is the capability. There is no auth, no account, and
 * no cookie: the reader is anonymous, and we keep it that way — so this page
 * sends NO identity headers either. A revoked or unknown token 404s, because
 * a capability that has been withdrawn must stop resolving; that is exactly
 * why an unreachable service is told apart from a 404 here, and says so.
 *
 * UNLISTED IS NOT PUBLISHED. This page is `noindex` and unlisted; the spec's
 * approval-required public gallery gate (§ "Gallery governance") applies to
 * anything that becomes publicly LISTED, which this is not. A human still
 * approves gallery entries; nothing here weakens that.
 */
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { apiPath, shareUrlPath } from "@ailx/contract";
import { shareMinutes, type SharePayload } from "@ailx/report";
import { TRACK_IDS } from "@ailx/session";
import { CharacterPortrait, CharacterVoice } from "../../components/CharacterPortrait";
import { FunnelStep } from "../../components/FunnelStep";
import { siteHref } from "../../lib/mode";
import { PageError, PageLoading } from "../../components/PageNotice";
import { ShareTargets } from "../../components/ShareTargets";
import { ShareViewCount } from "../../components/ShareViewCount";
import { TrackRadar } from "../../components/TrackRadar";
import { serviceRefusedCopy, useService } from "../../lib/data/serviceFetch";

export interface SharedView {
  status: string;
  createdAt: string;
  views: number;
  payload: SharePayload;
}

export function ShareView() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : null;
  // A CAPABILITY read: the token is the whole claim, and a card opens the
  // same way for everyone who holds one. Anonymous, said out loud.
  const result = useService<{ share: SharedView }>(
    token === null ? null : apiPath("shareView", { token }),
    { identity: "anonymous" },
  );
  if (result.state === "loading") return <PageLoading title="Opening this card" />;
  if (result.state === "error") return <PageError title="Opening this card" message={result.message} />;
  // A withdrawn capability really is gone; anything else was REACHED and
  // refused, and a reader must not be told a live card was revoked — nor that
  // their connection failed when it did not (TEN-107).
  if (result.state === "missing") {
    if (result.status === 404) notFound();
    return (
      <PageError title="Opening this card" message={serviceRefusedCopy(result.status, result.reason)} />
    );
  }

  const share = result.data.share;
  const p = share.payload;
  const issued = new Date(share.createdAt).toISOString().slice(0, 10);
  // Where the snapshot is SERVED is a deployment fact, not payload data: the
  // stored path is `/api/site/<digest>/…` on every host (see lib/mode.ts).
  const site = siteHref(p.site);
  // The link the reader is already on — the only URL this page ever shares.
  const shareUrl = `${typeof location === "undefined" ? "" : location.origin}${shareUrlPath(token!)}`;

  return (
    <main className="page">
      {/* The click-through step: a shared link was opened AND the card
          resolved. A 404 or an outage above is not a click-through. No token
          travels with it, so this counts opens, never whose link. */}
      <FunnelStep step="share_opened" />
      {/* And the per-link count, which is the other half of that sentence:
          the funnel cannot say WHICH link travelled, because it carries no
          token by design, so `share_views` does — anonymously, once per
          browsing session, and only because the card above resolved. */}
      <ShareViewCount token={token!} />
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
            {/* role="img" so the aria-label is valid on a div AND so a screen reader
                reads the code as one spelled-out label instead of four stray letters. */}
            <div className="ptype-code" role="img" aria-label={`Type code ${p.playerType.code.split("").join(" ")}`}>
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
          <CharacterVoice code={p.playerType.code} />
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
              The owner switched on each part below. Anything they left off is not here.
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
                  Minutes per track, against that track&rsquo;s budget. Speed earns no points.
                  This is how the time went, not how well the run went.
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

        {site !== null ? (
          <section className="card" style={{ marginBottom: "1.6rem" }}>
            <h2 style={{ marginTop: 0 }}>The thing they actually built</h2>
            <p className="muted small">
              Their T1 submission, served live and sandboxed. They shared it on purpose. It is
              their own work, not a derived figure.
            </p>
            <p style={{ marginBottom: 0 }}>
              <a className="btn" href={site} target="_blank" rel="noreferrer">
                Open the live site <span aria-hidden>↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          </section>
        ) : null}

        {/* Pass it on. The reader already has this URL in their address bar,
            so these buttons add no reach the owner did not grant — they add
            the two taps between "nice card" and someone else opening it. The
            copy is written in the THIRD person here (`perspective="theirs"`):
            whoever holds the link may not be the person on the card. */}
        <section className="card" style={{ marginBottom: "1.6rem" }}>
          <h2 style={{ marginTop: 0 }}>Send this on</h2>
          <p className="muted small">
            The same unlisted link, with a line ready to send. The owner can revoke it at any
            time, and it then stops working everywhere.
          </p>
          <ShareTargets url={shareUrl} payload={p} perspective="theirs" />
        </section>

        <section className="card" style={{ marginBottom: "1.6rem" }}>
          <h2 style={{ marginTop: 0 }}>Find your own type</h2>
          <p className="muted">
            Foray is an AI-literacy exam you can play. Build with a model, spot what is synthetic,
            hold a line against an assistant that is wrong on purpose, and direct a generation to
            a brief.
          </p>
          <p style={{ marginBottom: 0 }}>
            <Link className="btn primary" href="/exam">Play a run →</Link>{" "}
            <Link className="btn" href="/methodology">How it is scored</Link>
          </p>
        </section>

        <p className="faint small" style={{ marginBottom: 0 }}>
          Issued by Foray on {issued} from a completed run, and served from this origin, which is
          what makes it checkable. It shows a player type, a four-track shape, a band and the
          sections its owner switched on. Never an exam item, an answer, a per-question result or a
          personal identifier. The instrument&rsquo;s own scorers derive the band from the run&rsquo;s
          stored artifacts over the demo cohort. The summit judging pipeline is not part of this
          card.{" "}
          <span className="mono">{share.views} view{share.views === 1 ? "" : "s"}</span> · unlisted
          link, not a public gallery entry. The holder can revoke it at any time, and it stops
          resolving at once.
        </p>
      </div>
    </main>
  );
}
