"use client";

/**
 * What a candidate is told when their sitting is complete here and the Foray
 * service has not recorded it as finished.
 *
 * ONE component for the two surfaces that owe them that sentence — the
 * completion screen and the report — because they used to owe it and neither
 * said anything (TEN-206). The finalize POST is the only thing that issues a
 * score of record (TEN-66); when it fails, `Run complete` followed by a report
 * with no score is not a slow page, it is a sitting that will never be marked
 * unless somebody asks again.
 *
 * Three states, three different facts:
 *  - nothing to say (static build, or the service has it) — renders nothing;
 *  - still trying — the mirror's own bounded retries are running, so the one
 *    honest instruction is "wait";
 *  - out of retries — the next attempt is the candidate's, so there is a
 *    button, and it is the only action there is.
 */
import type { SyncStatus } from "../../lib/data/persistence";

export function FinalizeNotice({
  status,
  busy,
  onRetry,
}: {
  status: SyncStatus;
  busy?: boolean;
  onRetry: () => void;
}) {
  if (!status.finalizePending) return null;
  const stillTrying = status.phase !== "failed";
  return (
    <div
      role="status"
      data-testid="finalize-notice"
      data-phase={status.phase}
      style={{
        background: "var(--card)",
        border: "1px solid var(--warn)",
        borderLeft: "4px solid var(--warn)",
        padding: "0.9rem 1rem",
        borderRadius: 8,
        margin: "1rem 0",
        display: "grid",
        gap: "0.6rem",
        maxWidth: 820,
      }}
    >
      <strong>Your sitting is not scored yet.</strong>
      <p className="small" style={{ margin: 0 }}>
        Every answer you gave is stored in this browser, and the Foray service
        already holds the ones it accepted. What is missing is the last step,
        the one that tells the service you have finished — and only that step
        issues a score.
      </p>
      {stillTrying ? (
        <p className="small" style={{ margin: 0 }} data-testid="finalize-retrying">
          We are asking it again. Leave this tab open.
        </p>
      ) : (
        <>
          <p className="small" style={{ margin: 0 }} data-testid="finalize-stalled">
            We asked five times and it did not take. Nothing is lost by asking
            again{status.message === undefined ? "" : ` (last answer: ${status.message})`}.
          </p>
          <div>
            <button type="button" className="btn primary" onClick={onRetry} disabled={busy === true}>
              {busy === true ? "Sending…" : "Send it again"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
