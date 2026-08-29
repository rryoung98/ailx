"use client";

import Link from "next/link";
import { Annotation } from "../../lib/Annotation";
import { useEffect, useState } from "react";
import { runAllChecks, type CheckResult } from "../../lib/validateChecks";
import { assetUrl } from "../../lib/mode";
import { Reveal } from "../../lib/Reveal";

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
            <div className="eyebrow">Dogfood · validate AILX quickly</div>
            <h1>Live validation of the <span className="script-accent">scoring</span> path</h1>
            <Annotation>runs in your browser</Annotation>
          </div>
        </div>
        <p className="lede">
          These checks run in your browser against the same code that scores a run. The four REAL track plugin score() functions replay pinned golden artifacts and judgments inside the purity harness. A full fixture run is scored through the same registry path used by the live game. These checks also verify content addressing, rubric-version hashing, and composite reproducibility. Since there's no network or server involved, if it passes here, it will be reproducible anywhere.
        </p>

        {results && (
          <div className="run-card">
            <span className={`badge ${allPass ? "pass-check" : "fail-check"}`}>
              {allPass ? `ALL ${total} CHECKS PASS` : `${passed} / ${total} CHECKS PASS`}
            </span>
            <span className="faint small mono">ran {ranAt}</span>
            <button className="btn" onClick={runNow}>Re-run</button>
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
        <h2>What this demonstrates</h2>
        <p className="muted" style={{ maxWidth: "44rem" }}>
          The load-bearing property of the architecture (specified in §14) is that any score, once issued, can be recomputed byte by byte from stored inputs. Each track's actual data supports this process. <code>score()</code> runs here under a harness where <code>fetch</code>, <code>Date.now</code> and{" "}
          <code>Math.random</code> throw; item banks are content-addressed, so an edited item becomes a new item; judge prompts hash into <code>rubric_version</code>; golden fixtures fail the build on any drift. The same checks run in CI via Vitest. This page serves as in-browser proof.
        </p>
        <p>
          <Link className="btn primary" href="/exam">Now play it yourself →</Link>{" "}
          <Link className="btn" href="/methodology">Methodology</Link>
        </p>
        </Reveal>
      </div>
    </main>
  );
}
