"use client";

/**
 * The two reviewer buttons, plus the one thing a refusal must carry: a reason.
 *
 * A leaf client component (FRONTEND.md §2.3.5): the queue page itself stays a
 * server component, and only this control enters the browser bundle.
 *
 * It decides nothing. The POST it sends is re-authorized on the server, which
 * is where the allowlist lives, and the server refuses a reject with no reason
 * on its own — this file is a form, not a gate.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPath, REJECT_REASON_MAX } from "@ailx/contract";
import { serviceHeaders } from "../../lib/data/traceparent";
import { apiBase } from "../../lib/mode";


type Busy = "approve" | "reject" | null;

export function ReviewActions({ shareId, name }: { shareId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    if (decision === "reject" && reason.trim() === "") {
      setError("Say why. The candidate is shown this reason.");
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      // The dev identity rides the HEADER, never the cookie: this POST may
      // cross an origin (the exam service), where a SameSite=Lax cookie is
      // not sent at all. Same id either way — see lib/persistence devUser.
      const res = await fetch(`${apiBase()}${apiPath("reviewDecision")}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await serviceHeaders(window.localStorage)) },
        body: JSON.stringify({ shareId, decision, reason }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? "You are not a reviewer." : `Refused (${res.status}).`);
        setBusy(null);
        return;
      }
      router.refresh();
    } catch {
      setError("The decision did not reach the server. Nothing changed.");
      setBusy(null);
    }
  }

  const reasonId = `reject-reason-${shareId}`;
  return (
    <div className="review-actions">
      {/* The live region is rendered first and filled later, so it announces. */}
      <p role="alert" className="small" style={{ margin: 0, color: "var(--bad)" }}>
        {error}
      </p>
      <label className="small muted review-reason" htmlFor={reasonId}>
        Reason (required to refuse — the candidate reads it)
        <input
          id={reasonId}
          className="field"
          type="text"
          maxLength={REJECT_REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ width: "100%" }}
        />
      </label>
      <button
        type="button"
        className="btn primary small-btn"
        onClick={() => decide("approve")}
        aria-busy={busy === "approve"}
      >
        Approve<span className="sr-only"> {name}</span>
      </button>
      <button
        type="button"
        className="btn danger small-btn"
        onClick={() => decide("reject")}
        aria-busy={busy === "reject"}
      >
        Reject<span className="sr-only"> {name}</span>
      </button>
    </div>
  );
}
