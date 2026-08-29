"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  append, loadAttempt, project, TRACK_IDS,
  type SequencedEntry,
} from "@ailx/session";
import { buildSampleAttemptLog } from "../../lib/sampleAttempt";
import { scoreTrack } from "../../lib/registry";
import {
  calibrationBins, candidateComposite, narratives, participantExport, playerProfile,
  playerType, researchExport, t2ResponsesFromArtifact, TRACK_META, trackInsights,
} from "@ailx/report";
import { CalibrationCurve } from "../../lib/CalibrationCurve";
import { t2AnswerKeys } from "../../lib/instrument";
import { loadSiteSubmission, type SiteSubmission } from "../../lib/siteUpload";
import { Reveal } from "../../lib/Reveal";
import { SiteLink } from "../../lib/SiteLink";
import { ShareLink } from "../../lib/ShareLink";
import { TrackRadar } from "../../lib/TrackRadar";

const GALLERY_API = "https://ailx-shared-demo.vercel.app/api/gallery";

/**
 * Opt-in share of the T4 chosen set to the public community wall.
 * Uploads ONLY on click: recompressed finals + direction note + model id.
 * Votes there are a human aesthetic signal, never part of the score.
 */
function ShareToGallery({ artifact }: { artifact: unknown }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const a = artifact as {
    finals?: { images?: { dataUri?: string; asset?: string; prompt?: string; modelId?: string }[] };
    chosenSet?: number[];
    note?: string;
  } | null;
  const chosen = (a?.chosenSet ?? []).map((i) => a?.finals?.images?.[i]).filter((f) => f?.dataUri);
  if (chosen.length === 0) return null;
  const share = async () => {
    setState("busy");
    try {
      const { recompressDataUri } = await import("@ailx/track-t4");
      const images = await Promise.all(
        chosen.slice(0, 3).map(async (f) => {
          const uri = f!.dataUri!;
          return uri.length > 440 * 1024 ? await recompressDataUri(uri, 440 * 1024) : uri;
        }),
      );
      const res = await fetch(GALLERY_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images,
          note: (a?.note ?? "").slice(0, 800),
          model: chosen[0]?.modelId ?? "",
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("done");
    } catch {
      setState("error");
    }
  };
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: "0.6rem", flexWrap: "wrap" }}>
      {state === "done" ? (
        <Link className="btn small-btn" href="/wall">On the wall — see the sets →</Link>
      ) : (
        <button className="btn small-btn" onClick={share} disabled={state === "busy"}>
          {state === "busy" ? "Sharing…" : "Share this set to the community wall"}
        </button>
      )}
      {state === "error" ? <span className="small faint">Could not share — try again later.</span> : null}
      <span className="small faint">
        Opt-in and public. Uploads the chosen finals + direction note, nothing else.
      </span>
    </div>
  );
}

/**
 * Live sandboxed snapshot of the T1 submission (server mode only — static
 * mode never records a submission, so this renders nothing there).
 */
function SiteLiveLink({ attemptId }: { attemptId?: string }) {
  const [sub, setSub] = useState<SiteSubmission | null>(null);
  useEffect(() => {
    setSub(attemptId ? loadSiteSubmission(window.localStorage, attemptId) : null);
  }, [attemptId]);
  if (!sub) return null;
  return (
    <p className="small" style={{ marginTop: "0.6rem" }}>
      Live snapshot: <SiteLink url={sub.url} />{" "}
      <span className="faint">— served sandboxed; anyone with the link can view it.</span>
    </p>
  );
}

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
  // Sample mode: the bundled deterministic fixture rendered read-only —
  // nothing is written to storage, a banner marks it clearly.
  const [sample, setSampleState] = useState(false);
  const setSample = (v: boolean) => {
    setSampleState(v);
    if (v) {
      // Score the bundled artifacts through the REAL track plugins so the
      // sample report exercises the same path as a live run (read-only).
      let sampleLog = buildSampleAttemptLog();
      const proj = project(sampleLog);
      for (const t of TRACK_IDS) {
        const artifact = proj.tracks[t].artifact;
        if (!artifact) continue;
        // No attemptId here: the fixture artifacts are built on the FIXED
        // default T2 deck — scoring with the fixture's attemptId would
        // rotate to a different deck and lapse every response.
        const rec = scoreTrack(t, artifact, "en");
        sampleLog = append(sampleLog, {
          type: "track_scored", trackId: t, score: rec.score,
          judgments: rec.judgments,
          rubricVersion: rec.rubricVersion,
          scoringDigest: rec.scoringDigest,
          modelManifest: rec.modelManifest,
          ts: sampleLog[sampleLog.length - 1].ts + 1000,
        });
      }
      setLog(sampleLog);
    } else setLog(loadAttempt(window.localStorage));
  };
  useEffect(() => {
    setLog(loadAttempt(window.localStorage));
    setHydrated(true);
    const id = window.setTimeout(() => setShowBand(true), 1100);
    return () => window.clearTimeout(id);
  }, []);

  const state = useMemo(() => (log ? project(log) : null), [log]);
  const summary = useMemo(() => (state ? candidateComposite(state) : null), [state]);
  const insights = useMemo(() => (state ? trackInsights(state) : []), [state]);
  const profile = useMemo(() => (state ? playerProfile(state, insights) : null), [state, insights]);
  const calBins = useMemo(() => {
    if (!state) return [];
    // Full-bank key map for the attempt's locale: the demo deck rotates per
    // attempt, so resolve any item id the stored artifact may reference.
    return calibrationBins(
      t2ResponsesFromArtifact(state.tracks.t2.artifact),
      t2AnswerKeys(state.config?.locale ?? "en"),
    );
  }, [state]);
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
          <p className="lede">{state ? `${done} of 4 tracks scored. Finish the run to unlock it.` : "No run in this browser yet."}</p>
          <p style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
            <Link className="btn primary" href="/exam">{state ? "Continue →" : "Play →"}</Link>
            {!state ? (
              <button type="button" className="btn" onClick={() => setSample(true)}>
                Peek at a sample report
              </button>
            ) : null}
          </p>
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
        <h1 className="sr-only">Diagnostic report</h1>
        {sample ? (
          <div role="note" style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap", border: "1px solid var(--border)", background: "var(--card)", borderRadius: 10, padding: "0.6rem 1rem", marginBottom: "1.2rem", fontSize: "0.85rem" }}>
            <span className="badge demo">sample</span>
            <span className="muted" style={{ flex: 1 }}>This is the bundled demo fixture, not your play. Nothing was saved.</span>
            <button type="button" className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setSample(false)}>Exit sample</button>
          </div>
        ) : null}
        <div className="share-card" style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
            <div>
              <div className="eyebrow">run {state.attemptId} · n = {summary.cohortSize}</div>
              {/* The rAF count-up is decorative for AT: hide the animated
                  number and expose the final value + band once, politely. */}
              <div aria-hidden="true" className="composite-number" style={{ fontSize: "3.4rem", fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {counted.toFixed(1)}
              </div>
              <span className="sr-only" role="status">
                {showBand
                  ? `Composite score ${summary.composite.toFixed(1)} out of 100. Band: ${summary.band}.`
                  : ""}
              </span>
              <div className="muted small">composite · mean 50 · SD 15 · P{pct}</div>
              <div className="muted small">
                raw {TRACK_IDS.reduce((a, t) => a + summary.trackRaw[t], 0).toFixed(1)} / 400
              </div>
              {summary.percentile <= 0.5 / summary.cohortSize + 1e-9 ? (
                <div className="faint small" style={{ maxWidth: "34ch" }}>
                  Floor of this demo cohort: every run below all {summary.cohortSize - 1} synthetic
                  peers lands on the same standardized value. The raw points above still move.
                </div>
              ) : null}
              {showBand ? (
                <div aria-hidden="true" className={`reveal-band pop-in band-${summary.band}`}>{summary.band}</div>
              ) : (
                <div aria-hidden="true" className="reveal-band" style={{ opacity: 0.15 }}>····</div>
              )}
            </div>
            <TrackRadar values={summary.trackRaw} />
          </div>
          <DistStrip cohort={summary.cohortComposites} mine={summary.composite} />
          <div className="share-track-bars" data-testid="share-track-bars">
            {TRACK_IDS.map((t) => (
              <div className="row" key={t}>
                <span className="mono" style={{ color: "var(--accent)" }}>{t.toUpperCase()}</span>
                <div className="meter"><div style={{ width: `${Math.max(0, Math.min(100, summary.trackRaw[t]))}%` }} /></div>
                <span className="mono" style={{ textAlign: "right" }}>{summary.trackRaw[t].toFixed(1)}</span>
              </div>
            ))}
          </div>
          <p className="faint small mono" style={{ margin: "0.4rem 0 0" }}>
            quota-derived band cutlines (this cohort):{" "}
            {(["Distinction", "Merit", "Pass"] as const)
              .map((b) => `${b} ≥ ${summary.bandCutlines[b]?.toFixed(1) ?? "—"}`)
              .join(" · ")}{" "}
            — bands are quota-authoritative (spec §04), not fixed thresholds.
          </p>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
            <button className="btn small-btn" onClick={() => {
              navigator.clipboard?.writeText(shareText).then(() => {
                setCopied(true); window.setTimeout(() => setCopied(false), 1500);
              });
            }}>{copied ? "copied ✓" : "copy summary"}</button>
            <span className="badge demo">demo cohort</span>
          </div>
        </div>

        {profile ? (
          <Reveal as="section" className="card" data-testid="player-profile" style={{ marginBottom: "2rem" }}>
            <div className="eyebrow">player profile · a playful read, never scored</div>
            <div style={{ display: "flex", gap: "1.4rem", alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="mono" aria-label={`Profile code ${profile.code.split("").join(" ")}`} style={{ fontSize: "2.6rem", fontWeight: 800, letterSpacing: "0.22em", color: "var(--accent)" }}>
                {profile.code}
              </span>
              <h3 style={{ margin: 0 }}>{profile.archetype}</h3>
            </div>
            <p className="muted small" style={{ maxWidth: "62ch" }}>{profile.blurb}</p>
            <div style={{ display: "grid", gap: "0.9rem", marginTop: "0.4rem" }}>
              {profile.axes.map((a) => (
                <div key={a.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.8rem" }}>
                    <span className="small" style={{ color: a.letter === a.letters[0] ? "var(--fg)" : "var(--faint)" }}>
                      <span className="mono" style={{ color: "var(--accent)" }}>{a.letters[0]}</span> {a.poles[0]}
                    </span>
                    <span className="small mono" style={{ color: "var(--accent)" }}>{a.strength}% {a.pole}</span>
                    <span className="small" style={{ color: a.letter === a.letters[1] ? "var(--fg)" : "var(--faint)", textAlign: "right" }}>
                      {a.poles[1]} <span className="mono" style={{ color: "var(--accent)" }}>{a.letters[1]}</span>
                    </span>
                  </div>
                  <div aria-hidden="true" style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--border)", margin: "0.35rem 0 0.2rem" }}>
                    <div style={{ position: "absolute", top: -3, left: `calc(${(1 - a.value) * 100}% - 6px)`, width: 12, height: 12, borderRadius: "50%", background: "var(--accent)" }} />
                  </div>
                  <div className="faint small">{a.basis}</div>
                </div>
              ))}
            </div>
            <p className="faint small" style={{ marginBottom: 0 }}>
              Derived from the same stored artifacts and event log as the scores above; the letters move no points.
            </p>
          </Reveal>
        ) : null}

        {(() => {
          const p = playerType(summary.trackRaw);
          return (
            <Reveal as="section" className="card ptype-card" aria-label="Player type">
              <div className="ptype-head">
                <div>
                  <p className="kicker" style={{ margin: 0 }}>YOUR PLAYER TYPE · JUST FOR FUN</p>
                  <h2 style={{ margin: "0.2rem 0 0.1rem" }}>{p.name}</h2>
                  <p className="muted" style={{ margin: 0 }}>{p.tagline}</p>
                </div>
                <div className="ptype-code" aria-label={`Type code ${p.code}`}>
                  {p.poles.map((pole) => (
                    <span key={pole.track} className={`ptype-letter${pole.high ? " hi" : ""}`} title={`${pole.track.toUpperCase()}: ${pole.label}`}>
                      {pole.letter}
                    </span>
                  ))}
                </div>
              </div>
              <div className="ptype-axes">
                {p.poles.map((pole) => (
                  <span key={pole.track} className="small muted">
                    <span className="mono" style={{ color: "var(--accent)" }}>{pole.track.toUpperCase()}</span> {pole.label}
                  </span>
                ))}
              </div>
              <div className="grid2" style={{ marginTop: "0.6rem" }}>
                {p.strengths.length > 0 && (
                  <div>
                    <h4 className="small" style={{ margin: "0 0 0.3rem" }}>Where you played strong</h4>
                    <ul className="small muted ptype-list">{p.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
                  </div>
                )}
                {p.watchouts.length > 0 && (
                  <div>
                    <h4 className="small" style={{ margin: "0 0 0.3rem" }}>Watch for next run</h4>
                    <ul className="small muted ptype-list">{p.watchouts.map((s) => <li key={s}>{s}</li>)}</ul>
                  </div>
                )}
              </div>
              <p className="faint small" style={{ margin: "0.6rem 0 0" }}>
                A playful lens on this one run — split at the demo cohort's per-track median.
                Not a personality claim, and never part of the score.
              </p>
            </Reveal>
          );
        })()}

        {!sample && state.attemptId ? <ShareLink attemptId={state.attemptId} /> : null}

        <h2 style={{ marginTop: 0 }}>Track breakdown</h2>
        {TRACK_IDS.map((t) => {
          const meta = TRACK_META[t];
          const ts = state.tracks[t];
          const score = ts.score!;
          return (
            <Reveal as="div" className="card" key={t} style={{ marginBottom: "1rem" }}>
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
              {t === "t1" && !sample && <SiteLiveLink attemptId={state.attemptId ?? undefined} />}
              {t === "t4" && !sample && <ShareToGallery artifact={ts.artifact} />}
              {t === "t2" && calBins.some((b) => b.n > 0) && (
                <>
                  <h4 style={{ margin: "1rem 0 0", fontSize: "0.9rem" }}>Calibration — confidence vs observed accuracy</h4>
                  <CalibrationCurve bins={calBins} />
                </>
              )}
              <p className="faint small mono" style={{ marginBottom: 0 }}>
                rubric {ts.rubricVersion?.slice(0, 12)}… · scoring {ts.scoringDigest?.slice(0, 12)}… ·{" "}
                {ts.modelManifest?.screening ? `judge ${ts.modelManifest.screening}` : ts.modelManifest?.pipeline ?? ts.modelManifest?.note}
                {ts.timedOut ? " · ended on the clock" : ""}
              </p>
              {ts.judgments && ts.judgments.length > 0 && (
                <details className="small" style={{ marginTop: "0.5rem" }}>
                  <summary className="faint mono">
                    {ts.judgments.length} stored judgment rows (score() replays exactly these)
                  </summary>
                  <div style={{ overflowX: "auto" }}>
                  <table className="small mono" style={{ marginTop: "0.4rem", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", paddingRight: "1rem" }}>dimension</th>
                        <th style={{ textAlign: "right", paddingRight: "1rem" }}>sample</th>
                        <th style={{ textAlign: "right", paddingRight: "1rem" }}>value</th>
                        <th style={{ textAlign: "left" }}>model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ts.judgments.map((j, ji) => (
                        <tr key={ji}>
                          <td style={{ paddingRight: "1rem" }}>{j.dimension}</td>
                          <td style={{ textAlign: "right", paddingRight: "1rem" }}>{j.sample}</td>
                          <td style={{ textAlign: "right", paddingRight: "1rem" }}>{j.value.toFixed(3)}</td>
                          <td>{j.modelId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </details>
              )}
            </Reveal>
          );
        })}

        <h2>What the log says about you</h2>
        <div className="grid2">
          {narratives(insights).map((n) => (
            <Reveal as="div" className="card" key={n.headline}>
              <h3>{n.headline}</h3>
              <p className="muted small" style={{ marginBottom: 0 }}>{n.detail}</p>
            </Reveal>
          ))}
        </div>

        <h2>Event log</h2>
        <p className="faint small" style={{ marginTop: "-0.4rem" }}>
          Persisted runner events, shown read-only (seq · verb · object · timing).
          Scores are computed from the stored artifacts and judgment rows; these
          events are the behavioural record that accompanies them, and the research
          export carries the same per-track event counts.
        </p>
        {TRACK_IDS.map((t) => {
          const startTs = log.find((e) => e.type === "track_started" && e.trackId === t)?.ts;
          const evs = log.filter(
            (e): e is Extract<SequencedEntry, { type: "track_event" }> =>
              e.type === "track_event" && e.trackId === t,
          );
          return (
            <details className="card small" key={t} style={{ marginBottom: "0.6rem", padding: "0.7rem 1rem" }}>
              <summary className="mono faint" style={{ cursor: "pointer" }}>
                {TRACK_META[t].code} · {TRACK_META[t].name} — {evs.length} event{evs.length === 1 ? "" : "s"} logged
              </summary>
              {evs.length === 0 ? (
                <p className="faint small" style={{ margin: "0.5rem 0 0" }}>No events persisted for this track.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="small mono" style={{ marginTop: "0.5rem", borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "right", paddingRight: "1rem" }}>seq</th>
                        <th style={{ textAlign: "left", paddingRight: "1rem" }}>verb</th>
                        <th style={{ textAlign: "left", paddingRight: "1rem" }}>object</th>
                        <th style={{ textAlign: "right", paddingRight: "1rem" }}>t+ (s)</th>
                        <th style={{ textAlign: "right" }}>Δprev (s)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evs.map((e, i) => (
                        <tr key={e.seq}>
                          <td style={{ textAlign: "right", paddingRight: "1rem" }}>{e.seq}</td>
                          <td style={{ paddingRight: "1rem" }}>{e.event.verb}</td>
                          <td style={{ paddingRight: "1rem", maxWidth: "18rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.event.object}</td>
                          <td style={{ textAlign: "right", paddingRight: "1rem" }}>
                            {startTs !== undefined ? ((e.ts - startTs) / 1000).toFixed(1) : "—"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {i > 0 ? `+${((e.ts - evs[i - 1].ts) / 1000).toFixed(1)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          );
        })}

        <Reveal as="section">
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
          De-identified, item-level audit-ready rubric versions and model manifests for every score (spec §16). Each is keyed to a hashed PID, never a name.
        </p>
        </Reveal>
      </div>
    </main>
  );
}
