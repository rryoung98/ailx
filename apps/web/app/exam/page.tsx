"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TrackEvent } from "@ailx/core";
import {
  append, clearAttempt, loadAttempt, nextTrack, project, saveAttempt,
  secondsRemaining, sha256Hex,
  type SequencedEntry, type SessionConfig, type TrackId,
} from "@ailx/session";
import {
  DEMO_SCORING_DIGEST, demoModelManifest, demoRubricVersion,
} from "../../lib/demo";
import { loadTrackModule, scoreTrackArtifact, type TrackModule } from "../../lib/registry";
import { trackConfig } from "../../lib/instrument";
import { TRACK_LIST, TRACK_META } from "../../lib/tracks";

function demoConfig(): SessionConfig {
  return {
    instrument: "ailx",
    version: "2026.1",
    locale: "en",
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
  const logRef = useRef<SequencedEntry[] | null>(null);
  logRef.current = log;

  // Hydrate from localStorage (client-only; static export has no SSR data).
  useEffect(() => {
    setLog(loadAttempt(window.localStorage));
    setHydrated(true);
  }, []);

  // 1 Hz clock while an attempt is live.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const state = useMemo(() => (log ? project(log) : null), [log]);

  const commit = useCallback((entries: readonly (Parameters<typeof append>[1])[]) => {
    setLog((prev) => {
      let next = prev ?? [];
      for (const e of entries) next = append(next, e);
      saveAttempt(window.localStorage, next);
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

  // Timeout watchdog: budget exhausted → auto-complete the track.
  useEffect(() => {
    if (!state || state.phase !== "in_track" || !state.currentTrack) return;
    const t = state.currentTrack;
    if (secondsRemaining(state, t, now) <= 0) {
      finishTrack(t, { demo: true, trackId: t, timedOut: true }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, state]);

  const finishTrack = useCallback((t: TrackId, artifact: unknown, timedOut: boolean) => {
    const cur = logRef.current ? project(logRef.current) : null;
    if (!cur || cur.currentTrack !== t || cur.tracks[t].status === "completed") return;
    const score = scoreTrackArtifact(t, artifact);
    const ts = Date.now();
    commit([
      { type: "track_completed", trackId: t, artifact, timedOut, ts },
      {
        type: "track_scored", trackId: t, score,
        rubricVersion: demoRubricVersion(t),
        scoringDigest: DEMO_SCORING_DIGEST,
        modelManifest: demoModelManifest(t),
        ts,
      },
    ]);
  }, [commit]);

  if (!hydrated) {
    return <main className="page"><div className="container"><p className="muted">Loading attempt…</p></div></main>;
  }

  // ---- No attempt yet -----------------------------------------------------
  if (!state) {
    const cfg = demoConfig();
    return (
      <main className="page">
        <div className="container" style={{ maxWidth: 820 }}>
          <div className="eyebrow">Demo sitting · AILX 2026.1</div>
          <h1>Sit the examination</h1>
          <p className="lede">
            One attempt, four tracks in fixed order T1 → T4, per-track time budgets,
            pause/resume, and an append-only event log persisted locally. Budgets are
            compressed for the demo; the real sitting is 4 h 20 m plus a 48-hour T1
            build window.
          </p>
          <table style={{ margin: "1.5rem 0" }}>
            <thead><tr><th>Track</th><th>Demo budget</th><th>Spec budget</th><th>Scored by</th></tr></thead>
            <tbody>
              {TRACK_LIST.map((t) => (
                <tr key={t.id}>
                  <td><span className="mono" style={{ color: "var(--accent)" }}>{t.code}</span> {t.name}</td>
                  <td className="mono">{fmt(t.demoBudgetSeconds)}</td>
                  <td className="mono">{t.id === "t1" ? "48 h" : fmt(t.specBudgetSeconds)}</td>
                  <td className="muted small">{t.id === "t2" ? "Automatic (SDT) — no model in the loop" : "Gates + demo jury (deterministic)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small faint">
            <span className="badge demo">demo</span> Scoring in this static build uses
            deterministic simulators seeded by SHA-256 of your artefacts — same inputs,
            same score, forever. No data leaves your browser.
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
        <div className="container" style={{ maxWidth: 820 }}>
          <h1>Attempt complete</h1>
          <p className="lede">All four tracks are scored. The diagnostic report is the real reward.</p>
          <p style={{ display: "flex", gap: "0.8rem" }}>
            <Link href="/report" className="btn primary">Open the diagnostic report →</Link>
            <ResetButton onReset={() => { clearAttempt(window.localStorage); setLog(null); }} />
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
              onClick={() => commit([{ type: "track_started", trackId: next, ts: Date.now() }])}
            >
              Start {TRACK_META[next].code} · {TRACK_META[next].name} ({fmt(state.config!.budgets[next])})
            </button>
          ) : (
            <button className="btn primary" onClick={() => commit([{ type: "attempt_completed", ts: Date.now() }])}>
              Finish attempt
            </button>
          )}
          <span style={{ marginLeft: "0.8rem" }}>
            <ResetButton onReset={() => { clearAttempt(window.localStorage); setLog(null); }} />
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
    config: trackConfig(t),
    onEvent: (event: TrackEvent) =>
      commit([{ type: "track_event", trackId: t, event, ts: Date.now() }]),
    onComplete: (artifact: unknown) => finishTrack(t, artifact, false),
    secondsRemaining: remaining,
  };

  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.6rem" }}>
          <div>
            <div className="eyebrow">{meta.code} · {meta.name}</div>
            <div className="faint small mono">plugin {meta.pluginId} · 100 pts</div>
          </div>
          <div style={{ display: "flex", gap: "0.9rem", alignItems: "center" }}>
            <span className={`timer${remaining <= 60 ? " low" : ""}`}>{fmt(remaining)}</span>
            {paused ? (
              <button className="btn" onClick={() => commit([{ type: "resumed", ts: Date.now() }])}>Resume</button>
            ) : (
              <button className="btn" onClick={() => commit([{ type: "paused", ts: Date.now() }])}>Pause</button>
            )}
          </div>
        </div>
        <div className="runner-frame" style={{ marginTop: "1.2rem", position: "relative" }}>
          {paused ? (
            <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
              <h3>Paused</h3>
              <p className="muted">The track clock is stopped. Content is hidden while paused.</p>
            </div>
          ) : mod ? (
            <mod.Runner {...uiProps} />
          ) : (
            <p className="muted">Loading track runner…</p>
          )}
        </div>
        <p className="faint small" style={{ marginTop: "0.8rem" }}>
          No visible score during a scored block (spec §13). Events append to the local
          log; the budget clock only runs while the track is active.
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
