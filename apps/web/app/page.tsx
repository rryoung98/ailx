import Link from "next/link";
import { HeroCanvas } from "../lib/HeroCanvas";
import { Teaser } from "../lib/Teaser";
import { TrackCards } from "../lib/TrackVisuals";

export default function Home() {
  return (
    <main className="page">
      <section className="hero">
        <HeroCanvas />
        <div className="container hero-inner">
          <div className="grid2" style={{ gap: "2.5rem", alignItems: "center" }}>
            <div>
              <div className="eyebrow">AILX 2026.1 · four tracks, one score</div>
              <h1 className="hero-title">
                Benchmarks rate the models.<br />This one rates <em>you</em>.
              </h1>
              <p className="lede hero-lede">
                Build, detect, reason, direct. Four playable tracks, scored like a real
                instrument — the AILX 2026.1 specification, trilateral (US·JP·KR) by design.
                This site is its live demo build.
              </p>
              <p className="hero-cta">
                <Link className="btn primary" href="/exam">Play</Link>
                <Link className="btn" href="/validate">Watch it prove itself</Link>
              </p>
            </div>
            <Teaser />
          </div>
        </div>
      </section>

      <section className="container" style={{ marginTop: "3.5rem" }}>
        <TrackCards />
      </section>

      <section className="container" style={{ marginTop: "3rem" }}>
        <div className="grid4">
          <div className="stat"><div className="value">4 × 100</div><div className="label">points; every track scored a different way, on purpose</div></div>
          <div className="stat"><div className="value">d′</div><div className="label">detection is scored by sensitivity, not percent correct (see methodology)</div></div>
          <div className="stat"><div className="value">3</div><div className="label">languages — EN · JA · KO, translation provenance recorded</div></div>
          <div className="stat"><div className="value">1 : 2 : 3</div><div className="label">Distinction : Merit : Pass — IMO-style fixed quotas</div></div>
        </div>
        <p className="faint small" style={{ marginTop: "2rem", maxWidth: "44rem" }}>
          Every score recomputable byte-identically from stored inputs: content-addressed
          items, pure scoring, versioned rubrics. The words live in the{" "}
          <Link href="/methodology">methodology</Link>; the proof runs live on{" "}
          <Link href="/validate">/validate</Link>. Demo build — deterministic simulators,
          nothing leaves your browser.
        </p>
      </section>
    </main>
  );
}
