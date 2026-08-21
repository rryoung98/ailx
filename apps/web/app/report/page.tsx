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

/** rAF count-up — the score reveal is the reward (§13). */
function useCountUp(target: number, ms = 1400): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - p) ** 3;
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Radar({ values }: { values: Record<(typeof TRACK_IDS)[number], number> }) {
  const C = 110, R = 82;
  const pts = TRACK_IDS.map((t, i) => {
    const a = (Math.PI * 2 * i) / 4 - Math.PI / 2;
    const r = (values[t] / 100) * R;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  });
  const ring = (f: number) =>
    TRACK_IDS.map((_, i) => {
      const a = (Math.PI * 2 * i) / 4 - Math.PI / 2;
      return `${C + R * f * Math.cos(a)},${C + R * f * Math.sin(a)}`;
    }).join(" ");
  return (
    <svg viewBox="0 0 220 220" style={{ width: "100%", maxWidth: 260 }} role="img" aria-label="Track score radar">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="var(--border)" strokeWidth="1" />
      ))}
      {TRACK_IDS.map((t, i) => {
        const a = (Math.PI * 2 * i) / 4 - Math.PI / 2;
        return (
          <g key={t}>
            <line x1={C} y1={C} x2={C + R * Math.cos(a)} y2={C + R * Math.sin(a)} stroke="var(--border)" strokeWidth="1" />
            <text
              x={C + (R + 16) * Math.cos(a)} y={C + (R + 16) * Math.sin(a) + 4}
              textAnchor="middle" fill="var(--muted)" fontSize="11" fontFamily="var(--mono)"
            >
              {t.toUpperCase()}
            </text>
          </g>
        );
      })}
      <polygon
        points={pts.map((p) => p.join(",")).join(" ")}
        fill="var(--accent)" fillOpacity="0.25" stroke="var(--accent)" strokeWidth="2"
      />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="var(--accent)" />)}
    </svg>
  );
}

function DistStrip({ cohort, mine }: { cohort: number[]; mine: number }) {
  return (
    <svg viewBox="0 0 400 56" className="dist-strip" role="img" aria-label="Cohort distribution">
      <line x1="10" y1="40" x2="390" y2="40" stroke="var(--border-strong)" strokeWidth="1" />
      {[0, 25, 50, 75, 100].map((x) => (
        <text key={x} x={10 + x * 3.8} y="53" fontSize="9" fill="var(--faint)" textAnchor="middle" fontFamily="var(--mono)">{x}</text>
      ))}
      {cohort.map((c, i) => (
        <circle key={i} cx={10 + c * 3.8} cy={40 - 6 - (i % 5) * 4} r="2.6"
          fill={Math.abs(c - mine) < 0.01 ? "var(--accent)" : "var(--faint)"}
          opacity={Math.abs(c - mine) < 0.01 ? 1 : 0.45} />
      ))}
      <line x1={10 + mine * 3.8} y1="6" x2={10 + mine * 3.8} y2="42" stroke="var(--accent)" strokeWidth="2" />
      <text x={10 + mine * 3.8} y="4" fontSize="9" fill="var(--accent)" textAnchor="middle" fontFamily="var(--mono)" dominantBaseline="hanging">you</text>
    </svg>
  );
}

export default function ReportPage() {
  const [log, setLog] = useState<SequencedEntry[] | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [showBand, setShowBand] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setLog(loadAttempt(window.localStorage));
    setHydrated(true);
    const id = window.setTimeout(() => setShowBand(true), 1100);
    return () => window.clearTimeout(id);
  }, []);

  const state = useMemo(() => (log ? project(log) : null), [log]);
  const summary = useMemo(() => (state ? candidateComposite(state) : null), [state]);
  const insights = useMemo(() => (state ? trackInsights(state) : []), [state]);
  const counted = useCountUp(summary?.composite ?? 0);

  if (!hydrated) {
    return <main className="page"><div className="container"><p className="muted">Loading…</p></div></main>;
  }

  if (!state || !log || !summary) {
    const done = state ? TRACK_IDS.filter((t) => state.tracks[t].score).length : 0;
    return (
      <main className="page">
        <div className="container" style={{ maxWidth: 820 }}>
          <h1>The report is the reward</h1>
          <p className="lede">{state ? `${done} of 4 tracks scored. Finish the attempt to unlock it.` : "No attempt in this browser yet."}</p>
          <p><Link className="btn primary" href="/exam">{state ? "Continue →" : "Sit the exam →"}</Link></p>
        </div>
      </main>
    );
  }

  const pct = Math.round(summary.percentile * 1000) / 10;
  const shareText =
    `AILX 2026.1 (demo) — composite ${summary.composite.toFixed(1)}/100, ${summary.band}, ` +
    `P${pct} of ${summary.cohortSize}. Tracks ${TRACK_IDS.map((t) => `${t.toUpperCase()} ${summary.trackRaw[t].toFixed(0)}`).join(" · ")}.`;

  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <div className="share-card" style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
            <div>
              <div className="eyebrow">attempt {state.attemptId} · n = {summary.cohortSize}</div>
              <div style={{ fontSize: "3.4rem", fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {counted.toFixed(1)}
              </div>
              <div className="muted small">composite · mean 50 · SD 15 · P{pct}</div>
              {showBand ? (
                <div className={`reveal-band pop-in band-${summary.band}`}>{summary.band}</div>
              ) : (
                <div className="reveal-band" style={{ opacity: 0.15 }}>····</div>
              )}
            </div>
            <Radar values={summary.trackRaw} />
          </div>
          <DistStrip cohort={summary.cohortComposites} mine={summary.composite} />
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
            <button className="btn small-btn" onClick={() => {
              navigator.clipboard?.writeText(shareText).then(() => {
                setCopied(true); window.setTimeout(() => setCopied(false), 1500);
              });
            }}>{copied ? "copied ✓" : "copy summary"}</button>
            <span className="badge demo">demo cohort</span>
          </div>
        </div>

        <h2 style={{ marginTop: 0 }}>Track breakdown</h2>
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
                const ALIASES: Record<string, string[]> = {
                  gates: ["gates", "functional"],
                  dprime: ["dprime", "sensitivity"],
                  brief: ["brief", "brief-fit"],
                  direction: ["direction", "craft"],
                };
                const keys = ALIASES[c.key] ?? [c.key];
                const v = keys.map((k) => score.raw[k]).find((x) => typeof x === "number") ?? 0;
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

        <h2>What the log says about you</h2>
        <div className="grid2">
          {narratives(insights).map((n) => (
            <div className="card" key={n.headline}>
              <h3>{n.headline}</h3>
              <p className="muted small" style={{ marginBottom: 0 }}>{n.detail}</p>
            </div>
          ))}
        </div>

        <h2>Take it with you</h2>
        <p style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
          <button className="btn primary" onClick={() => download(`ailx-individual-${state.attemptId}.json`, participantExport(state, summary))}>
            Individual tier (JSON)
          </button>
          <button className="btn" onClick={() => download(`ailx-research-${state.attemptId}.json`, researchExport(state, log, summary))}>
            Research tier (JSON)
          </button>
        </p>
        <p className="faint small">
          De-identified, item-level, audit-ready — rubric versions and model manifests on
          every score (spec §16). Keyed to a hashed pid, never a name.
        </p>
      </div>
    </main>
  );
}
