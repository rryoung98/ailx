"use client";
/**
 * Route-level error boundary (App Router).
 *
 * Anything that throws OUTSIDE the track runner — the exam shell itself, the
 * report, the gallery — lands here instead of on a white page. The exam is
 * timed and scored, so the two things this screen must do are say that the
 * stored run is intact and give one obvious way back.
 *
 * The run log lives in localStorage and is append-only, so `reset()` (a
 * re-render of the segment) rehydrates it; nothing here clears storage.
 */
import { useEffect } from "react";
import Link from "next/link";

export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ailx] route error", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 640 }}>
        <div role="alert" className="card" style={{ padding: "1.5rem", display: "grid", gap: "0.7rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Something broke on this screen</h1>
          <p className="muted" style={{ margin: 0 }}>
            Your run is saved in this browser — the event log is append-only and
            was not touched by this fault. Continuing reloads it from storage.
          </p>
          <p style={{ margin: 0, display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
            <button className="btn primary" onClick={() => reset()}>Try again</button>
            <Link className="btn" href="/exam">Back to your run</Link>
          </p>
          <p className="faint small mono" style={{ margin: 0 }}>
            {error.digest ? `digest ${error.digest} · ` : ""}{error.message || "unknown error"}
          </p>
        </div>
      </div>
    </main>
  );
}
