"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TrackEvent } from "@ailx/core";
import {
  append, nextTrack, project,
  secondsRemaining, sha256Hex,
  type SequencedEntry, type SessionConfig, type TrackId,
} from "@ailx/session";
import { getAttemptPersistence, startServerAttempt } from "../../lib/persistence";
import { clearSiteSubmission, loadSiteSubmission, submitT1Site, type SiteUploadFailureKind } from "../../lib/siteUpload";
import {
  clearAllCheckpoints, clearCheckpoint, loadCheckpoint, saveCheckpoint,
} from "../../lib/checkpoints";
import {
  checkpointToArtifact, loadTrackModule, scoreTrack, type TrackModule,
} from "../../lib/registry";
import { trackConfig } from "../../lib/instrument";
// Locale UI removed: the demo serves the English deck; SessionConfig.locale
// stays in the frozen data contract (always "en" at attempt start).
import { TRACK_LIST, TRACK_META } from "@ailx/report";
import { Annotation } from "../../lib/Annotation";
import { ConnectPanel, CONNECTION_CHANGED_EVENT } from "../../lib/ConnectPanel";
import { LLM_BASE_URL_STORAGE, OPENROUTER_KEY_STORAGE } from "@ailx/track-t1";
import { PersistWarning } from "../../lib/PersistWarning";
import { RunnerErrorBoundary } from "../../lib/RunnerErrorBoundary";
import { PillCTA } from "../../lib/PillCTA";
import { Reveal } from "../../lib/Reveal";
import { SiteLink } from "../../lib/SiteLink";
import { eventLogCopy } from "../../lib/mode";

function demoConfig(locale: "en"): SessionConfig {
  return {
    instrument: "ailx",
    version: "2026.1",
    locale,
    budgets: {
      t1: TRACK_META.t1.demoBudgetSeconds,
      t2: TRACK_META.t2.demoBudgetSeconds,
      t3: TRACK_META.t3.demoBudgetSeconds,
      t4: TRACK_META.t4.demoBudgetSeconds,
    },
    demo: true,
  };
}

/** T1 live-site upload lifecycle (server mode only; "idle" renders nothing). */
type SiteStatus =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "live"; url: string }
  | { state: "error"; kind: SiteUploadFailureKind; message: string };

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function ExamPage() {
  const [log, setLog] = useState<SequencedEntry[] | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [mod, setMod] = useState<TrackModule | null>(null);
  const [persistWarning, setPersistWarning] = useState<string | null>(null);
  /**
   * Runner crash handling (P0-1). The clock is the candidate's, not ours:
   * a fault in OUR code pauses the track so the crash is never charged to
   * their budget, and the fault itself is recorded in the append-only log
   * so a later audit can see the paused interval was involuntary.
   * `runnerEpoch` remounts the runner (and re-reads the checkpoint) on retry.
   */
  const [runnerEpoch, setRunnerEpoch] = useState(0);
  // True while a crashed runner is showing its recovery panel: the pause veil
  // must not cover the one affordance that gets the candidate moving again.
  const [crashed, setCrashed] = useState(false);
  const crashPausedRef = useRef(false);

  // Start gate: a run needs a connected model (key or custom base URL).
  const [connected, setConnected] = useState(false);
  const [connectAttention, setConnectAttention] = useState(0);
  // T1 live-site upload (server mode). The last submission is kept for the
  // retry affordance; static mode never leaves "idle".
  const [siteStatus, setSiteStatus] = useState<SiteStatus>({ state: "idle" });
  const siteRetryRef = useRef<{ attemptId: string; artifact: unknown } | null>(null);
  const logRef = useRef<SequencedEntry[] | null>(null);
  const startingRef = useRef(false); // run-start in flight (server attempt pre-creation)
  logRef.current = log;

  // Hydrate from localStorage (client-only; static export has no SSR data).
  useEffect(() => {
    const v = getAttemptPersistence().load();
    setLog(v && v.log.length > 0 ? v.log : null);
    // A site published before a reload stays surfaced (static mode never
    // records a submission, so this cannot fire there).
    const started = v?.log[0];
    if (started?.type === "attempt_started") {
      const sub = loadSiteSubmission(window.localStorage, started.attemptId);
      if (sub) setSiteStatus({ state: "live", url: sub.url });
    }
    if (v && v.dropped > 0) {
      setPersistWarning(`stored run log had ${v.dropped} corrupt trailing entr${v.dropped === 1 ? "y" : "ies"} truncated (${v.reason ?? "unknown"})`);
    }
    setHydrated(true);
  }, []);

  // Track the model connection (key OR custom base URL) — the Start pill
  // is gated on it. Re-read on ConnectPanel changes and cross-tab storage.
  useEffect(() => {
    const read = () => {
      try {
        setConnected(
          Boolean(window.localStorage.getItem(OPENROUTER_KEY_STORAGE)?.trim()) ||
          Boolean(window.localStorage.getItem(LLM_BASE_URL_STORAGE)?.trim()),
        );
      } catch {
        setConnected(false);
      }
    };
    read();
    window.addEventListener(CONNECTION_CHANGED_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(CONNECTION_CHANGED_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  // 1 Hz clock while an attempt is live.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const state = useMemo(() => (log ? project(log) : null), [log]);

  /** Monotonic event timestamp: the machine rejects backwards clocks. */
  const stamp = useCallback((): number => {
    const cur = logRef.current;
    const last = cur && cur.length > 0 ? cur[cur.length - 1].ts : 0;
    return Math.max(Date.now(), last);
  }, []);

  const commit = useCallback((entries: readonly (Parameters<typeof append>[1])[]) => {
    setLog((prev) => {
      let next = prev ?? [];
      for (const e of entries) next = append(next, e);
      try {
        getAttemptPersistence().save(next);
        setPersistWarning(null);
      } catch (err) {
        // Multi-tab conflict or storage quota/security failure: keep the
        // in-memory log authoritative for this tab and warn loudly instead
        // of silently overwriting another tab or losing writes (audit B1/M4).
        setPersistWarning(err instanceof Error ? err.message : String(err));
      }
      return next;
    });
  }, []);

  // Load the Runner for the active track through the registry.
  const activeTrack = state?.phase === "in_track" || state?.phase === "paused" ? state.currentTrack : undefined;
  useEffect(() => {
    let cancelled = false;
    setMod(null);
    // A new track mounts a new runner: clear any crash state from the last one.
    setCrashed(false);
    crashPausedRef.current = false;
    if (activeTrack) {
      loadTrackModule(activeTrack).then((m) => { if (!cancelled) setMod(m); });
    }
    return () => { cancelled = true; };
  }, [activeTrack]);

  // Rehydration source for the active track: last stored checkpoint (F2).
  const attemptId = state?.attemptId;
  const initialCheckpoint = useMemo(() => {
    if (!attemptId || !activeTrack || typeof window === "undefined") return undefined;
    return loadCheckpoint(window.localStorage, attemptId, activeTrack);
    // Reload when the mounted track changes, or when a crashed runner is
    // remounted (runnerEpoch) — otherwise the retry would rehydrate from the
    // checkpoint as it looked at mount time and lose the crash-time work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, activeTrack, runnerEpoch]);

  /**
   * Server mode: publish the submitted T1 site and surface its live URL.
   * submitT1Site() is null in static mode / for empty artifacts — the
   * status then stays "idle" and no upload UI ever renders.
   */
  const uploadT1Site = useCallback((attemptId: string, artifact: unknown) => {
    const pending = submitT1Site(attemptId, artifact);
    if (!pending) return;
    siteRetryRef.current = { attemptId, artifact };
    setSiteStatus({ state: "uploading" });
    void pending.then((r) => {
      setSiteStatus(
        r.ok
          ? { state: "live", url: r.url }
          : { state: "error", kind: r.kind, message: r.message },
      );
    });
  }, []);

  const retrySiteUpload = useCallback(() => {
    const last = siteRetryRef.current;
    if (last) uploadT1Site(last.attemptId, last.artifact);
  }, [uploadT1Site]);

  /**
   * Complete + score a track through the REAL plugins. timedOut is DERIVED
   * from budget accounting (the machine rejects a disagreeing flag). On
   * timeout the artifact is rebuilt from the last checkpoint — a partial
   * response scores by each track's missing-response rules, never a
   * sentinel (F1).
   */
  const finishTrack = useCallback((t: TrackId, artifact: unknown) => {
    const cur = logRef.current ? project(logRef.current) : null;
    if (!cur || cur.currentTrack !== t || cur.tracks[t].status === "completed") return;
    const ts = stamp();
    const timedOut = secondsRemaining(cur, t, ts) <= 0;
    const rec = scoreTrack(t, artifact, cur.config?.locale ?? "en", cur.attemptId ?? undefined);
    commit([
      { type: "track_completed", trackId: t, artifact, timedOut, ts },
      {
        type: "track_scored", trackId: t, score: rec.score,
        judgments: rec.judgments,
        rubricVersion: rec.rubricVersion,
        scoringDigest: rec.scoringDigest,
        modelManifest: rec.modelManifest,
        ts,
      },
    ]);
    if (cur.attemptId) clearCheckpoint(window.localStorage, cur.attemptId, t);
    // T1's artifact is a servable site: publish it (server mode; no-op otherwise).
    if (t === "t1" && cur.attemptId) uploadT1Site(cur.attemptId, artifact);
  }, [commit, stamp, uploadT1Site]);

  // Timeout watchdog: budget exhausted → score the last checkpoint (F1/F2).
  useEffect(() => {
    if (!state || !state.currentTrack) return;
    if (state.phase !== "in_track" && state.phase !== "paused") return;
    const t = state.currentTrack;
    if (secondsRemaining(state, t, now) <= 0) {
      const cp = state.attemptId
        ? loadCheckpoint(window.localStorage, state.attemptId, t)
        : undefined;
      finishTrack(t, checkpointToArtifact(t, cp));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, state]);

  /**
   * Append only the entries the machine will accept, dropping the rest.
   * Crash recovery must never itself throw: an exhausted budget legitimately
   * refuses further track events, and that must not re-break the page.
   */
  const commitIfLegal = useCallback((entries: readonly (Parameters<typeof append>[1])[]) => {
    let probe = logRef.current ?? [];
    const accepted: (Parameters<typeof append>[1])[] = [];
    for (const e of entries) {
      try {
        probe = append(probe, e);
        accepted.push(e);
      } catch {
        // Illegal for the current phase — drop it, keep the log consistent.
      }
    }
    if (accepted.length > 0) commit(accepted);
  }, [commit]);

  const handleRunnerCrash = useCallback((error: Error) => {
    const cur = logRef.current ? project(logRef.current) : null;
    if (!cur || !cur.currentTrack) return;
    const t = cur.currentTrack;
    const ts = stamp();
    if (cur.phase === "in_track") crashPausedRef.current = true;
    commitIfLegal([
      // Audit trail: the involuntary pause has a recorded cause.
      {
        type: "track_event", trackId: t, ts,
        event: {
          verb: "runner_crashed",
          object: `track:${t}`,
          result: { message: error.message },
          context: { track: t, recovery: "checkpoint" },
          clientTs: new Date().toISOString(),
        },
      },
      // Stop the clock: our fault is not charged to the candidate.
      { type: "paused", ts },
    ]);
    setCrashed(true);
  }, [commitIfLegal, stamp]);

  const retryRunner = useCallback(() => {
    const cur = logRef.current ? project(logRef.current) : null;
    // Only auto-resume a pause WE forced; a candidate-initiated pause stands.
    if (crashPausedRef.current && cur?.phase === "paused") {
      crashPausedRef.current = false;
      commitIfLegal([{ type: "resumed", ts: stamp() }]);
    }
    setCrashed(false);
    setRunnerEpoch((e) => e + 1);
  }, [commitIfLegal, stamp]);

  const resetAttempt = useCallback(() => {
    const cur = logRef.current ? project(logRef.current) : null;
    if (cur?.attemptId) {
      clearAllCheckpoints(window.localStorage, cur.attemptId);
      clearSiteSubmission(window.localStorage, cur.attemptId);
    }
    getAttemptPersistence().clear();
    siteRetryRef.current = null;
    setSiteStatus({ state: "idle" });
    setLog(null);
  }, []);

  if (!hydrated) {
    return <main className="page">
      <PersistWarning warning={persistWarning} />
      <div className="container"><p className="muted">Loading your run…</p></div></main>;
  }

  // ---- No attempt yet -----------------------------------------------------
  if (!state) {
    const cfg = demoConfig("en");
    return (
      <main className="page">
      <PersistWarning warning={persistWarning} />
        <div className="container" style={{ maxWidth: 820, paddingBottom: "5.5rem" }}>
          <div className="eyebrow">Demo run · AILX 2026.1</div>
          <h1>Four tracks. One <span className="script-accent">run</span>.</h1>
          <p className="lede">
            T1 to T4 in sequence, each on its own clock. You can pause between
            moves, never mid-swipe. {eventLogCopy()}
          </p>
          <div style={{ textAlign: "right" }}><Annotation side="left">no accounts — just play</Annotation></div>
          {/* AI connection FIRST — users must see it before the Start pill
              (it was previously buried below the fold). */}
          <ConnectPanel attention={connectAttention} />
          <ul className="rule-rows" style={{ margin: "1rem 0 1.5rem" }}>
            {TRACK_LIST.map((t) => (
              <Reveal as="li" key={t.id}>
                <span className="row-title"><span className="mono" style={{ color: "var(--accent)", fontSize: "0.8em", marginRight: "0.6rem" }}>{t.code}</span>{t.name}</span>
                <span className="row-detail muted small">{TRACK_META[t.id as keyof typeof TRACK_META].hype}</span>
                <span className="faint small mono">{fmt(t.demoBudgetSeconds)}</span>
              </Reveal>
            ))}
          </ul>
          <Reveal as="section">
          <p className="small faint">
            <span className="badge demo">demo</span> Deterministic scoring: the real track plugins score your stored artifact and judgments. The same play will always result in the same score.
          </p>
          </Reveal>
          <PillCTA
            disabled={!connected}
            onClick={async () => {
              if (!connected) {
                // Redirect attention to the connect panel instead of starting.
                setConnectAttention((a) => a + 1);
                return;
              }
              if (startingRef.current) return; // ignore double-clicks mid-await
              startingRef.current = true;
              try {
                // Server mode: adopt the pre-created SERVER attempt id so the
                // per-attempt T2 deck is keyed to (and recorded against) it.
                // Static mode / backend unreachable: local id, same derivation.
                const serverId = await startServerAttempt(cfg.locale);
                const ts = Date.now();
                const attemptId =
                  serverId ?? `att-${sha256Hex(`${ts}:${Math.random()}`).slice(0, 12)}`;
                commit([{ type: "attempt_started", attemptId, config: cfg, ts }]);
              } finally {
                startingRef.current = false;
              }
            }}
          >
            {connected ? "Start your run" : "Connect a model to start"}
          </PillCTA>
        </div>
      </main>
    );
  }

  // ---- Completed ----------------------------------------------------------
  if (state.phase === "completed") {
    return (
      <main className="page">
      <PersistWarning warning={persistWarning} />
        <div className="container" style={{ maxWidth: 820 }}>
          <h1>Run complete</h1>
          <p className="lede">All four tracks are scored. The diagnostic report is the real reward.</p>
          <SiteUploadNotice status={siteStatus} onRetry={retrySiteUpload} />
          <p style={{ display: "flex", gap: "0.8rem" }}>
            <Link href="/report" className="btn primary">Open the diagnostic report →</Link>
            <ResetButton onReset={resetAttempt} />
          </p>
        </div>
      </main>
    );
  }

  // ---- Between tracks -----------------------------------------------------
  if (state.phase === "between_tracks") {
    const next = nextTrack(state);
    const done = state.order.filter((t) => state.tracks[t].status === "completed");
    return (
      <main className="page">
      <PersistWarning warning={persistWarning} />
        <div className="container" style={{ maxWidth: 820 }}>
          <div className="eyebrow">run {state.attemptId}</div>
          <h1>{done.length === 0 ? "Ready" : `${done.length} of 4 tracks complete`}</h1>
          <ul className="checklist" style={{ margin: "1.5rem 0" }}>
            {TRACK_LIST.map((t) => {
              const ts = state.tracks[t.id];
              return (
                <li key={t.id}>
                  <span className="mono" style={{ color: "var(--accent)", minWidth: "2rem" }}>{t.code}</span>
                  <span style={{ flex: 1 }}>{t.name}</span>
                  {ts.status === "completed" ? (
                    <span className="small mono" style={{ color: "var(--good)" }}>
                      ✓ {ts.score ? `${ts.score.scaled.toFixed(1)} / 100` : "scored"}
                    </span>
                  ) : t.id === next ? (
                    <span className="small mono" style={{ color: "var(--warn)" }}>next</span>
                  ) : (
                    <span className="small faint mono">pending</span>
                  )}
                </li>
              );
            })}
          </ul>
          <SiteUploadNotice status={siteStatus} onRetry={retrySiteUpload} />
          {next ? (
            <>
              <p className="muted" style={{ margin: "0 0 0.8rem" }}>{TRACK_META[next].hype}</p>
              <button
                className="btn primary"
                onClick={() => commit([{ type: "track_started", trackId: next, ts: stamp() }])}
              >
                Start {TRACK_META[next].code} · {TRACK_META[next].name} ({fmt(state.config!.budgets[next])})
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => commit([{ type: "attempt_completed", ts: stamp() }])}>
              Finish run
            </button>
          )}
          <span style={{ marginLeft: "0.8rem" }}>
            <ResetButton onReset={resetAttempt} />
          </span>
        </div>
      </main>
    );
  }

  // ---- In track / paused --------------------------------------------------
  const t = state.currentTrack!;
  const meta = TRACK_META[t];
  const remaining = secondsRemaining(state, t, now);
  const paused = state.phase === "paused";

  const uiProps = {
    attemptId: state.attemptId!,
    locale: state.config!.locale,
    config: trackConfig(t, state.config!.locale, state.attemptId ?? undefined),
    onEvent: (event: TrackEvent) => {
      const cur = logRef.current ? project(logRef.current) : null;
      // Accept while in_track AND paused: runners stay mounted under the
      // pause veil, so runner-internal timers can emit mid-pause. Dropping
      // those would silently desync the event log from the artifact.
      // Only budget-exhausted (late) events are rejected — the machine
      // enforces the same rule at append time.
      if (!cur || (cur.phase !== "in_track" && cur.phase !== "paused") || cur.currentTrack !== t) return;
      const ts = stamp();
      if (secondsRemaining(cur, t, ts) <= 0) return;
      commit([{ type: "track_event", trackId: t, event, ts }]);
    },
    onComplete: (artifact: unknown) => finishTrack(t, artifact),
    secondsRemaining: remaining,
    // F2: the runner rehydrates from the last checkpoint and persists every
    // meaningful mutation back through onCheckpoint.
    checkpoint: initialCheckpoint,
    onCheckpoint: (cp: unknown) => {
      if (state.attemptId) saveCheckpoint(window.localStorage, state.attemptId, t, cp);
    },
  };

  const budget = state.config!.budgets[t];
  const timeFrac = budget > 0 ? remaining / budget : 0;

  return (
    <main className="page">
      <PersistWarning warning={persistWarning} />
      {/* Full-width workspace while a track is live: the runners are
          two-pane environments and need the room (~1400px). */}
      <div className="container" style={{ maxWidth: 1400 }}>
        <div className="track-progress">
          {state.order.map((tid) => (
            <div key={tid} className={`seg${state.tracks[tid].status === "completed" ? " done" : tid === t ? " now" : ""}`} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.6rem" }}>
          <div>
            <h1 className="eyebrow" style={{ margin: 0 }}>{meta.code} · {meta.name}</h1>
            <div className="faint small mono">plugin {meta.pluginId} · 100 pts</div>
          </div>
          <div style={{ display: "flex", gap: "0.9rem", alignItems: "center" }}>
            {/* Screen-reader timer warning: announced once when the track
                clock crosses the final minute (no per-second chatter). */}
            <span className="sr-only" role="status">
              {remaining <= 60 && remaining > 0 ? "Less than one minute remaining on the track clock." : ""}
            </span>
            <span className={`timer${remaining <= 60 ? " low" : ""}`} role="timer" aria-label={`Time remaining ${fmt(remaining)}`}>{fmt(remaining)}</span>
            {paused ? (
              <button className="btn" onClick={() => commit([{ type: "resumed", ts: stamp() }])}>Resume</button>
            ) : (
              <button className="btn" onClick={() => commit([{ type: "paused", ts: stamp() }])}>Pause</button>
            )}
          </div>
        </div>
        <div className="runner-frame" style={{ marginTop: "1.2rem", position: "relative" }}>
          {/* F2: the Runner stays MOUNTED while paused — a veil covers it so
              content is hidden but in-progress state survives. */}
          {mod ? (
            <div aria-hidden={paused && !crashed} style={paused && !crashed ? { visibility: "hidden" } : undefined}>
              {/* P0-1: a runner throw must never white-screen a timed run.
                  The boundary is keyed by runnerEpoch so "retry" remounts a
                  clean runner from the last stored checkpoint. */}
              <RunnerErrorBoundary
                key={runnerEpoch}
                context={{ attemptId: state.attemptId, track: t, phase: state.phase, secondsRemaining: remaining, runnerEpoch }}
                onError={handleRunnerCrash}
                onRetry={retryRunner}
              >
                <mod.Runner {...uiProps} />
              </RunnerErrorBoundary>
            </div>
          ) : (
            <p className="muted">Loading track runner…</p>
          )}
          {paused && !crashed && (
            <div
              role="dialog" aria-label="Paused"
              style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                background: "var(--bg, #0b0d10)", zIndex: 5, textAlign: "center", padding: "3rem 1rem",
              }}
            >
              <h3>Paused</h3>
              <p className="muted">The track clock is stopped. Content is hidden while paused; your work is kept.</p>
            </div>
          )}
        </div>
        <div className={`time-bar${remaining <= 60 ? " low" : ""}`}>
          <div style={{ width: `${Math.max(0, Math.min(1, timeFrac)) * 100}%` }} />
        </div>
        <p className="faint small" style={{ marginTop: "0.8rem" }}>
          No visible score mid-block (spec §13) — reveals come between rounds.
        </p>
      </div>
    </main>
  );
}

/**
 * T1 live-site status card (server mode only — "idle" renders nothing, so
 * the static showcase is untouched). One-submission and validation errors
 * are terminal explanations; only reachability errors offer a retry (the
 * same bytes would fail validation the same way again).
 */
function SiteUploadNotice({ status, onRetry }: { status: SiteStatus; onRetry: () => void }) {
  if (status.state === "idle") return null;
  return (
    <div
      role="status"
      className="card"
      style={{ margin: "1rem 0", padding: "0.7rem 1rem", fontSize: "0.9rem" }}
    >
      <span className="mono" style={{ color: "var(--accent)", marginRight: "0.6rem" }}>T1</span>
      {status.state === "uploading" ? (
        <span className="muted">Publishing your site snapshot…</span>
      ) : status.state === "live" ? (
        <>
          Your site is live: <SiteLink url={status.url} />
          <span className="faint small" style={{ display: "block", marginTop: "0.2rem" }}>
            Served sandboxed; anyone with the link can view it.
          </span>
        </>
      ) : status.kind === "conflict" ? (
        <span className="muted">
          This run already has a different site submission on record — one site
          submission per run, and the first one stands. {status.message}
        </span>
      ) : status.kind === "rejected" ? (
        <span className="muted">
          The site snapshot was rejected by the server ({status.message}). Your
          work is saved locally and scored as normal.
        </span>
      ) : (
        <>
          <span className="muted">Could not publish the site snapshot: {status.message}</span>{" "}
          <button className="btn small-btn" style={{ marginLeft: "0.4rem" }} onClick={onRetry}>
            Retry upload
          </button>
        </>
      )}
    </div>
  );
}

function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button
      className="btn danger"
      onClick={() => {
        if (window.confirm("Discard this run and its event log?")) onReset();
      }}
    >
      Restart run
    </button>
  );
}
