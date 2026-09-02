"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  append, loadAttempt, project, SCORED_TRACKS, TRACK_IDS,
  type SequencedEntry,
} from "@ailx/session";
import { TOTAL_POINTS } from "@ailx/core";
import { buildSampleAttemptLog } from "../../lib/sampleAttempt";
import { replayTrackScore, scoreTrack, trackScoredEntry } from "../../lib/registry";
import type { TrackId } from "@ailx/session";

/**
 * Recompute a track's score of record from its stored inputs and say what
 * came back. Four outcomes, and none of them is silent:
 *  - byte-identical: the claim in AGENTS.md, verified rather than asserted;
 *  - VOID: a stored judgment no longer content-addresses to its recorded id;
 *  - MISMATCH: intact evidence, and score() disagrees with the number anyway;
 *  - not replayable here: the exam service issued it and kept the evidence.
 */
function ScoreReplayLine({ trackId, stored, locale, attemptId }: {
  trackId: TrackId;
  stored: Parameters<typeof replayTrackScore>[1];
  locale: string;
  attemptId?: string;
}) {
  const r = replayTrackScore(trackId, stored, locale, attemptId);
  const label =
    r.status === "byte-identical"
      ? "✓ recomputed from the stored artifact and judgments — byte-identical"
      : r.status === "not-replayable-here"
        ? `· not replayable in this browser (${r.detail})`
        : r.status === "judgment-mutated"
          ? `✗ VOID — a stored judgment was altered (${r.detail})`
          : `✗ MISMATCH — ${r.detail}`;
  return (
    <p
      className="faint small mono"
      style={{ margin: "0.2rem 0 0", color: r.status.startsWith("byte") ? undefined : "var(--warn, #b45309)" }}
      data-testid={`replay-${trackId}`}
      data-replay-status={r.status}
    >
      {label}
    </p>
  );
}
import {
  AXES, calibrationBins, candidateComposite, componentValue, DEMO_SCORE_NOTE, formatTrackScore,
  participantExport, playerTypeFor, researchExport, shareProcessFrom, t2ResponsesFromArtifact,
  TRACK_META, trackInsights,
} from "@ailx/report";
import { CalibrationCurve } from "../../lib/CalibrationCurve";
import { CharacterPortrait, CharacterVoice } from "../../lib/CharacterPortrait";
import { CredentialPanel } from "../../lib/CredentialPanel";
import { Diagnosis } from "../../lib/Diagnosis";
import { t2AnswerKeys } from "../../lib/instrument";
import { fetchServerAnswerKeys } from "../../lib/hostedDeck";
import { loadSiteSubmission, type SiteSubmission } from "../../lib/siteUpload";
import { RelianceCard } from "../../lib/RelianceCard";
import { Reveal } from "../../lib/Reveal";
import { SiteLink } from "../../lib/SiteLink";
import { SiteExportPanel } from "../../lib/SiteExportPanel";
import { downloadBlob } from "../../lib/siteExport";
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
    <>
      <p className="small" style={{ marginTop: "0.6rem" }}>
        Live snapshot: <SiteLink url={sub.url} />{" "}
        <span className="faint">— served sandboxed; anyone with the link can view it.</span>
      </p>
      {/* The snapshot is AILX's copy; this is how the candidate gets THEIRS. */}
      {attemptId ? <SiteExportPanel attemptId={attemptId} /> : null}
    </>
  );
}

function download(filename: string, data: unknown) {
  // One save mechanism for both downloads on this page (the JSON export here
  // and the T1 site ZIP in SiteExportPanel) — see lib/siteExport.ts.
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
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

/**
 * The dots are a SYNTHETIC calibration cohort shipped with the demo, not
 * people. The page used to say so in a small pill next to a percentile-shaped
 * number, which is exactly the part that survives a screenshot; the strip now
 * carries the qualification itself, in the same words the diagnosis below
 * uses (@ailx/report `diagnosis.ts`).
 */
const COHORT_CAPTION =
  "Every dot is a synthetic demo run generated for this fixture, not a person. " +
  "Where you sit among them is not a percentile and not a rank against real " +
  "players — the judging pipeline is not built yet.";

function DistStrip({ cohort, mine }: { cohort: number[]; mine: number }) {
  return (
    <figure className="dist-figure" data-testid="dist-strip">
      <svg viewBox="0 0 400 56" className="dist-strip" role="img" aria-label={`Position among ${cohort.length} synthetic demo runs. ${COHORT_CAPTION}`}>
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
      <figcaption className="dist-caption small">
        <strong>Synthetic demo cohort — {cohort.length} generated runs.</strong> {COHORT_CAPTION}
      </figcaption>
    </figure>
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
        sampleLog = append(
          sampleLog,
          trackScoredEntry(t, rec, sampleLog[sampleLog.length - 1].ts + 1000),
        );
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
  /** The shareable process subset — the SAME narrowing a share link uses. */
  const sharedProcess = useMemo(() => shareProcessFrom(insights), [insights]);
  /**
   * REVIEW-PHASE KEYS. A hosted sitting was dealt from the operational bank,
   * which this bundle does not have — so the answer key for those items comes
   * back from the server, and only once the attempt is finalized (the review
   * phase; docs/ARCHITECTURE.md §4). Null in the static demo, whose bundled
   * released-practice keys are published on purpose.
   */
  const [serverKeys, setServerKeys] = useState<Record<string, number> | null>(null);
  const reportAttemptId = state?.attemptId;
  useEffect(() => {
    if (!reportAttemptId) return;
    let cancelled = false;
    fetchServerAnswerKeys(reportAttemptId)
      .then((keys) => {
        if (!cancelled && keys) setServerKeys(keys);
      })
      // A report that cannot reach the server still renders everything that
      // does not need a key; it must not blank the page.
      .catch((err: unknown) => console.warn("[ailx report] review keys unavailable", err));
    return () => {
      cancelled = true;
    };
  }, [reportAttemptId]);

  const calBins = useMemo(() => {
    if (!state) return [];
    // Full-bank key map for the attempt's locale: the demo deck rotates per
    // attempt, so resolve any item id the stored artifact may reference. The
    // server's review keys win where they exist — they are the keys for the
    // deck actually sat.
    return calibrationBins(
      t2ResponsesFromArtifact(state.tracks.t2.artifact),
      { ...t2AnswerKeys(state.config?.locale ?? "en"), ...(serverKeys ?? {}) },
    );
  }, [state, serverKeys]);
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

  // The copied line is the part that travels furthest with no page around it,
  // so it carries no percentile-shaped number at all: "P78.9 of 45" reads as a
  // real-world rank the moment it is pasted anywhere.
  const shareText =
    `AILX 2026.1 (demo) — composite ${summary.composite.toFixed(1)}/100, ${summary.band}, ` +
    `standardized on a synthetic demo cohort of ${summary.cohortSize} generated runs ` +
    `(no percentile, no judged result). ` +
    `Tracks ${TRACK_IDS.map((t) => `${t.toUpperCase()} ${summary.trackRaw[t].toFixed(0)}`).join(" · ")}.`;

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
              <div className="eyebrow">run {state.attemptId} · synthetic demo cohort n = {summary.cohortSize}</div>
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
              <div className="muted small">composite · standardized on the synthetic demo cohort · mean 50 · SD 15</div>
              <div className="muted small">
                raw {SCORED_TRACKS.reduce((a, t) => a + summary.trackRaw[t], 0).toFixed(1)} / {TOTAL_POINTS}
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
            quota-derived band cutlines (this synthetic cohort):{" "}
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

        {/* ONE identity: the type, then the evidence each axis was decided
            from, then the coaching. There used to be a SECOND four-letter
            identity on this page (a KCVI-style "profile" card) whose letters
            collided with these ones; its behavioural derivation and its
            per-axis evidence line moved into the player type itself, so the
            reader meets one code, one name and four measured axes.

            The strengths/watch-outs sentences stay OUT of this card: they
            live once, in <Diagnosis> below, where each carries the track
            name and the score behind it. */}
        {(() => {
          const p = playerTypeFor(state, summary.trackRaw, insights);
          return (
            <Reveal as="section" className="card ptype-card" aria-label="Player type">
              <div className="ptype-head">
                <div className="ptype-intro">
                  <CharacterPortrait code={p.code} size={104} />
                  <div>
                    <p className="kicker" style={{ margin: 0 }}>YOUR PLAYER TYPE · JUST FOR FUN</p>
                    <h2 style={{ margin: "0.2rem 0 0.1rem" }}>{p.name}</h2>
                    <p className="muted" style={{ margin: 0 }}>{p.tagline}</p>
                  </div>
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
              <CharacterVoice code={p.code} />
              <div className="eyebrow" style={{ marginTop: "1.2rem" }}>the four axes behind it · measured, never scored</div>
              <div data-testid="player-axes" style={{ display: "grid", gap: "0.9rem", marginTop: "0.4rem" }}>
                {p.poles.map((pole, i) => {
                  const axis = AXES[i]!;
                  /** Position toward the HIGH (left) pole, 0-1. */
                  const toward = pole.high ? pole.strength / 100 : 1 - pole.strength / 100;
                  return (
                    <div key={pole.track}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.8rem" }}>
                        <span className="small" style={{ color: pole.high ? "var(--fg)" : "var(--faint)" }}>
                          <span className="mono" style={{ color: "var(--accent)" }}>{axis.hi.letter}</span> {axis.hi.label}
                        </span>
                        <span className="small mono" style={{ color: "var(--accent)" }}>{pole.strength}% {pole.label}</span>
                        <span className="small" style={{ color: pole.high ? "var(--faint)" : "var(--fg)", textAlign: "right" }}>
                          {axis.lo.label} <span className="mono" style={{ color: "var(--accent)" }}>{axis.lo.letter}</span>
                        </span>
                      </div>
                      <div aria-hidden="true" style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--border)", margin: "0.35rem 0 0.2rem" }}>
                        <div style={{ position: "absolute", top: -3, left: `calc(${(1 - toward) * 100}% - 6px)`, width: 12, height: 12, borderRadius: "50%", background: "var(--accent)" }} />
                      </div>
                      <div className="faint small">{pole.evidence}</div>
                    </div>
                  );
                })}
              </div>
              <p className="faint small" style={{ margin: "0.6rem 0 0" }}>
                A playful lens on this one run, read from your own stored artifacts and event log —
                and, where the log recorded nothing, from the track&rsquo;s score against the demo
                cohort&rsquo;s median. Not a personality claim, and the letters move no points. What
                it says you are good at, and what to work on, is in <a href="#diagnosis-heading">the
                diagnosis</a> below.
              </p>
            </Reveal>
          );
        })()}

        <Diagnosis trackRaw={summary.trackRaw} process={sharedProcess} />

        {!sample && state.attemptId ? <CredentialPanel attemptId={state.attemptId} /> : null}

        {!sample && state.attemptId ? <ShareLink attemptId={state.attemptId} /> : null}

        <h2 style={{ marginTop: 0 }}>Track breakdown</h2>
        {/* Said once, in words, above the numbers it qualifies: the judging
            pipeline is not built, so these are demo estimates. */}
        <p className="muted" style={{ marginTop: "-0.4rem" }}>{DEMO_SCORE_NOTE}</p>
        {TRACK_IDS.map((t) => {
          const meta = TRACK_META[t];
          const ts = state.tracks[t];
          const score = ts.score!;
          return (
            <Reveal as="div" className="card" key={t} style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h3><span className="mono" style={{ color: "var(--accent)" }}>{meta.code}</span> · {meta.name}</h3>
                {/* One formatter, so a number never renders without saying what
                    produced it: demo-judged tracks carry the qualifier and an
                    unscored track says so in words (packages/report judging.ts). */}
                <span className="mono">{formatTrackScore(score, ts.judgments, t)}</span>
              </div>
              {meta.components.map((c) => {
                // One alias table, in @ailx/report: a raw record is a stored
                // wire surface, so a component key that was renamed in the
                // scorer must still be found in an older attempt.
                const v = componentValue(score.raw, c.key);
                return (
                  <div key={c.key} style={{ display: "grid", gridTemplateColumns: "minmax(10rem, 1fr) 2fr 6.5rem", gap: "0.8rem", alignItems: "center", margin: "0.35rem 0" }}>
                    <span className="small muted">{c.label}</span>
                    <div className="meter"><div style={{ width: `${(v / c.points) * 100}%` }} /></div>
                    <span className="small mono" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{v.toFixed(1)} / {c.points}</span>
                  </div>
                );
              })}
              {/* T3's two reliance rates, each with its interval and the
                  band, because 8 planted errors cannot support a bare
                  two-decimal rate (TEN-35). */}
              {t === "t3" && <RelianceCard raw={score.raw} />}
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
              {/* The auditor's check, run in front of the candidate: score()
                  is re-run over the STORED artifact and the STORED judgment
                  rows and compared byte for byte to the number of record. The
                  judge is not called — that is the whole point, and it is why
                  re-scoring reproduces while re-judging does not. */}
              <ScoreReplayLine trackId={t} stored={ts} locale={state.config?.locale ?? "en"}
                attemptId={sample ? undefined : state.attemptId} />
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
          De-identified, item-level, audit-ready — rubric versions and model manifests on every
          score (spec §16). Keyed to a hashed pid, never a name.
        </p>
        </Reveal>
      </div>
    </main>
  );
}
