"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { runAllChecks, type CheckResult } from "../../lib/validateChecks";

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
        <div className="eyebrow">Dogfood · validate AILX quickly</div>
        <h1>Live validation of the scoring path</h1>
        <p className="lede">
          These checks run in your browser right now against the same code that scores an attempt. They verify content addressing, the purity harness, golden fixtures, and composite reproducibility. Since there's no network or server involved, if it passes here, it will be reproducible anywhere.
        </p>

        {results && (
          <p style={{ margin: "1.6rem 0" }}>
            <span className={`badge ${allPass ? "pass-check" : "fail-check"}`}>
              {allPass ? `ALL ${total} CHECKS PASS` : `${passed} / ${total} CHECKS PASS`}
            </span>{" "}
            <span className="faint small mono">ran {ranAt}</span>{" "}
            <button className="btn" style={{ marginLeft: "0.6rem" }} onClick={runNow}>Re-run</button>
          </p>
        )}

        <ul className="checklist">
          {(results ?? []).map((r) => (
            <li key={r.id} style={{ flexDirection: "column", alignItems: "stretch", gap: "0.2rem" }}>
              <div style={{ display: "flex", gap: "0.9rem", alignItems: "baseline" }}>
                <span className={`badge ${r.pass ? "pass-check" : "fail-check"}`}>{r.pass ? "pass" : "fail"}</span>
                <strong>{r.title}</strong>
                <span className="faint small">{r.spec}</span>
              </div>
              <div className="muted small mono" style={{ paddingLeft: "0.1rem" }}>{r.detail}</div>
            </li>
          ))}
        </ul>

        <h2>What this demonstrates</h2>
        <p className="muted" style={{ maxWidth: "44rem" }}>
          The load-bearing property of the architecture (spec §14) ensures that any score, once issued, can be recomputed byte-by-byte from stored inputs. Scoring runs under a harness where <code>fetch</code>, <code>Date.now</code> and{" "}
          <code>Math.random</code> Throw; item banks are content-addressed, so an edited item becomes a new item. Judge prompts hash into... <code>rubric_version</code>Golden fixtures fail the build on any drift. The same checks run in CI via Vitest. This page serves as in-browser proof.
        </p>
        <p>
          <Link className="btn primary" href="/exam">Now sit the exam →</Link>{" "}
          <Link className="btn" href="/methodology">Methodology</Link>
        </p>
      </div>
    </main>
  );
}
