"use client";

/**
 * The candidate is STOPPED, not warned.
 *
 * A `QuotaExceededError` on save used to be a banner over a running clock
 * (TEN-208). The log only grows, so once the quota is hit every later save
 * fails the same way: the candidate kept working, kept being charged for the
 * time, and none of it was written anywhere. T4 keeps up to twelve 200 KB
 * drafts and promotes full-resolution finals, and T1's artifact is a whole
 * HTML document, so a 5 MB origin budget is an ordinary outcome rather than
 * an exotic one.
 *
 * So the clock is HELD and the workspace is covered until the candidate has
 * decided what to do. Two things are true at once and both are said: what
 * this browser can no longer do, and whether the Foray service has the work
 * anyway. Those are different facts with different consequences, and reading
 * the wrong one costs a sitting.
 */
import { useEffect, useRef } from "react";
import type { StorageStopCopy } from "./storageStopCopy";

export function StorageStop({
  copy,
  busy,
  onRetry,
  onContinue,
}: {
  copy: StorageStopCopy;
  busy?: boolean;
  onRetry: () => void;
  onContinue: () => void;
}) {
  /**
   * A modal that covers the whole workspace has to LAND focus inside itself,
   * or a keyboard and screen-reader candidate is told nothing and can tab
   * about behind a veil (the same class as TEN-224, found on this control
   * while fixing that one). The heading, not a button: the two choices here
   * have consequences, and the first thing to be read is which they are.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <div
      role="alertdialog"
      aria-label={copy.heading}
      data-testid="storage-stop"
      data-mirrored={copy.mirrored ? "true" : "false"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "grid",
        placeItems: "center",
        background: "color-mix(in srgb, var(--bg) 92%, transparent)",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--bad)",
          borderRadius: 12,
          padding: "1.4rem 1.6rem",
          maxWidth: 620,
          display: "grid",
          gap: "0.9rem",
        }}
      >
        <h2 ref={headingRef} tabIndex={-1} style={{ margin: 0, outline: "none" }}>{copy.heading}</h2>
        {copy.body.map((line) => (
          <p key={line} className="small" style={{ margin: 0 }}>
            {line}
          </p>
        ))}
        <p className="small faint mono" style={{ margin: 0 }} data-testid="storage-stop-reason">
          {copy.reason}
        </p>
        <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
          <button type="button" className="btn primary" onClick={onRetry} disabled={busy === true}>
            {busy === true ? "Trying…" : copy.retryLabel}
          </button>
          <button type="button" className="btn" onClick={onContinue}>
            {copy.continueLabel}
          </button>
        </div>
        <p className="small faint" style={{ margin: 0 }}>
          {copy.clockNote}
        </p>
      </div>
    </div>
  );
}
