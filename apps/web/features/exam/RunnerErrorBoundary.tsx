"use client";
/**
 * Track-runner error boundary.
 *
 * The exam is TIMED and SCORED, so an uncaught render error inside a track
 * Runner is a measurement event, not a cosmetic one: before this boundary
 * existed a single throw unmounted the whole tree and left the candidate on
 * a white page while their own clock kept running.
 *
 * Contract:
 *  - the session event log in localStorage stays authoritative — this
 *    component never touches it, it only reports the crash upward;
 *  - `onError` is where the page stops the track clock and records the
 *    fault (see apps/web/app/exam/page.tsx);
 *  - `onRetry` remounts the runner from its last checkpoint.
 */
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

export interface RunnerErrorBoundaryProps {
  children?: ReactNode;
  /** Debug context logged with the crash (attempt id, track, phase, clock). */
  context?: Record<string, unknown>;
  /** Called once per crash — the page pauses the clock and logs the fault. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Called when the candidate asks to reload the track from its checkpoint. */
  onRetry?: () => void;
}

export class RunnerErrorBoundary extends Component<
  RunnerErrorBoundaryProps,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Enough context to debug a crash we can never reproduce locally: which
    // attempt, which track, how much clock was left, and the component stack.
    console.error("[ailx] track runner crashed", {
      ...this.props.context,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
    this.props.onError?.(error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="runner-crash"
        className="card"
        style={{ padding: "1.25rem", display: "grid", gap: "0.6rem", maxWidth: 640, margin: "0 auto" }}
      >
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>This track hit a fault</h2>
        <p className="muted" style={{ margin: 0 }}>
          Your run is saved: every answer you have already given is in the
          event log, and this track reloads from its last checkpoint.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          <strong>The track clock is paused</strong> — a fault on our side is
          never charged to your time budget. It restarts when you continue.
        </p>
        <p style={{ margin: 0 }}>
          <button
            className="btn primary"
            data-testid="runner-crash-retry"
            onClick={() => this.props.onRetry?.()}
          >
            Reload this track and continue
          </button>
        </p>
        <p className="faint small mono" style={{ margin: 0 }} data-testid="runner-crash-detail">
          {error.message || "unknown error"}
        </p>
      </div>
    );
  }
}
