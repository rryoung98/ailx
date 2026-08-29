"use client";

/**
 * The two reviewer buttons. A leaf client component (FRONTEND.md §2.3.5): the
 * queue page itself stays a server component, and only this control enters the
 * browser bundle.
 *
 * It decides nothing. The POST it sends is re-authorized on the server, which
 * is where the allowlist lives — this file is a form, not a gate.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

type Busy = "approve" | "reject" | null;

export function ReviewActions({ shareId, name }: { shareId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch("/api/gallery/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareId, decision }),
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

  return (
    <div className="review-actions">
      {/* The live region is rendered first and filled later, so it announces. */}
      <p role="alert" className="small" style={{ margin: 0, color: "var(--bad)" }}>
        {error}
      </p>
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
