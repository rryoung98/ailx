"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TrackEvent } from "@ailx/core";
import {
  append, clearAttempt, loadAttemptValidated, nextTrack, project, saveAttempt,
  secondsRemaining, sha256Hex,
  type SequencedEntry, type SessionConfig, type TrackId,
} from "@ailx/session";
import {
  clearAllCheckpoints, clearCheckpoint, loadCheckpoint, saveCheckpoint,
} from "../../lib/checkpoints";
import {
  checkpointToArtifact, loadTrackModule, scoreTrack, type TrackModule,
} from "../../lib/registry";
import { trackConfig } from "../../lib/instrument";
import { LOCALE_SCOPE_NOTE, useLocale, type Locale } from "../../lib/locale";
import { TRACK_LIST, TRACK_META } from "../../lib/tracks";

function demoConfig(locale: Locale): SessionConfig {
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
  // Persisted content locale ('ailx:locale', header switcher). Snapshotted
  // into SessionConfig at attempt start — mid-attempt switches never change
  // a live sitting's deck.
  const chosenLocale = useLocale();
  const logRef = useRef<SequencedEntry[] | null>(null);
  logRef.current = log;

  // Hydrate from localStorage (client-only; static export has no SSR data).
  useEffect(() => {
    const v = loadAttemptValidated(window.localStorage);
    setLog(v && v.log.length > 0 ? v.log : null);
    if (v && v.dropped > 0) {
      setPersistWarning(`stored attempt log had ${v.dropped} corrupt trailing entr${v.dropped === 1 ? "y" : "ies"} truncated (${v.reason ?? "unknown"})`);
    }
    setHydrated(true);
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
        saveAttempt(window.localStorage, next);
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
    // Reload only when the mounted track changes — the runner owns live state.
  }, [attemptId, activeTrack]);

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
    const rec = scoreTrack(t, artifact, cur.config?.locale ?? "en");
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
  }, [commit, stamp]);

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

  const resetAttempt = useCallback(() => {
    const cur = logRef.current ? project(logRef.current) : null;
    if (cur?.attemptId) clearAllCheckpoints(window.localStorage, cur.attemptId);
    clearAttempt(window.localStorage);
    setLog(null);
  }, []);

  if (!hydrated) {
    return <main className="page">
      {persistWarning ? (
        <div role="alert" style={{ background: "#3a1f1f", border: "1px solid #7a3b3b", color: "#ffd9d9", padding: "0.6rem 0.9rem", borderRadius: 8, margin: "0.6rem auto", maxWidth: 980, fontSize: "0.85rem" }}>
          ⚠ Persistence warning: {persistWarning}
        </div>
      ) : null}
      <div className="container"><p className="muted">Loading attempt…</p></div></main>;
  }

  // ---- No attempt yet -----------------------------------------------------
  if (!state) {
    const cfg = demoConfig(chosenLocale);
    return (
      <main className="page">
      {persistWarning ? (
        <div role="alert" style={{ background: "#3a1f1f", border: "1px solid #7a3b3b", color: "#ffd9d9", padding: "0.6rem 0.9rem", borderRadius: 8, margin: "0.6rem auto", maxWidth: 980, fontSize: "0.85rem" }}>
          ⚠ Persistence warning: {persistWarning}
        </div>
      ) : null}
      
        <div className="container" style={{ maxWidth: 820 }}>
          <div className="eyebrow">Demo sitting · AILX 2026.1</div>
          <h1>Four tracks. One attempt.</h1>
          <p className="lede">
            T1 to T4 in sequence, each on its own clock. Pause between each move, never interrupting a swipe. The event log remains in this browser.
          </p>
          <ul className="checklist" style={{ margin: "1.5rem 0" }}>
            {TRACK_LIST.map((t) => (
              <li key={t.id}>
                <span className="mono" style={{ color: "var(--accent)", minWidth: "2rem" }}>{t.code}</span>
                <span style={{ flex: 1 }}>{t.name}</span>
                <span className="faint small mono">{fmt(t.demoBudgetSeconds)}</span>
              </li>
            ))}
          </ul>
          <p className="small faint">
            <span className="badge demo">demo</span> Deterministic scoring: the real track plugins score your stored artifact and judgments. The same play will always result in the same score.
          </p>
          <p className="small faint">
            Content locale: <span className="mono">{chosenLocale}</span> (header switcher). {LOCALE_SCOPE_NOTE}{chosenLocale !== "en" ? " ja/ko item content is machine-translated and marked unreviewed in item provenance." : ""}
          </p>
          <button
            className="btn primary"
            onClick={() => {
              const ts = Date.now();
              const attemptId = `att-${sha256Hex(`${ts}:${Math.random()}`).slice(0, 12)}`;
              commit([{ type: "attempt_started", attemptId, config: cfg, ts }]);
            }}
          >
            Begin attempt
          </button>
        </div>
      </main>
    );
  }

  // ---- Completed ----------------------------------------------------------
  if (state.phase === "completed") {
    return (
      <main className="page">
      {persistWarning ? (
        <div role="alert" style={{ background: "#3a1f1f", border: "1px solid #7a3b3b", color: "#ffd9d9", padding: "0.6rem 0.9rem", borderRadius: 8, margin: "0.6rem auto", maxWidth: 980, fontSize: "0.85rem" }}>
          ⚠ Persistence warning: {persistWarning}
        </div>
      ) : null}
      
        <div className="container" style={{ maxWidth: 820 }}>
          <h1>Attempt complete</h1>
          <p className="lede">All four tracks are scored. The diagnostic report is the real reward.</p>
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
      {persistWarning ? (
        <div role="alert" style={{ background: "#3a1f1f", border: "1px solid #7a3b3b", color: "#ffd9d9", padding: "0.6rem 0.9rem", borderRadius: 8, margin: "0.6rem auto", maxWidth: 980, fontSize: "0.85rem" }}>
          ⚠ Persistence warning: {persistWarning}
        </div>
      ) : null}
      
        <div className="container" style={{ maxWidth: 820 }}>
          <div className="eyebrow">Attempt {state.attemptId}</div>
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
          {next ? (
            <button
              className="btn primary"
              onClick={() => commit([{ type: "track_started", trackId: next, ts: stamp() }])}
            >
              Start {TRACK_META[next].code} · {TRACK_META[next].name} ({fmt(state.config!.budgets[next])})
            </button>
          ) : (
            <button className="btn primary" onClick={() => commit([{ type: "attempt_completed", ts: stamp() }])}>
              Finish attempt
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
    config: trackConfig(t, state.config!.locale),
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
      {persistWarning ? (
        <div role="alert" style={{ background: "#3a1f1f", border: "1px solid #7a3b3b", color: "#ffd9d9", padding: "0.6rem 0.9rem", borderRadius: 8, margin: "0.6rem auto", maxWidth: 980, fontSize: "0.85rem" }}>
          ⚠ Persistence warning: {persistWarning}
        </div>
      ) : null}
      
      <div className="container" style={{ maxWidth: 820 }}>
        <div className="track-progress">
          {state.order.map((tid) => (
            <div key={tid} className={`seg${state.tracks[tid].status === "completed" ? " done" : tid === t ? " now" : ""}`} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.6rem" }}>
          <div>
            <div className="eyebrow">{meta.code} · {meta.name}</div>
            <div className="faint small mono">plugin {meta.pluginId} · 100 pts</div>
          </div>
          <div style={{ display: "flex", gap: "0.9rem", alignItems: "center" }}>
            <span className={`timer${remaining <= 60 ? " low" : ""}`}>{fmt(remaining)}</span>
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
            <div aria-hidden={paused} style={paused ? { visibility: "hidden" } : undefined}>
              <mod.Runner {...uiProps} />
            </div>
          ) : (
            <p className="muted">Loading track runner…</p>
          )}
          {paused && (
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

function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button
      className="btn danger"
      onClick={() => {
        if (window.confirm("Discard this attempt and its event log?")) onReset();
      }}
    >
      Reset attempt
    </button>
  );
}
