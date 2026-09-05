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
            <div className="eyebrow">Dogfood · validate AILX quickly</div>
            <h1>Live validation of the <span className="script-accent">scoring</span> path</h1>
            <Annotation>runs in your browser</Annotation>
          </div>
        </div>
        <p className="lede">
          These checks run in your browser, against the same code that scores a run. All four
          REAL track plugin score() functions replay pinned golden artifacts and judgments inside
          the purity harness. A full fixture run is scored through the same registry path the
          live game uses. They also check content addressing, rubric-version hashing and
          composite reproducibility. No network, no server: what passes here reproduces on any
          machine running the same JavaScript runtime.
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
          Any score, once issued, can be recomputed byte by byte from stored inputs (spec §14).
          Every track&apos;s real <code>score()</code> runs here under a harness where the clock,
          randomness, the network and deferred scheduling all throw. Item banks are
          content-addressed, so an edited item becomes a new item. Judge prompts hash into{" "}
          <code>rubric_version</code>. Golden fixtures fail the build on any drift. CI runs the
          same checks in Vitest; this page runs them in your browser.
        </p>
        <p className="faint small" style={{ maxWidth: "44rem" }}>
          Two limits, so the green badges are not read for more than they say. The harness traps
          globals. It is not a sandbox, so it cannot see a reference captured before the call or
          a module-load import. And these checks prove replay on <em>this</em> runtime only:
          scoring is not yet proven byte-identical across JavaScript engine versions, because a
          score record stores no runtime version. See{" "}
          <Link href="/methodology">Methodology §14</Link>.
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
