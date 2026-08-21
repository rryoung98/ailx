import Link from "next/link";

const TRACKS = [
  {
    id: "T1", name: "Creative Build", pts: 100, time: "48 h window",
    desc: "Build and ship a personal website. Machine-checkable quality gates, then blinded pairwise human judgement of visual merit.",
    detects: "Can operate a chatbot; cannot ship anything.",
  },
  {
    id: "T2", name: "Authenticity Discrimination", pts: 100, time: "50 min",
    desc: "120 rapid binary judgements on synthetic media and hostile messages, at fixed exposure, with confidence capture.",
    detects: "Trusts everything, or trusts nothing.",
  },
  {
    id: "T3", name: "AI-Assisted Reasoning", pts: 100, time: "90 min",
    desc: "Solve a hard problem with an instrumented AI assistant seeded with known-wrong outputs. Produce an original written analysis.",
    detects: "Cognitive offloading; accepts wrong output.",
  },
  {
    id: "T4", name: "Generative Direction", pts: 100, time: "60 min",
    desc: "Take a communicative brief to a finished image and video set under a hard generation quota, with prompts published.",
    detects: "Generates volume; communicates nothing.",
  },
];

const BANDS = [
  { band: "Distinction", quota: "top 1⁄12", range: "≥ 70", meaning: "Operates at the frontier of current practice on all four capabilities" },
  { band: "Merit", quota: "next 1⁄6", range: "61–69", meaning: "Strong across three of four tracks" },
  { band: "Pass", quota: "next 1⁄4", range: "50–60", meaning: "Functional applied literacy with identified gaps" },
  { band: "Participation", quota: "remainder", range: "< 50", meaning: "Completed the examination; diagnostic report issued" },
];

export default function Home() {
  return (
    <main className="page">
      <section className="container">
        <div className="eyebrow">An examination for humans, governed like a benchmark</div>
        <h1 style={{ maxWidth: "46rem", marginBottom: "1rem" }}>
          There are hundreds of benchmarks for AI systems and effectively none for the
          people who use them.
        </h1>
        <p className="lede">
          AILX measures <strong>applied AI literacy</strong> — a person’s capacity to
          produce good outcomes in an information environment saturated with generative
          systems. Four timed, performance-based tracks put a candidate in front of real
          tools and real adversarial content and score what they produce.
        </p>
        <blockquote style={{ maxWidth: "44rem" }}>
          <strong>The defensible positioning claim.</strong> AILX is the first
          cross-nationally normed, annually re-versioned, task-performance-based
          AI-literacy examination for adults. Every qualifier in that sentence is
          load-bearing and independently supportable.
        </blockquote>
        <p style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "1.6rem" }}>
          <Link className="btn primary" href="/exam">Sit the demo examination</Link>
          <Link className="btn" href="/methodology">Read the methodology</Link>
          <Link className="btn" href="/validate">Validate the scoring path</Link>
        </p>
      </section>

      <section className="container" style={{ marginTop: "3.5rem" }}>
        <div className="grid4">
          <div className="stat"><div className="value">4 × 100</div><div className="label">Tracks × raw points — reported separately and as a scaled composite</div></div>
          <div className="stat"><div className="value">4 h 20 m</div><div className="label">Sitting time across two sessions, plus an untimed T1 build window</div></div>
          <div className="stat"><div className="value">3</div><div className="label">Languages — every item ships in English, Japanese and Korean</div></div>
          <div className="stat"><div className="value">n = 45</div><div className="label">Pilot cohort, ages 18–35, US / Japan / Korea, 2026 YTL Summit</div></div>
        </div>
      </section>

      <section className="container">
        <h2>The gap being filled</h2>
        <p className="muted" style={{ maxWidth: "44rem" }}>
          Frameworks are abundant. Instruments are scarce. In the existing literature,
          “performance-based” means <em>objective and keyed</em> — multiple-choice, as
          opposed to self-report. Nobody is scoring a person actually building something,
          actually being deceived or not deceived, actually directing a model, against a
          rubric, at scale. That is the space AILX occupies.
        </p>
        <div className="grid2" style={{ marginTop: "1.4rem" }}>
          <div className="card">
            <h3>Self-report does not work</h3>
            <p className="muted small">
              A 2026 LAK study found low correlation between self-reported and objectively
              measured AI literacy. In the GLAT validation, objective score predicted
              AI-assisted task performance (β = 0.220, p = .040) while self-reported
              ChatGPT proficiency predicted nothing (p = .118).
            </p>
          </div>
          <div className="card">
            <h3>Nothing is cross-culturally validated</h3>
            <p className="muted small">
              None of the sixteen published scales has been tested for cross-cultural
              validity. A trilateral US–Japan–Korea cohort attacks the loudest unaddressed
              weakness in the literature directly — every item ships in three languages
              with recorded translation provenance, and DIF is analysed by language from
              the first cohort onward.
            </p>
          </div>
          <div className="card">
            <h3>The construct is moving</h3>
            <p className="muted small">
              The OECD–EC AILit framework was finalised 18 June 2026; PISA 2029 will field
              a separate Media &amp; AI Literacy domain. Both aim at primary and secondary
              school. Adults are unserved — and AILX re-cuts the operational form every
              year as the technology moves.
            </p>
          </div>
          <div className="card">
            <h3>Humans are worse at detection than they believe</h3>
            <p className="muted small">
              In a 2,000-person study, 0.1% correctly classified every item, and confidence
              stayed above 60% regardless of correctness. Overconfidence, not accuracy, is
              likely to be AILX’s most quotable finding.
            </p>
          </div>
        </div>
      </section>

      <section className="container">
        <h2>Four tracks, four different scoring mechanisms — on purpose</h2>
        <p className="muted" style={{ maxWidth: "44rem" }}>
          No track is scored the same way as any other, so no single failure mode in
          judging can compromise the whole examination. A discovered flaw in
          LLM-as-judge methodology damages at most 40–45 points out of 400.
        </p>
        <div className="grid2" style={{ marginTop: "1.4rem" }}>
          {TRACKS.map((t) => (
            <div className="card" key={t.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h3><span className="mono" style={{ color: "var(--accent)" }}>{t.id}</span> · {t.name}</h3>
                <span className="faint small mono">{t.pts} pts · {t.time}</span>
              </div>
              <p className="muted small">{t.desc}</p>
              <p className="small"><span className="faint">Failure it detects:</span> {t.detects}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container">
        <h2>Performance bands — norm-referenced, fixed quotas</h2>
        <p className="muted" style={{ maxWidth: "44rem" }}>
          Year-1 bands follow the International Mathematical Olympiad rather than a
          criterion-referenced exam: roughly half the cohort receives a graded award in
          the IMO’s 1 : 2 : 3 proportion. Every candidate receives a full diagnostic
          report regardless of band — the report is the real reward.
        </p>
        <table style={{ marginTop: "1.2rem" }}>
          <thead>
            <tr><th>Band</th><th>Quota (Year 1)</th><th>Composite</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            {BANDS.map((b) => (
              <tr key={b.band}>
                <td className={`band-${b.band}`} style={{ fontWeight: 700 }}>{b.band}</td>
                <td className="mono">{b.quota}</td>
                <td className="mono">{b.range}</td>
                <td className="muted">{b.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint small" style={{ marginTop: "1rem" }}>
          Track raw scores are not summed. Each track converts to a within-cohort z-score;
          z-scores are equally weighted, then rank → percentile → inverse-normal →
          rescaled to mean 50, SD 15 on a 0–100 scale. The composite is normalised by
          construction, and this is disclosed in every export.
        </p>
      </section>

      <section className="container">
        <h2>Try it</h2>
        <div className="grid2" style={{ marginTop: "1.2rem" }}>
          <div className="card">
            <h3>Sit the demo examination</h3>
            <p className="muted small">
              A compressed four-track session with the production session engine:
              per-track budgets, pause/resume, an append-only event log, and the real
              composite pipeline over a deterministic demo cohort.
            </p>
            <Link className="btn primary" href="/exam">Begin →</Link>
          </div>
          <div className="card">
            <h3>Validate AILX quickly</h3>
            <p className="muted small">
              Content-addressing, scoring purity, golden fixtures and composite
              reproducibility — executed live in your browser against the same code that
              scores an attempt.
            </p>
            <Link className="btn" href="/validate">Run the checks →</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
