import Link from "next/link";
import { Annotation } from "../lib/Annotation";
import { HeroCanvas } from "../lib/HeroCanvas";
import { PillCTA } from "../lib/PillCTA";
import { Reveal } from "../lib/Reveal";
import { Teaser } from "../lib/Teaser";
import { CampusJourney } from "../lib/track3d/CampusJourney";
import { TrackBands } from "../lib/track3d/TrackBands";
import { assetUrl } from "../lib/mode";
import { TRACK_LIST } from "@ailx/report";

/**
 * Decorative paper artifacts drifting at different scroll rates behind the
 * pinned hero. Pure SVG/CSS (no rasters); hidden from AT and from browsers
 * without scroll-driven animations (CSS gates them behind @supports).
 */
function HeroArtifacts() {
  return (
    <div className="hero-artifacts" aria-hidden="true">
      <svg className="hero-artifact artifact-scrap" viewBox="0 0 120 90" focusable="false">
        <path
          d="M8 14 L34 6 L61 12 L88 4 L112 16 L108 42 L114 68 L86 82 L52 76 L24 86 L10 60 Z"
          fill="var(--card)" stroke="var(--border-strong)" strokeWidth="1.5" strokeLinejoin="round"
        />
        <path d="M26 34 H92 M26 48 H80 M26 62 H88" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
      <svg className="hero-artifact artifact-pencil" viewBox="0 0 220 40" focusable="false">
        <path
          d="M4 30 C 40 6, 90 38, 128 18 S 200 10, 216 24"
          fill="none" stroke="var(--accent-dim)" strokeWidth="2.5" strokeLinecap="round"
        />
      </svg>
      <div className="hero-artifact artifact-grid" />
    </div>
  );
}

/** Small CSS-art visuals for the three "what you get" steps. */
function StepVizTracks() {
  return (
    <div className="wyg-viz wyg-viz-tracks" aria-hidden="true">
      {TRACK_LIST.map((t) => (
        <span key={t.code} className="mono">{t.code}</span>
      ))}
    </div>
  );
}

function StepVizScore() {
  return (
    <div className="wyg-viz wyg-viz-score" aria-hidden="true">
      <span className="wyg-score-ring"><span className="wyg-score-num">1</span></span>
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
function MiniScoreCard() {
  return (
    <span className="mini-card mini-card-score showcase-float-1">
      <span className="mini-card-eyebrow mono">AILX 2026.1</span>
      <span className="mini-card-band">Merit</span>
      <span className="mini-card-num mono">206.6<span className="mini-card-denom">/400</span></span>
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

export default function Home() {
  return (
    <main className="page">
      <div className="hero-cinema">
        <div className="hero-stage">
          <section className="hero hero-phase-a">
            <HeroCanvas />
            <HeroArtifacts />
            <div className="container hero-inner">
              <div className="grid2" style={{ gap: "2.5rem", alignItems: "center" }}>
                <div>
                  <div className="eyebrow hero-fade">AILX 2026.1 · four tracks, one score</div>
                  <h1 className="hero-title">
                    <span className="hero-line hero-line-1">Benchmarks rate the models.</span>
                    <br />
                    <span className="hero-line hero-line-2">This one rates <span className="script-accent">you</span>.</span>
                  </h1>
                  <span className="hero-fade"><Annotation>scored like an instrument</Annotation></span>
                  <p className="lede hero-lede hero-fade">
                    Play four short tracks: build, spot fakes, reason, direct.
                    Get one score you can check.
                  </p>
                  <p className="hero-cta hero-fade" data-pill-clear="">
                    <Link className="btn primary" href="/exam">Play</Link>
                    <Link className="btn" href="/validate">See it prove itself</Link>
                  </p>
                </div>
                <div className="hero-fade"><Teaser /></div>
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

      {/* What you get: three steps, one idea each. */}
      <section className="container wyg" aria-label="What you get">
        {/* The floating pill is fixed to the bottom of the viewport; without
            this it parks on top of these headings for the whole section. */}
        <ol className="wyg-steps" data-pill-clear="">
          <Reveal as="li" className="wyg-step">
            <StepVizTracks />
            <h2 className="wyg-title">Play the four tracks.</h2>
            <p className="wyg-line">Build a page, spot the fakes, catch the lies, direct the renders.</p>
          </Reveal>
          <Reveal as="li" className="wyg-step">
            <StepVizScore />
            <h2 className="wyg-title">Get one honest score.</h2>
            <p className="wyg-line">Four tracks become one number and one band. The math is public.</p>
          </Reveal>
          <Reveal as="li" className="wyg-step">
            <StepVizReport />
            <h2 className="wyg-title">Share a report that proves itself.</h2>
            <p className="wyg-line">Every point can be recomputed from what you did — no black box, and nothing you cannot check.</p>
          </Reveal>
        </ol>
      </section>

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
      <PillCTA href="/exam">Play</PillCTA>
    </main>
  );
}
