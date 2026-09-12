"use client";

import Link from "next/link";
import { Annotation } from "../../components/ui/Annotation";
import { useEffect, useState } from "react";
import { runAllChecks, type CheckResult } from "../../lib/instrument/validateChecks";
import { assetUrl } from "../../lib/mode";
import { Reveal } from "../../components/ui/Reveal";

export default function ValidatePage() {
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [ranAt, setRanAt] = useState<string>("");

  const runNow = () => {
    setResults(runAllChecks());
    setRanAt(new Date().toISOString());
  };

  useEffect(() => { runNow(); }, []);

  const passed = results?.filter((r) => r.pass).length ?? 0;
  const total = results?.length ?? 0;
  const allPass = results !== null && passed === total;

  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        {/* Zero-style hero band (desk backdrop, cream scrim, serif h1 with a
            script accent). Decorative, disclosed in docs/CREDITS.md. */}
        <div className="page-hero">
          <div className="page-hero-media" aria-hidden="true">
            <img
              src={assetUrl("/media/hero-desk.jpg")}
              alt="" width={1600} height={872} decoding="async"
            />
            <div className="page-hero-scrim" />
          </div>
          <div className="page-hero-copy">
            <div className="eyebrow">Foray · scoring checks</div>
            <h1>Check the <span className="script-accent">scoring</span> code</h1>
            <Annotation>runs in your browser</Annotation>
          </div>
        </div>
        <p className="lede">
          These checks run the scoring code for all four tracks on fixed examples with known
          results. They check that the scores repeat, that changes to questions and rubrics get
          new IDs, and that the combined score stays consistent. The checks run in your browser
          without network requests. They test the code, not your AI skills.
        </p>

        {results && (
          <div className="run-card">
            <span className={`badge ${allPass ? "pass-check" : "fail-check"}`}>
              {allPass ? `ALL ${total} CHECKS PASS` : `${passed} / ${total} CHECKS PASS`}
            </span>
            <span className="faint small mono">ran {ranAt}</span>
            <button className="btn" onClick={runNow}>Run again</button>
          </div>
        )}

        <ul className="check-grid">
          {(results ?? []).map((r) => (
            <Reveal as="li" key={r.id} className="check-card">
              <div className="check-card-head">
                <span className={`badge check-pill ${r.pass ? "pass-check" : "fail-check"}`}>{r.pass ? "pass" : "fail"}</span>
                <strong>{r.title}</strong>
              </div>
              <span className="faint small">{r.spec}</span>
              <div className="muted small mono">{r.detail}</div>
            </Reveal>
          ))}
        </ul>

        <Reveal as="section">
        <h2>What passing means</h2>
        <p className="muted" style={{ maxWidth: "44rem" }}>
          Each track's <code>score()</code> runs with checks that block the clock, randomness,
          network calls, and timers. The results must match saved examples. Automated build tests
          run the same checks. Passing means these examples produce the expected scores here.
          It does not prove that scores measure real-world skill or that model judges are accurate.
          Re-scoring uses saved judgments; asking a model to judge again may give a different result.
        </p>
        <p className="faint small" style={{ maxWidth: "44rem" }}>
          The checks have limits. They block common global functions, but are not a sandbox.
          They can miss references saved before a check or code imported when a module loads.
          They also check only this JavaScript runtime. Identical results across engine versions
          are not yet proven, and score records do not store the runtime version. See{" "}
          <Link href="/methodology">how scores can be checked later</Link>.
        </p>
        <p>
          <Link className="btn primary" href="/exam">Try the tasks →</Link>{" "}
          <Link className="btn" href="/methodology">Methodology</Link>
        </p>
        </Reveal>
      </div>
    </main>
  );
}
