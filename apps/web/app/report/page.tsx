"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  loadAttempt, project, TRACK_IDS,
  type SequencedEntry,
} from "@ailx/session";
import { candidateComposite } from "../../lib/composite";
import { participantExport, researchExport } from "../../lib/exportTiers";
import { narratives, trackInsights } from "../../lib/insights";
import { TRACK_META } from "../../lib/tracks";

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportPage() {
  const [log, setLog] = useState<SequencedEntry[] | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setLog(loadAttempt(window.localStorage));
    setHydrated(true);
  }, []);

  const state = useMemo(() => (log ? project(log) : null), [log]);
  const summary = useMemo(() => (state ? candidateComposite(state) : null), [state]);
  const insights = useMemo(() => (state ? trackInsights(state) : []), [state]);

  if (!hydrated) {
    return <main className="page"><div className="container"><p className="muted">Loading…</p></div></main>;
  }

  if (!state || !log) {
    return (
      <main className="page">
        <div className="container" style={{ maxWidth: 820 }}>
          <h1>Diagnostic report</h1>
          <p className="lede">No attempt found in this browser.</p>
          <p><Link className="btn primary" href="/exam">Sit the examination →</Link></p>
        </div>
      </main>
    );
  }

  if (!summary) {
    const done = TRACK_IDS.filter((t) => state.tracks[t].score).length;
    return (
      <main className="page">
        <div className="container" style={{ maxWidth: 820 }}>
          <h1>Diagnostic report</h1>
          <p className="lede">{done} of 4 tracks scored so far. The report unlocks when the attempt is complete.</p>
          <p><Link className="btn primary" href="/exam">Continue the attempt →</Link></p>
        </div>
      </main>
    );
  }

  const pct = Math.round(summary.percentile * 1000) / 10;

  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <div className="eyebrow">Individual tier · attempt {state.attemptId}</div>
        <h1>Diagnostic report</h1>
        <p className="muted">
          <span className="badge demo">demo scoring</span>{" "}
          Composite computed against a deterministic simulated cohort of 44 peers
          (n = 45, matching the pilot). In production this is the real cohort.
        </p>

        <div className="grid4" style={{ margin: "2rem 0" }}>
          <div className="stat">
            <div className={`value band-${summary.band}`}>{summary.band}</div>
            <div className="label">Performance band (Year-1 fixed quota)</div>
          </div>
          <div className="stat">
            <div className="value">{summary.composite.toFixed(1)}</div>
            <div className="label">Composite (mean 50 · SD 15 · normalised)</div>
          </div>
          <div className="stat">
            <div className="value">{pct}%</div>
            <div className="label">Cohort percentile</div>
          </div>
          <div className="stat">
            <div className="value">{summary.zComposite >= 0 ? "+" : ""}{summary.zComposite.toFixed(2)}</div>
            <div className="label">Weighted z-composite (equal track weights)</div>
          </div>
        </div>

        <h2>Track scores</h2>
        {TRACK_IDS.map((t) => {
          const meta = TRACK_META[t];
          const ts = state.tracks[t];
          const score = ts.score!;
          return (
            <div className="card" key={t} style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h3><span className="mono" style={{ color: "var(--accent)" }}>{meta.code}</span> · {meta.name}</h3>
                <span className="mono">{score.scaled.toFixed(1)} <span className="faint">/ 100</span></span>
              </div>
              {meta.components.map((c) => {
                const v = score.raw[c.key] ?? 0;
                return (
                  <div key={c.key} style={{ display: "grid", gridTemplateColumns: "minmax(10rem, 1fr) 2fr 6.5rem", gap: "0.8rem", alignItems: "center", margin: "0.35rem 0" }}>
                    <span className="small muted">{c.label}</span>
                    <div className="meter"><div style={{ width: `${(v / c.points) * 100}%` }} /></div>
                    <span className="small mono" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{v.toFixed(1)} / {c.points}</span>
                  </div>
                );
              })}
              <p className="faint small mono" style={{ marginBottom: 0 }}>
                rubric {ts.rubricVersion?.slice(0, 12)}… · scoring {ts.scoringDigest?.slice(0, 12)}… ·{" "}
                {ts.modelManifest?.screening ? `judge ${ts.modelManifest.screening}` : ts.modelManifest?.note}
                {ts.timedOut ? " · ended on the clock" : ""}
              </p>
            </div>
          );
        })}

        <h2>Process insights</h2>
        <p className="faint small">Derived from the append-only event log — the things nobody else can tell you (spec §13).</p>
        <div className="grid2">
          {narratives(insights).map((n) => (
            <div className="card" key={n.headline}>
              <h3>{n.headline}</h3>
              <p className="muted small" style={{ marginBottom: 0 }}>{n.detail}</p>
            </div>
          ))}
        </div>
        <table style={{ marginTop: "1.2rem" }}>
          <thead><tr><th>Track</th><th>Events</th><th>Active time</th><th>Budget used</th><th>Iteration / prompt</th><th>Verification</th></tr></thead>
          <tbody>
            {insights.map((i) => (
              <tr key={i.trackId}>
                <td className="mono">{i.trackId.toUpperCase()}</td>
                <td className="mono">{i.eventCount}</td>
                <td className="mono">{Math.floor(i.activeSeconds / 60)}m {i.activeSeconds % 60}s</td>
                <td className="mono">{Math.round(i.timeUsedFrac * 100)}%{i.timedOut ? " (timed out)" : ""}</td>
                <td className="mono">{i.iterationRatio === null ? "—" : i.iterationRatio.toFixed(2)}</td>
                <td className="mono">{i.verificationEvents}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Export</h2>
        <p className="muted small" style={{ maxWidth: "44rem" }}>
          Export is a first-class product surface (spec §16). The individual tier is the
          candidate’s own record; the research tier is the de-identified, item-level shape
          a lab can audit — keyed to a hashed <span className="mono">pid</span>, never a name,
          with rubric versions and model manifests attached to every score.
        </p>
        <p style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
          <button className="btn primary" onClick={() => download(`ailx-individual-${state.attemptId}.json`, participantExport(state, summary))}>
            Download individual tier (JSON)
          </button>
          <button className="btn" onClick={() => download(`ailx-research-${state.attemptId}.json`, researchExport(state, log, summary))}>
            Download research tier (JSON)
          </button>
        </p>
      </div>
    </main>
  );
}
