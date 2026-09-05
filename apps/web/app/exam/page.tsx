"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TrackEvent } from "@ailx/core";
import {
  append, nextTrack, project,
  secondsRemaining, sha256Hex,
  type SequencedEntry, type SessionConfig, type TrackId,
} from "@ailx/session";
import {
  DeckMismatchError, getAttemptPersistence, startServerAttempt,
} from "../../lib/data/persistence";
import { fetchHostedTrackConfig } from "../../lib/instrument/hostedDeck";
import { clearSiteSubmission, loadSiteSubmission, submitT1Site, type SiteUploadFailureKind } from "../../lib/data/siteUpload";
import {
  clearAllCheckpoints, clearCheckpoint, loadCheckpoint, saveCheckpoint,
} from "../../lib/data/checkpoints";
import {
  checkpointToArtifact, loadTrackModule, scoreTrack,
  trackScoredEntry, type TrackModule,
} from "../../lib/instrument/registry";
import { t3FormBudgetSeconds, trackConfig } from "../../lib/instrument/instrument";
// Locale UI removed: the demo serves the English deck; SessionConfig.locale
// stays in the frozen data contract (always "en" at attempt start).
import { DEMO_SCORE_NOTE, formatTrackScore, isDemoScored, TRACK_LIST, TRACK_META } from "@ailx/report";
import { Annotation } from "../../components/ui/Annotation";
import { ConnectPanel, CONNECTION_CHANGED_EVENT } from "../../features/exam/ConnectPanel";
import { modelGatewayFetch } from "../../lib/data/modelGateway";
import { hasModelEndpoint, LLM_BASE_URL_STORAGE } from "@ailx/track-t1";
import { PersistWarning } from "../../features/exam/PersistWarning";
import { RunnerErrorBoundary } from "../../features/exam/RunnerErrorBoundary";
import { PillCTA } from "../../components/ui/PillCTA";
import { Reveal } from "../../components/ui/Reveal";
import { SiteLink } from "../../components/ui/SiteLink";
import { eventLogCopy, examAccessCopy } from "../../lib/mode";
import { funnel } from "../../lib/data/funnel";
import { completionSummary, SERVICE_SCORES_THIS_TRACK } from "../../lib/instrument/scoreSources";

function demoConfig(locale: "en"): SessionConfig {
  return {
    instrument: "ailx",
    version: "2026.1",
    locale,
    budgets: {
      t1: TRACK_META.t1.demoBudgetSeconds,
      t2: TRACK_META.t2.demoBudgetSeconds,
      // TEN-30: the T3 form may declare its own time condition (90 or 30
      // minutes). It declares none in the static demo, so this is the demo
      // budget as before.
      t3: t3FormBudgetSeconds() ?? TRACK_META.t3.demoBudgetSeconds,
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

/**
 * How long a hosted content fetch may hang before it becomes a visible
 * failure with a retry. The clock is held while it runs (see the content
 * hold below), so this costs the candidate nothing — it exists so a dead
 * socket ends in an answer instead of an empty screen (TEN-116).
 */
const CONTENT_FETCH_TIMEOUT_MS = 20_000;

/** How long content may take to appear before the clock is held for it. */
const CONTENT_HOLD_GRACE_MS = 1_000;

/** Reject with a plain Error when `p` has not settled in `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(
      () => reject(new Error(`the exam service did not answer in ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => { window.clearTimeout(id); resolve(v); },
      (err: unknown) => { window.clearTimeout(id); reject(err); },
    );
  });
}

/**
 * What a candidate is told when the exam service will not open their run
 * (TEN-114): the failure, that nothing was recorded, the one next action,
 * and why the practice deck in this browser is not offered as a stand-in.
 *
 * The last clause stays however short this gets. It is the disclosure that
 * stops a published-key deck being mistaken for a sitting, and
 * test/examStartFailure.test.tsx pins it.
 */
function startFailureCopy(err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  return (
    `the exam service could not open it (${reason}). Nothing was recorded and ` +
    "no clock is running. Press Start your run to try again. The practice deck " +
    "in this browser never stands in for a sitting: its answers are published."
  );
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
  /** Track whose time-up notice has been acknowledged (see TimeUpNotice). */
  const [timeUpAck, setTimeUpAck] = useState<TrackId | null>(null);

  // Start gate: a run needs a connected model (key or custom base URL).
  const [connected, setConnected] = useState(false);
  const [connectAttention, setConnectAttention] = useState(0);
  /**
   * The run did not start, and why (TEN-114). HOSTED ONLY: the exam service
   * holds the operational bank, so a create it refuses leaves this browser
   * with nothing legitimate to sit. The old code swallowed that failure and
   * started the run on the bundled practice deck — published keys, a paper
   * the browser marks itself, no server record, and not one word on screen.
   *
   * This replaces a `staleBuild` banner that could never render: it was
   * raised only for a `DeckMismatchError` out of `startServerAttempt`, which
   * neither rethrew nor could produce one. Deck mismatch is caught where it
   * is actually thrown — the hosted-deck effect below.
   */
  const [startError, setStartError] = useState<string | null>(null);
  /**
   * HOSTED CONTENT for the track about to mount. In hosted mode the deck (T2)
   * and the dealt form (T3, T4) are the SERVER's — GET /attempts/:id/items
   * and GET /attempts/:id/track/:trackId, the same rows the exposure log and
   * the score are computed from. `undefined` means "not resolved yet" and the
   * track must not mount: presenting this build's bundled practice content
   * while the server holds a different scenario is exactly the divergence the
   * deck check exists to stop. `config: null` means this run's content really
   * is this build's own (static demo, or a run the backend never created).
   */
  const [hostedTrack, setHostedTrack] = useState<
    { attemptId: string; trackId: TrackId; config: unknown | null } | undefined
  >(undefined);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [deckEpoch, setDeckEpoch] = useState(0);
  const hostedTrackRef = useRef<
    { attemptId: string; trackId: TrackId; config: unknown | null } | undefined
  >(undefined);
  hostedTrackRef.current = hostedTrack;
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

  // Track the model connection — the Start pill is gated on it. There is
  // exactly one thing to read now: the ENDPOINT this browser talks to. The
  // key slot it used to read as well is gone, because the browser no longer
  // holds a key in either build (TEN-62). Re-read on ConnectPanel changes and
  // cross-tab storage.
  useEffect(() => {
    const read = () => {
      try {
        setConnected(hasModelEndpoint(window.localStorage.getItem(LLM_BASE_URL_STORAGE)));
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
  /**
   * True while the track clock is HELD for a post-submit presentation
   * screen. Derived from the log (not local state), so a reload mid-replay
   * restores a held clock and the right chrome instead of a pause veil.
   */
  const presenting = state?.phase === "paused" && state.pauseReason === "presentation";
  /**
   * True while the clock is HELD because the track's content is not on
   * screen yet — the hosted deck is in flight or failed, or the runner
   * module is still loading. Derived from the log for the same reason
   * `presenting` is: a reload mid-hold must restore the held clock.
   */
  const loadingHold = state?.phase === "paused" && state.pauseReason === "loading";

  /**
   * Pause is a full-workspace modal. Keyboard and screen-reader users have
   * to land INSIDE it (its Resume button) when it opens, and back on the
   * header Pause control when it closes — otherwise focus sits on a control
   * hidden behind the veil, or falls to <body> on resume.
   */
  const resumeRef = useRef<HTMLButtonElement>(null);
  const pauseBtnRef = useRef<HTMLButtonElement>(null);
  const wasPausedRef = useRef(false);
  useEffect(() => {
    const isPaused = state?.phase === "paused" && !crashed && !presenting;
    if (isPaused) resumeRef.current?.focus();
    else if (wasPausedRef.current) pauseBtnRef.current?.focus();
    wasPausedRef.current = isPaused;
  }, [state?.phase, crashed, presenting]);

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

  /**
   * Fetch what the server dealt, before the track mounts. Runs once per
   * (attempt, track, retry): the deck and the form are recorded facts about
   * this attempt, not something to re-ask for on every render. A failure is
   * SHOWN, never papered over with local content — see DeckMismatchError in
   * lib/data/persistence.ts.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deckEpoch is the RETRY trigger, not a value this effect reads
  useEffect(() => {
    if (!activeTrack || !attemptId) return;
    const cur = hostedTrackRef.current;
    if (cur?.attemptId === attemptId && cur.trackId === activeTrack) return;   // already resolved
    let cancelled = false;
    setDeckError(null);
    withTimeout(fetchHostedTrackConfig(attemptId, activeTrack), CONTENT_FETCH_TIMEOUT_MS)
      .then((config) => {
        if (!cancelled) setHostedTrack({ attemptId, trackId: activeTrack, config });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDeckError(
          err instanceof DeckMismatchError
            ? "the deck the server dealt you is not the deck it recorded — this run cannot continue on this tab; reload the page"
            : `your ${activeTrack.toUpperCase()} content could not be loaded from the server: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return () => {
      cancelled = true;
    };
    // A failed fetch leaves hostedTrack unset, so the retry button (deckEpoch)
    // is what re-runs this — never a render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack, attemptId, deckEpoch]);
  /**
   * The content is the SERVER's whenever the server dealt some; the static
   * demo (and any track the server deals nothing for, T1) keeps this build's
   * bundled config. `undefined` means the question is not answered yet, and
   * the track must not mount: presenting this build's bundled practice
   * content while the server holds a different scenario is exactly the
   * divergence the deck check exists to stop.
   */
  const hostedConfig =
    hostedTrack && hostedTrack.attemptId === attemptId && hostedTrack.trackId === activeTrack
      ? hostedTrack.config
      : undefined;
  const deckPending = hostedConfig === undefined && deckError === null;
  /** Is there something on screen the candidate can actually work on? */
  const contentPresentable =
    activeTrack !== undefined && mod !== null && !deckPending && deckError === null;

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
    /**
     * A HOSTED T2 or T3 sitting is scored by the SERVER. The browser holds no
     * answer key for either — no deck key, and no plant list — so it cannot
     * mark its own paper (docs/ARCHITECTURE.md §4). T1 and T4 are JUDGED
     * tracks: the server refuses to score them (400), because a judgment it
     * did not make is not one it may invent, so those keep the local demo
     * jury exactly as before. Every other case is unchanged, and safe because
     * the bundled released-practice tier publishes its keys on purpose.
     *
     * THE BROWSER ASKS FOR NO SCORE HERE, AND FOR NONE LATER (TEN-126).
     * TEN-66 moved score issuance to `/finalize`, and the service refuses
     * `POST /attempts/:id/score` on an open sitting with 409 `not_finalized`
     * — that refusal is what closed the answer-key oracle of TEN-60. This
     * page kept asking anyway, so a live sitting on 2026-09-04 printed
     * "POST /attempts/…/score failed: 409" to the candidate mid-run and
     * ended T2 and T3 "recorded, not scored". The track completion is
     * recorded and nothing else: the scores of record arrive at finalize,
     * and the report reads them from the service.
     */
    const serverScored =
      (t === "t2" || t === "t3") &&
      hostedTrackRef.current?.trackId === t &&
      hostedTrackRef.current?.config != null;
    if (serverScored && cur.attemptId) {
      commit([{ type: "track_completed", trackId: t, artifact, timedOut, ts }]);
      clearCheckpoint(window.localStorage, cur.attemptId, t);
      return;
    }
    const rec = scoreTrack(t, artifact, cur.config?.locale ?? "en", cur.attemptId ?? undefined);
    commit([
      { type: "track_completed", trackId: t, artifact, timedOut, ts },
      trackScoredEntry(t, rec, ts),
    ]);
    if (cur.attemptId) clearCheckpoint(window.localStorage, cur.attemptId, t);
    // T1's artifact is a servable site: publish it (server mode; no-op otherwise).
    if (t === "t1" && cur.attemptId) uploadT1Site(cur.attemptId, artifact);
  }, [commit, stamp, uploadT1Site]);

  // Timeout watchdog: budget exhausted → score the last checkpoint (F1/F2).
  useEffect(() => {
    if (!state || !state.currentTrack) return;
    if (state.phase !== "in_track" && state.phase !== "paused") return;
    // The watchdog may never fire over a presentation screen. The clock is
    // held there, so this is normally unreachable — except when the budget
    // was ALREADY spent as the screen opened, and that is exactly the case
    // that used to eject a candidate mid-read. The track then finishes when
    // they leave the screen, with timedOut still derived from accounting.
    if (presenting) return;
    const t = state.currentTrack;
    if (secondsRemaining(state, t, now) <= 0) {
      // Re-read the log: a runner that opens its presentation screen in the
      // same commit as this tick has already appended the hold, and `state`
      // here is that commit's stale projection. Without this the buzzer
      // could still eject a candidate on the first frame of the replay.
      const fresh = logRef.current ? project(logRef.current) : null;
      if (fresh?.pauseReason === "presentation") return;
      const cp = state.attemptId
        ? loadCheckpoint(window.localStorage, state.attemptId, t)
        : undefined;
      finishTrack(t, checkpointToArtifact(t, cp));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, state, presenting]);

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

  /**
   * P0 fairness: a post-submit PRESENTATION screen (T2's replay, T3's
   * reveal, T4's delivery gallery) holds the track clock. The scored work
   * is already captured there, so charging it is charging the candidate for
   * reading — and the watchdog used to eject them mid-sentence, with no
   * notice and no way back. Called with a screen id on open and null on
   * close. Mirrors the crash pattern exactly: an auditable cause event
   * first, then the clock change, both dropped if the machine refuses them
   * (an exhausted budget legitimately rejects further track events — the
   * pause itself still applies, so the screen is never charged).
   */
  const handlePresentation = useCallback((screen: string | null) => {
    const cur = logRef.current ? project(logRef.current) : null;
    if (!cur || !cur.currentTrack) return;
    const t = cur.currentTrack;
    const opening = screen !== null;
    /**
     * A runner may open its presentation screen on the very first frame it
     * mounts — T2 rehydrated at `replay` after a reload does exactly that —
     * and that frame is the one where the CONTENT HOLD is still in place.
     * The hold is ours and it is over, so it hands the clock straight to
     * the presentation hold instead of dropping it on the floor.
     */
    const heldForContent = cur.phase === "paused" && cur.pauseReason === "loading";
    // Opening: only from a running clock, or from our own content hold (a
    // candidate/crash pause stands). Closing: only undo a hold WE placed,
    // and only while it is still held.
    if (opening ? cur.phase !== "in_track" && !heldForContent : cur.pauseReason !== "presentation") return;
    const ts = stamp();
    if (opening && heldForContent) contentHeldRef.current = false;
    commitIfLegal([
      ...(opening && heldForContent ? [{ type: "resumed" as const, ts }] : []),
      {
        type: "track_event", trackId: t, ts,
        event: {
          verb: opening ? "presentation_opened" : "presentation_closed",
          object: `track:${t}`,
          context: { track: t, screen: screen ?? "closed", clock: opening ? "held" : "running" },
          clientTs: new Date().toISOString(),
        },
      },
      opening ? { type: "paused", reason: "presentation", ts } : { type: "resumed", ts },
    ]);
  }, [commitIfLegal, stamp]);

  /**
   * CONTENT HOLD (TEN-116). `track_started` starts the clock; the hosted
   * deck fetch and the runner's dynamic import happen after it. A fetch that
   * hung used to spend the entire non-revisitable budget, score an empty
   * artifact as a zero, and then tell the candidate the clock ran out "while
   * you were working" and that "your work was kept" — neither of which had
   * happened. Our fault is not charged to their budget, so this holds the
   * clock until the content is actually presentable, exactly as a runner
   * crash does, with the same auditable cause event.
   */
  const contentHeldRef = useRef(false);
  const holdContent = useCallback((hold: boolean) => {
    const t = (logRef.current ? project(logRef.current) : null)?.currentTrack;
    if (!t) return;
    const ts = stamp();
    contentHeldRef.current = hold;
    commitIfLegal([
      {
        type: "track_event", trackId: t, ts,
        event: {
          verb: hold ? "content_hold_opened" : "content_hold_closed",
          object: `track:${t}`,
          context: { track: t, clock: hold ? "held" : "running" },
          clientTs: new Date().toISOString(),
        },
      },
      hold ? { type: "paused", reason: "loading", ts } : { type: "resumed", ts },
    ]);
  }, [commitIfLegal, stamp]);

  useEffect(() => {
    const holding = state?.phase === "paused" && state.pauseReason === "loading";
    if (contentPresentable) {
      if (holding && contentHeldRef.current) holdContent(false);
      return;
    }
    if (holding || crashed || state?.phase !== "in_track") return;
    /**
     * The grace: content that arrives inside one tick of the 1 Hz track
     * clock costs nothing measurable, and holding for it would write a
     * pause pair into the event log on every single track start. A wait the
     * candidate can SEE is the one that gets held.
     */
    const id = window.setTimeout(() => holdContent(true), CONTENT_HOLD_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [contentPresentable, crashed, state, holdContent]);

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
      <PersistWarning warning={startError} label="Your run did not start" />
        <div className="container" style={{ maxWidth: 820, paddingBottom: "5.5rem" }}>
          <div className="eyebrow">Demo run · AILX 2026.1</div>
          <h1>Four tracks. One <span className="script-accent">run</span>.</h1>
          <p className="lede">
            T1 to T4 in order, each on its own clock. Pause between moves, never
            mid-swipe. {eventLogCopy()}
          </p>
          <div style={{ textAlign: "right" }}><Annotation side="left">{examAccessCopy()}</Annotation></div>
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
            <span className="badge demo">demo</span> Deterministic scoring: the real track
            plugins score your stored artifacts and judgments. Same play, same score, forever.
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
                let serverId: string | null;
                try {
                  serverId = await startServerAttempt(cfg.locale);
                } catch (err) {
                  // Hosted only, and never a fallback: the practice deck is a
                  // different instrument, and swapping it in unannounced is
                  // the defect DeckMismatchError already refuses to ship.
                  setStartError(startFailureCopy(err));
                  return;
                }
                setStartError(null);
                const ts = Date.now();
                const attemptId =
                  serverId ?? `att-${sha256Hex(`${ts}:${Math.random()}`).slice(0, 12)}`;
                commit([{ type: "attempt_started", attemptId, config: cfg, ts }]);
                // The ONLY funnel event a scored sitting emits. Everything
                // after this — responses, timings, judgments — is exam
                // evidence and belongs in the append-only store, not in a
                // metrics table (docs/KPI.md, AGENTS.md core invariants).
                funnel().step("sitting_started");
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
          {/* Derived, never asserted (TEN-129). The old line said "All four
              tracks are scored" on a run where the service had scored none of
              them yet, on the same screen as the error saying so. */}
          <p className="lede" data-testid="completion-summary">{completionSummary(state)}</p>
          <SiteUploadNotice status={siteStatus} onRetry={retrySiteUpload} />
          <p style={{ display: "flex", gap: "0.8rem" }}>
            <Link href="/report" className="btn primary">Open your report →</Link>
            <ResetButton onReset={resetAttempt} />
          </p>
        </div>
      </main>
    );
  }

  // ---- Between tracks -----------------------------------------------------
  if (state.phase === "between_tracks") {
    // A track that ended on the timer says so, explicitly, at the moment it
    // happens. It used to teleport the candidate to the track list, which
    // reads as a crash rather than a timeout. Completion follows the fixed
    // T1→T4 order, so the last completed track is the one just finished.
    const justFinished = [...state.order].reverse().find((id) => state.tracks[id].status === "completed");
    if (justFinished && state.tracks[justFinished].timedOut && timeUpAck !== justFinished) {
      return (
        <main className="page">
          <PersistWarning warning={persistWarning} />
          <TimeUpNotice
            trackId={justFinished}
            budgetSeconds={state.config!.budgets[justFinished]}
            serviceScored={state.tracks[justFinished].score === undefined}
            onContinue={() => setTimeUpAck(justFinished)}
          />
        </main>
      );
    }
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
                      {/* A hosted T2/T3 has no local score and never will:
                          the service issues it at finalize. "recorded, not
                          scored" is true of this browser and reads as a
                          failure, so the service's tracks say whose score it
                          is (TEN-126). */}
                      ✓ {ts.score === undefined ? SERVICE_SCORES_THIS_TRACK : formatTrackScore(ts.score, ts.judgments, t.id)}
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
          {done.some((t) => isDemoScored(state.tracks[t].judgments)) ? (
            <p className="faint small" style={{ margin: "-0.8rem 0 1.5rem" }}>{DEMO_SCORE_NOTE}</p>
          ) : null}
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
  // The veil hides the workspace for a candidate pause only. A crash shows
  // its recovery panel; a presentation hold shows the screen being read —
  // veiling either would hide the very thing the pause exists for.
  const veiled = paused && !crashed && !presenting && !loadingHold;

  const uiProps = {
    attemptId: state.attemptId!,
    locale: state.config!.locale,
    config:
      hostedConfig != null
        ? hostedConfig
        : trackConfig(t, state.config!.locale, state.attemptId ?? undefined),
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
    onPresentation: handlePresentation,
    secondsRemaining: remaining,
    /**
     * The track clock is stopped and the workspace is hidden — a candidate
     * pause or a crash hold. A runner that keeps a clock of its own must
     * freeze it (TEN-115); a presentation hold is not one of these, because
     * the screen being read is the runner's own and nothing there is scored.
     */
    paused: paused && !presenting,
    // F2: the runner rehydrates from the last checkpoint and persists every
    // meaningful mutation back through onCheckpoint.
    checkpoint: initialCheckpoint,
    onCheckpoint: (cp: unknown) => {
      if (state.attemptId) saveCheckpoint(window.localStorage, state.attemptId, t, cp);
    },
    // The host attaches WHO is asking. It has no provider key to attach, in
    // either build: hosted, the gateway spends a key it holds sealed against
    // this identity; static, the endpoint is a capped proxy or a local server
    // and the identity headers are ignored by both.
    modelFetch: modelGatewayFetch,
    // A runner that gives up on a dead endpoint mid-run clears the shared
    // slot; the gate above must hear it or the Start pill lies on the next
    // screen.
    onModelDisconnect: () => {
      try {
        window.dispatchEvent(new Event(CONNECTION_CHANGED_EVENT));
      } catch {
        /* non-fatal */
      }
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
            {presenting || loadingHold ? (
              /* Nothing here is scored and nothing is charged: no Pause to
                 offer, and no Resume that could restart the clock under a
                 candidate who is only reading — or waiting on us. */
              <span className="badge" data-testid="clock-held" role="status">
                {presenting
                  ? "clock held · this screen is not timed"
                  : "clock held · your content is not on screen yet"}
              </span>
            ) : paused ? (
              <button className="btn" onClick={() => commit([{ type: "resumed", ts: stamp() }])}>Resume</button>
            ) : (
              <button className="btn" ref={pauseBtnRef} onClick={() => commit([{ type: "paused", ts: stamp() }])}>Pause</button>
            )}
          </div>
        </div>
        <div className="runner-frame" style={{ marginTop: "1.2rem", position: "relative" }}>
          {/* F2: the Runner stays MOUNTED while paused — a veil covers it so
              content is hidden but in-progress state survives. */}
          {deckError ? (
            <div role="alert" style={{ display: "grid", gap: "0.8rem", padding: "1rem" }}>
              <p className="muted" style={{ margin: 0 }} data-testid="deck-error">{deckError}</p>
              <div>
                <button className="btn" onClick={() => setDeckEpoch((n) => n + 1)}>
                  Retry loading your deck
                </button>
              </div>
            </div>
          ) : mod && !deckPending ? (
            <div aria-hidden={veiled} style={veiled ? { visibility: "hidden" } : undefined}>
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
            <p className="muted">{deckPending ? "Loading your deck…" : "Loading track runner…"}</p>
          )}
          {veiled && (
            <div
              role="dialog" aria-modal="true" aria-label="Paused"
              style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: "0.4rem",
                background: "var(--bg)", zIndex: 5, textAlign: "center", padding: "3rem 1rem",
              }}
            >
              <h2 style={{ margin: 0 }}>Paused</h2>
              <p className="muted">The track clock is stopped. Content is hidden while paused; your work is kept.</p>
              {/* The dialog used to hold no control at all: the only way out
                  was a Resume button OUTSIDE it, in the page header. A
                  modal that covers the whole workspace must carry its own
                  way out. */}
              <button
                className="btn primary"
                ref={resumeRef}
                onClick={() => commit([{ type: "resumed", ts: stamp() }])}
              >
                Resume track
              </button>
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
 * Explicit end-of-clock state (P0 fairness). A timed-out track used to drop
 * the candidate straight onto the track list with no word about what had
 * happened — indistinguishable from a crash, and doubly unfair when the
 * clock had been running behind a screen they could not score on. Says what
 * happened, what was kept, and what is never charged.
 */
function TimeUpNotice({
  trackId, budgetSeconds, onContinue, serviceScored,
}: { trackId: TrackId; budgetSeconds: number; onContinue: () => void; serviceScored: boolean }) {
  const meta = TRACK_META[trackId];
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The screen replaces the whole workspace: land focus on it, or a
  // keyboard/AT user is told nothing at all.
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <div className="container" style={{ maxWidth: 820 }} data-testid="time-up">
      <div className="eyebrow">{meta.code} · {meta.name}</div>
      <h1 ref={headingRef} tabIndex={-1} style={{ outline: "none" }}>Time up</h1>
      <p className="lede">
        {meta.code}&rsquo;s {fmt(budgetSeconds)} clock ran out, so the track closed itself.
      </p>
      <p className="muted">
        {/* A hosted T2/T3 is not scored in this browser at all, so the old
            sentence promised a local score that never comes (TEN-126). */}
        {serviceScored ? (
          <>
            Everything you saved was recorded. The exam service scores {meta.code} when
            you finish the sitting. The run continues.
          </>
        ) : (
          <>
            {meta.code} was scored from everything you saved, by the same deterministic
            scorer as a track you finish by hand. The run continues.
          </>
        )}
      </p>
      {/* The three examples (T2's replay, T3's reveal, T4's delivered set) are
          gone: they illustrated the rule stated in the same breath. */}
      <p className="muted">
        Only working time is charged. The screens after you submit hold the clock, so
        reading them costs you nothing.
      </p>
      <button className="btn primary" onClick={onContinue} data-testid="time-up-continue">
        Continue
      </button>
    </div>
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
          This run already published a different site. One site per run, and the
          first one stands. {status.message}
        </span>
      ) : status.kind === "rejected" ? (
        <span className="muted">
          The server rejected your site ({status.message}). Your work is saved
          locally and scored as normal.
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
