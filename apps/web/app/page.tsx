import Link from "next/link";
import { Teaser } from "../lib/Teaser";

const TRACKS = [
  { id: "T1", name: "Creative Build", mechanic: "▸ direct a build, live preview, ship it", desc: "Ship a personal site against a brief. Gates + blinded pairwise human judgement." },
  { id: "T2", name: "Authenticity Discrimination", mechanic: "▸ swipe deck · arrow keys · replay reveal", desc: "120 rapid real-or-fake calls with confidence. Scored on d′, not percent correct." },
  { id: "T3", name: "AI-Assisted Reasoning", mechanic: "▸ the assistant lies twice. catch it", desc: "A hard problem, an instrumented assistant seeded with wrong outputs, your name on the answer." },
  { id: "T4", name: "Generative Direction", mechanic: "▸ 6 generations. make them count", desc: "Take a brief to a finished image under a hard quota. Direction, not volume." },
];

export default function Home() {
  return (
    <main className="page">
      <section className="container">
        <div className="grid2" style={{ gap: "2rem", alignItems: "center" }}>
          <div>
            <div className="eyebrow">The AI Literacy Examination · 2026.1</div>
            <h1 style={{ marginBottom: "0.8rem" }}>
              Benchmarks rate the models.<br />This one rates <em>you</em>.
            </h1>
            <p className="lede" style={{ fontSize: "1.05rem" }}>
              Four performance tracks — build, detect, reason, and direct — are scored like a real instrument. Built to the AILX 2026.1 specification — a trilateral (US·JP·KR) instrument design; this site is its live demo build.
            </p>
            <p style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "1.4rem" }}>
              <Link className="btn primary" href="/exam">Start the exam</Link>
              <Link className="btn" href="/validate">Watch it prove itself</Link>
            </p>
          </div>
          <Teaser />
        </div>
      </section>

      <section className="container" style={{ marginTop: "3.5rem" }}>
        <div className="grid4">
          {TRACKS.map((t) => (
            <Link key={t.id} href="/exam" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="card track-card" style={{ height: "100%" }}>
                <h3 style={{ marginBottom: "0.3rem" }}>
                  <span className="mono" style={{ color: "var(--accent)" }}>{t.id}</span> {t.name}
                </h3>
                <p className="muted small" style={{ margin: "0.3rem 0 0.6rem" }}>{t.desc}</p>
                <span className="mechanic mono">{t.mechanic}</span>
              </div>
            </Link>
          ))}
        </div>
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
