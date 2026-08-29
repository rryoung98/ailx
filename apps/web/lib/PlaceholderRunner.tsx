"use client";

/**
 * Placeholder track Runner — shown when a real track package
 * (@ailx/track-t1..t4) is not installed in this build. Implements the full
 * TrackUIProps contract so the session engine, event log, timers and scoring
 * path are exercised end-to-end.
 */

import { useState } from "react";
import type { TrackUIProps } from "@ailx/core";
import type { TrackId } from "@ailx/session";
import { TRACK_META } from "@ailx/report";

interface PlaceholderConfig {
  trackId?: TrackId;
}

const DEMO_ACTIONS: Array<{ verb: string; label: string; object: string }> = [
  { verb: "prompted", label: "Prompt the assistant", object: "assistant" },
  { verb: "revised", label: "Revise the draft", object: "draft" },
  { verb: "regenerated", label: "Regenerate output", object: "generator" },
  { verb: "verified", label: "Check the primary source", object: "source" },
];

export function PlaceholderRunner(props: TrackUIProps) {
  const trackId = ((props.config as PlaceholderConfig)?.trackId ?? "t1") as TrackId;
  const meta = TRACK_META[trackId];
  const [interactions, setInteractions] = useState<string[]>([]);
  const [response, setResponse] = useState("");
  const [done, setDone] = useState(false);

  const act = (verb: string, object: string) => {
    props.onEvent({
      verb,
      object: `${trackId}:${object}`,
      context: { demo: true },
      clientTs: new Date().toISOString(),
    });
    setInteractions((xs) => [...xs, verb]);
  };

  const submit = () => {
    if (done) return;
    setDone(true);
    props.onEvent({
      verb: "submitted",
      object: `${trackId}:artifact`,
      clientTs: new Date().toISOString(),
    });
    props.onComplete({
      demo: true,
      trackId,
      response,
      interactions,
    });
  };

  return (
    <div>
      <p>
        <span className="badge demo">placeholder runner</span>{" "}
        <span className="faint small">
          {meta.packageName} is not installed in this build; this stand-in exercises the
          identical session contract (config · onEvent · onComplete · secondsRemaining).
        </span>
      </p>
      <h3 style={{ marginTop: "1rem" }}>{meta.code} · {meta.name} — brief</h3>
      <p className="muted">{meta.brief}</p>
      <p className="small faint">
        Simulate player behaviour below. Every action lands in the append-only event
        log and shapes the demo score (more diagnostic iteration → higher process
        subscores).
      </p>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", margin: "1rem 0" }}>
        {DEMO_ACTIONS.map((a) => (
          <button key={a.verb} className="btn" disabled={done} onClick={() => act(a.verb, a.object)}>
            {a.label}
          </button>
        ))}
      </div>
      <p className="small muted mono">event log: {interactions.length === 0 ? "—" : interactions.join(" → ")}</p>
      <label className="small muted" htmlFor="resp">Your written response / rationale</label>
      <textarea
        id="resp"
        className="field"
        rows={5}
        placeholder="Write a short analysis or design rationale…"
        value={response}
        disabled={done}
        onChange={(e) => setResponse(e.target.value)}
        style={{ margin: "0.4rem 0 1rem" }}
      />
      <button className="btn primary" onClick={submit} disabled={done}>
        Submit {meta.code}
      </button>
    </div>
  );
}
