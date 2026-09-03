import Link from "next/link";
import { Annotation } from "../components/ui/Annotation";
import { FunnelStep } from "../components/FunnelStep";
import { HeroCanvas } from "../features/landing/HeroCanvas";
import { PillCTA } from "../components/ui/PillCTA";
import { PracticeDrill } from "../features/practice/PracticeDrill";
import { Reveal } from "../components/ui/Reveal";
import { CharacterPortrait } from "../components/CharacterPortrait";
import { CampusJourney } from "../features/landing/track3d/CampusJourney";
import { TrackBands } from "../features/landing/track3d/TrackBands";
import { assetUrl, isServerMode } from "../lib/mode";
import { CHARACTER_CAST, PRACTICE_OPTIONS, TRACK_LIST } from "@ailx/report";
import { TOTAL_POINTS } from "@ailx/core";

/**
 * Decorative paper artifacts drifting at different scroll rates behind the
 * pinned hero. Pure SVG/CSS (no rasters); hidden from AT and from browsers
 * without scroll-driven animations (CSS gates them behind @supports).
 */
function HeroArtifacts() {
  return (
    <div className="hero-artifacts" aria-hidden="true">
      <svg className="hero-artifact artifact-scrap" viewBox="0 0 120 90" focusable="false" aria-hidden="true">
        <path
          d="M8 14 L34 6 L61 12 L88 4 L112 16 L108 42 L114 68 L86 82 L52 76 L24 86 L10 60 Z"
          fill="var(--card)" stroke="var(--border-strong)" strokeWidth="1.5" strokeLinejoin="round"
        />
        <path d="M26 34 H92 M26 48 H80 M26 62 H88" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
      <svg className="hero-artifact artifact-pencil" viewBox="0 0 220 40" focusable="false" aria-hidden="true">
        <path
          d="M4 30 C 40 6, 90 38, 128 18 S 200 10, 216 24"
          fill="none" stroke="var(--accent-dim)" strokeWidth="2.5" strokeLinecap="round"
        />
      </svg>
      <div className="hero-artifact artifact-grid" />
    </div>
  );
}

/** Small CSS-art visuals for the four funnel steps. */
function StepVizTracks() {
  return (
    <div className="wyg-viz wyg-viz-tracks" aria-hidden="true">
      {TRACK_LIST.map((t) => (
        <span key={t.code} className="mono">{t.code}</span>
      ))}
    </div>
  );
}

/** The two calls the drill actually asks for; labels come from the corpus. */
function StepVizCalls() {
  return (
    <div className="wyg-viz wyg-viz-calls" aria-hidden="true">
      {PRACTICE_OPTIONS.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}

/** A week of practice days: filled ones behind you, one still open. */
function StepVizStreak() {
  return (
    <div className="wyg-viz wyg-viz-streak" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={i < 4 ? "wyg-day on" : "wyg-day"} />
      ))}
    </div>
  );
}

function StepVizReport() {
  return (
    <div className="wyg-viz wyg-viz-report" aria-hidden="true">
      <span className="wyg-report-card">
        <span className="wyg-report-line" />
        <span className="wyg-report-line short" />
        <span className="wyg-report-check">✓</span>
      </span>
    </div>
  );
}


/**
 * Zero-style showcase minis: tiny white UI cards that float over the
 * pastoral panel at different parallax rates. Pure CSS/DOM (no rasters),
 * decorative only (the wrapping layer is aria-hidden).
 */
/**
 * The scale, not a score. This card used to print "206.6 / 400" under the
 * band "Merit" — an invented result on the page that sells the instrument,
 * next to pages that say plainly no judged number exists yet. The denominator
 * is a published fact of the spec; the numerator is deliberately blank.
 *
 * It reads `TOTAL_POINTS` rather than printing a number, because the total
 * moved (400 -> 375, TEN-80) and a hardcoded denominator in front of a
 * visitor is a number that survives a re-weighting and lies.
 */
function MiniScoreCard() {
  return (
    <span className="mini-card mini-card-score showcase-float-1">
      <span className="mini-card-eyebrow mono">AILX 2026.1</span>
      <span className="mini-card-band">your score</span>
      <span className="mini-card-num mono">?<span className="mini-card-denom">/{TOTAL_POINTS}</span></span>
    </span>
  );
}

function MiniChecksCard() {
  return (
    <span className="mini-card mini-card-checks showcase-float-2">
      {["sha256 verified", "replay = live", "export matches"].map((s) => (
        <span key={s} className="mini-check">
          <span className="mini-check-tick">✓</span>
          <span className="mono">{s}</span>
        </span>
      ))}
    </span>
  );
}

function MiniReportCard() {
  return (
    <span className="mini-card mini-card-report showcase-float-3">
      <span className="mini-report-seal" />
      <span className="mini-report-lines">
        <span className="mini-report-line" />
        <span className="mini-report-line short" />
      </span>
    </span>
  );
}

/** One showcase row: copy on the left, painterly panel with floating minis on the right. */
function ShowcaseRow({
  href, flip = false, title, note, line, cta, cards,
}: {
  href: string;
  flip?: boolean;
  title: React.ReactNode;
  note: string;
  line: string;
  cta: string;
  cards: React.ReactNode;
}) {
  return (
    <Reveal as="div" className={`showcase-row${flip ? " showcase-row-flip" : ""}`}>
      <div className="showcase-copy">
        <h2 className="showcase-title">{title}</h2>
        <Annotation side={flip ? "left" : "right"}>{note}</Annotation>
        <p className="showcase-line muted">{line}</p>
        <p data-pill-clear=""><Link className="btn" href={href}>{cta}</Link></p>
      </div>
      <Link href={href} className="showcase-panel" tabIndex={-1} aria-hidden="true">
        <img src={assetUrl("/media/pastoral.jpg")} alt="" width={2000} height={1200} loading="lazy" decoding="async" />
        <span className="showcase-scrim" />
        <span className="showcase-cards">{cards}</span>
      </Link>
    </Reveal>
  );
}

/**
 * The cast: the sixteen player-type characters a finished run can land on.
 *
 * This is the IDENTITY step of the front door, and the card built from it is
 * the thing people actually put in a feed, so the page SHOWS the faces
 * instead of describing them. The copy is deliberately small: the type is a
 * playful reading of what the run recorded (`packages/report/playerType.ts`
 * says so in its first line), never a score, a rank or a norm — there is no
 * judged number to rank anybody by.
 *
 * Every face prints its four-letter code as TEXT beside it, so the row still
 * says something with images off and in a screen reader; the portrait's own
 * alt describes the drawing (components/CharacterPortrait.tsx).
 */
function CastStrip() {
  return (
    <section className="container cast" aria-label="The sixteen player types">
      <Reveal as="div" className="cast-copy">
        <h2 className="cast-title">
          A full run ends on one of <span className="script-accent">sixteen</span> characters.
        </h2>
        <p className="cast-line">
          Four axes, one per track, read from what you did. It is for fun, never a grade, and the
          card is the part people share.
        </p>
        <p className="cast-more" data-pill-clear=""><Link href="/report">See a sample card →</Link></p>
      </Reveal>
      <ul className="cast-row" data-pill-clear="">
        {CHARACTER_CAST.map((c) => (
          <li key={c.code} className="cast-tile">
            <CharacterPortrait code={c.code} size={72} className="cast-face" />
            <span className="mono cast-code">{c.code}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Home() {
  return (
    <main className="page">
      {/* Step 2 of docs/KPI.md. Silent in the static export, which has no
          backend to post to. */}
      <FunnelStep step="landing_viewed" />
      <div className="hero-cinema">
        <div className="hero-stage">
          <section className="hero hero-phase-a">
            <HeroCanvas />
            <HeroArtifacts />
            <div className="container hero-inner">
              {/* Front door: the first thing in the viewport is a REAL card
                  from the practice corpus, playable in both builds, not a
                  mock and not a four-hour sitting. Three grid children rather
                  than two columns so a phone reads copy, then the card, then
                  the calls to action — the card lands where the fold is. */}
              <div className="hero-grid">
                <div className="hero-copy">
                  <div className="eyebrow hero-fade">AILX 2026.1 · free to play · no account</div>
                  <h1 className="hero-title">
                    <span className="hero-line hero-line-1">Benchmarks rate the models.</span>
                    <br />
                    <span className="hero-line hero-line-2">This one rates <span className="script-accent">you</span>.</span>
                  </h1>
                  <span className="hero-fade hero-annotation"><Annotation>one card, right now</Annotation></span>
                  <p className="lede hero-lede hero-fade">
                    Start here: photograph, or generated? You get the answer and the tell the
                    moment you call it.
                  </p>
                </div>
                {/* The drill is tappable end to end, so the fixed bottom pill
                    must clear it: on a 390x844 phone the pill printed straight
                    across the two answer buttons. */}
                <div className="hero-fade hero-play" data-pill-clear="">
                  <PracticeDrill />
                </div>
                <p className="hero-cta hero-fade" data-pill-clear="">
                  <Link className="btn primary" href="/practice">Play a full round</Link>
                  <Link className="btn" href="/exam">Go for the credential</Link>
                </p>
              </div>
            </div>
          </section>
          {/* Scroll-scrubbed interstitial. Decorative restatement of the h1's
              claim: aria-hidden keeps the accessibility tree to a single
              headline; CSS keeps it display:none without scroll timelines. */}
          <div className="hero-phase-b" aria-hidden="true">
            <p className="hero-phase-b-copy">
              <span className="hero-phase-b-line">Benchmarks are a hundred numbers.</span>
              <span className="hero-phase-b-line">You are <span className="script-accent">one</span> score.</span>
            </p>
          </div>
        </div>
      </div>

      {/* Zero-style expanding desk panel: rounded ~70% media panel that
          scrubs to full-bleed on a view timeline while the headline scrolls
          away above it; the quote + track cards then float over the pinned
          image. Decorative AI-generated backdrop (disclosed in
          docs/CREDITS.md); empty alt + aria-hidden keep it out of AT. */}
      <section className="desk-cinema">
        <div className="desk-stage">
          <div className="desk-panel media-panel" aria-hidden="true">
            <img
              src={assetUrl("/media/hero-desk.jpg")}
              alt="" width={1600} height={872} loading="lazy" decoding="async"
            />
            <div className="desk-scrim" />
          </div>
        </div>
        <div className="desk-overlay">
          <div className="container">
            <Reveal as="div" className="desk-quote-wrap">
              <blockquote className="desk-quote">
                Plays like a game.<br />Scored like an <span className="script-accent">instrument</span>.
              </blockquote>
            </Reveal>
            <div className="desk-cards">
              {TRACK_LIST.map((t) => (
                <Reveal as="div" className="desk-card" key={t.code}>
                  <span className="mono desk-card-code">{t.code}</span>
                  <span className="desk-card-line">{t.hype.replace(/^T\d\s*\u2014\s*/u, "")}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Map-pan journey over the campus aerial (supporting browsers) with
          the static alternating bands as the no-timeline / reduced-motion
          fallback. CSS guarantees exactly one of the two is displayed. */}
      <CampusJourney />
      <section className="container-wide track-bands-landing track-bands-fallback">
        <TrackBands />
      </section>

      {/* The funnel, in the order it is actually walked: play, come back,
          then the graded run and what it leaves you with. The scored sitting
          is step three on purpose — it is the graduation, not the entry fee,
          and it stays one click away from the hero for anyone who came to
          certify. Nothing here claims a judged score or a norm: there is no
          judging pipeline yet, so a number implying one would be a lie. */}
      <section className="container wyg" aria-label="How AILX works">
        {/* The floating pill is fixed to the bottom of the viewport; without
            this it parks on top of these headings for the whole section. */}
        <ol className="wyg-steps" data-pill-clear="">
          <Reveal as="li" className="wyg-step">
            <StepVizCalls />
            <h2 className="wyg-title">Play one card.</h2>
            <p className="wyg-line">
              Photograph or generated? The answer and the tell arrive together. Free, unscored,
              and it never touches the graded bank.
            </p>
            <p className="wyg-more"><Link href="/practice">Practise the tells →</Link></p>
          </Reveal>
          <Reveal as="li" className="wyg-step">
            <StepVizStreak />
            {/* One step in both builds, because the streak now works in both:
                a finished round is a day, kept in the visitor's own browser
                when no account is recording it. The link is the only thing
                that differs — the static export has no /progress. */}
            <h2 className="wyg-title">Come back tomorrow.</h2>
            <p className="wyg-line">
              Finish a round and the day counts. No account: the days are kept in this browser,
              and the streak is counted from what you actually finished, never a number you told
              it.
            </p>
            <p className="wyg-more">
              {isServerMode() ? (
                <Link href="/progress">See your progress →</Link>
              ) : (
                <Link href="/practice">Practise the tells →</Link>
              )}
            </p>
          </Reveal>
          <Reveal as="li" className="wyg-step">
            <StepVizTracks />
            <h2 className="wyg-title">Then take the whole thing.</h2>
            <p className="wyg-line">
              Four tracks in one sitting, each on its own clock: build, spot fakes, catch lies,
              direct. That is the graded run, and it is the long one.
            </p>
            <p className="wyg-more"><Link href="/exam">Start the full run →</Link></p>
          </Reveal>
          <Reveal as="li" className="wyg-step">
            <StepVizReport />
            <h2 className="wyg-title">Keep what it leaves you.</h2>
            <p className="wyg-line">
              A report you can share and a credential anyone can check. The credential records a
              finished sitting, never a grade, and every point is recomputable from what you did.
            </p>
            <p className="wyg-more"><Link href="/report">See a sample report →</Link></p>
          </Reveal>
        </ol>
      </section>

      {/* The identity payoff, between the funnel and the proof: the funnel's
          last step promises a card worth keeping, so the faces come next. */}
      <CastStrip />

      {/* Zero-style proof showcase: two split rows (serif header + script
          accent + hand note on the left; pastoral panel with floating white
          minis drifting at different scroll rates on the right). Panels are
          decorative duplicates of the copy links (aria-hidden, tabIndex -1). */}
      <section className="container showcase" aria-label="See how the scoring works">
        <ShowcaseRow
          href="/methodology"
          title={<>Read the <span className="script-accent">methodology</span>.</>}
          note="no black boxes"
          line="Construct, psychometrics, judge governance. All of it public."
          cta="Read the methodology"
          cards={<><MiniScoreCard /><MiniReportCard /></>}
        />
        <ShowcaseRow
          href="/validate"
          flip
          title={<>Watch it <span className="script-accent">prove</span> itself.</>}
          note="runs in your browser"
          line="Eight live checks replay the real scoring path on this page."
          cta="Run the checks"
          cards={<><MiniChecksCard /><MiniScoreCard /></>}
        />
        <p className="showcase-caption faint small">This is the demo build of the AILX 2026.1 spec.</p>
      </section>
      <PillCTA href="/practice">Play a round</PillCTA>
    </main>
  );
}
