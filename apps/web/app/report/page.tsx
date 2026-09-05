"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  append, loadAttempt, project, TRACK_IDS,
  type SequencedEntry,
} from "@ailx/session";
import { buildSampleAttemptLog } from "../../lib/instrument/sampleAttempt";
import { replayTrackScore, scoreTrack, trackScoredEntry } from "../../lib/instrument/registry";
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
import { CalibrationCurve } from "../../features/report/CalibrationCurve";
import { CharacterPortrait, CharacterVoice } from "../../components/CharacterPortrait";
import { CredentialPanel } from "../../features/report/CredentialPanel";
import { Diagnosis } from "../../features/report/Diagnosis";
import { t2AnswerKeys } from "../../lib/instrument/instrument";
import { fetchServerReview, type ServerReview } from "../../lib/instrument/hostedDeck";
import { loadSiteSubmission, type SiteSubmission } from "../../lib/data/siteUpload";
import { RelianceCard } from "../../features/report/RelianceCard";
import { Reveal } from "../../components/ui/Reveal";
import { SiteLink } from "../../components/ui/SiteLink";
import { SiteExportPanel } from "../../features/report/SiteExportPanel";
import { WithheldItems } from "../../features/report/WithheldItems";
import { downloadBlob } from "../../features/report/siteExport";
import { ShareLink } from "../../features/report/ShareLink";
import { ScoresOfRecordView } from "../../features/report/ScoresOfRecordPanel";
import { CompositeCard } from "../../features/report/CompositeCard";
import { localCompositeView, serviceCompositeView } from "../../features/report/compositeView";
import { HostedComposite } from "../../features/report/HostedComposite";
import { useScoresOfRecord } from "../../features/report/useScoresOfRecord";
import { reportGate } from "../../features/report/reportGate";

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
  // and the T1 site ZIP in SiteExportPanel) — see features/report/siteExport.ts.
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
}

export default function ReportPage() {
  const [log, setLog] = useState<SequencedEntry[] | null>(null);
  const [hydrated, setHydrated] = useState(false);
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
  }, []);

  const state = useMemo(() => (log ? project(log) : null), [log]);
  const summary = useMemo(() => (state ? candidateComposite(state) : null), [state]);
  const insights = useMemo(() => (state ? trackInsights(state) : []), [state]);
  /** The shareable process subset — the SAME narrowing a share link uses. */
  const sharedProcess = useMemo(() => shareProcessFrom(insights), [insights]);
  /**
   * THE REVIEW VIEW OF THE DEALT DECK. A hosted sitting was dealt from the
   * operational bank, which this bundle does not have — so the answer key for
   * those items comes back from the server, and only once the attempt is
   * finalized (the review phase; docs/ARCHITECTURE.md §4). Null in the static
   * demo, whose bundled released-practice keys are published on purpose.
   *
   * It also carries the items the bank no longer serves, and how many were
   * dealt in the first place, so a deck that lost an item still reports the
   * length it was sat at (TEN-68).
   */
  const [review, setReview] = useState<ServerReview | null>(null);
  const reportAttemptId = state?.attemptId;
  /**
   * THE ONE READ OF THE SERVICE'S SCORES. The gate below and the panel at the
   * bottom of this page must agree about what the exam service has issued, so
   * they read it once, here (TEN-128). The bundled sample is nobody's sitting,
   * so it asks the service nothing.
   */
  const scoresView = useScoresOfRecord(sample ? null : (reportAttemptId ?? null));
  useEffect(() => {
    if (!reportAttemptId) return;
    let cancelled = false;
    fetchServerReview(reportAttemptId)
      .then((r) => {
        if (!cancelled && r) setReview(r);
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
      { ...t2AnswerKeys(state.config?.locale ?? "en"), ...(review?.keys ?? {}) },
    );
  }, [state, review]);

  if (!hydrated) {
    return <main className="page"><div className="container"><p className="muted">Loading…</p></div></main>;
  }

  if (!state || !log || !summary) {
    /* The gate counts a score of record wherever it was issued — this
       browser's log, and the service's `scores` (TEN-128). It used to count
       the log alone, so a finalized hosted sitting was told for ever to
       "finish the run", with a Continue that led back to /exam and from
       there back to here. */
    const gate = reportGate({
      localScored: state ? TRACK_IDS.filter((t) => state.tracks[t].score !== undefined) : [],
      scores: scoresView.scores ?? null,
      reading: scoresView.reading,
    });
    return (
      <main className="page">
        <div className="container" style={{ maxWidth: 820 }}>
          <h1>{state ? gate.headline : "The report is the reward"}</h1>
          <p className="lede">{state ? gate.lede : "No run in this browser yet."}</p>
          <p style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
            {!state || gate.cta !== null ? (
              <Link className="btn primary" href={state ? gate.cta!.href : "/exam"}>
                {state ? gate.cta!.label : "Play →"}
              </Link>
            ) : null}
            {!state ? (
              <button type="button" className="btn" onClick={() => setSample(true)}>
                Peek at a sample report
              </button>
            ) : null}
          </p>
          {/* A hosted run whose T3 is still with the jury lands HERE, not on
              the full report: the composite needs four local scores and the
              judged one is the service's. So the panel that says what the
              service holds must be on this screen too, or the candidate is
              told to "finish the run" they already finished (TEN-69).

              The composite for such a sitting is the SERVICE's too, and it
              goes above the track scores because it is what the candidate
              came for (TEN-92). It is the same card the local report draws,
              marked as the service's and claiming no local replay. */}
          {state?.attemptId ? (
            <HostedComposite attemptId={state.attemptId} scores={scoresView.scores} />
          ) : null}
          {state?.attemptId ? <ScoresOfRecordView view={scoresView} /> : null}
        </div>
      </main>
    );
  }

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
        <CompositeCard view={localCompositeView(state.attemptId, summary)} />

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
                <div className="ptype-code" role="img" aria-label={`Type code ${p.code}`}>
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
                A playful lens on this one run, read from your stored artifacts and event log.
                Where the log recorded nothing, it reads the track&rsquo;s score against the demo
                cohort&rsquo;s median. Not a personality claim, and the letters move no points.
                Strengths and next steps are in <a href="#diagnosis-heading">the diagnosis</a> below.
              </p>
            </Reveal>
          );
        })()}

        <Diagnosis trackRaw={summary.trackRaw} process={sharedProcess} />

        {!sample && state.attemptId ? <CredentialPanel attemptId={state.attemptId} /> : null}

        {!sample && state.attemptId ? <ShareLink attemptId={state.attemptId} /> : null}

        {/* The exam service's OWN numbers, including a T3 score the judging
            pass issues after finalize has answered (TEN-69). Separate from
            the breakdown below, which is this browser's log: a hosted score
            of record is not something this page recomputed. */}
        {!sample && state.attemptId ? <ScoresOfRecordView view={scoresView} /> : null}

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
                  band, because a form's handful of planted errors cannot
                  support a bare two-decimal rate (TEN-35). The 2026.1 forms
                  plant four, under the eight-plant floor, so the card also
                  carries the underpowered note (TEN-91). */}
              {t === "t3" && <RelianceCard raw={score.raw} />}
              {t === "t1" && !sample && <SiteLiveLink attemptId={state.attemptId ?? undefined} />}
              {t === "t4" && !sample && <ShareToGallery artifact={ts.artifact} />}
              {t === "t2" && calBins.some((b) => b.n > 0) && (
                <>
                  <h4 style={{ margin: "1rem 0 0", fontSize: "0.9rem" }}>Calibration — confidence vs observed accuracy</h4>
                  <CalibrationCurve bins={calBins} />
                </>
              )}
              {/* An item the bank lost after the sitting is still an item the
                  candidate sat, and the count says so (TEN-68). */}
              {t === "t2" && review ? (
                <WithheldItems dealt={review.dealt} withheld={review.withheld} />
              ) : null}
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
          Your runner events, read-only (seq · verb · object · timing). They record what
          you did. Your score comes from the stored artifacts and judgment rows, not from
          these.
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
