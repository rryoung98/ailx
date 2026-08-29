"use client";

/**
 * The moderation conversation, on both sides of it.
 *
 * Two client components over one presentational list, because the two
 * audiences are genuinely different and must not share a data path:
 *
 *  - `ModeratorThread` (the AILX dashboard) shows the WHOLE trail — internal
 *    notes, superseded rows, retractions and who wrote each one.
 *  - `CandidateThread` (inside the candidate's own report) shows only what
 *    the server chose to send them: shared messages, current state, and the
 *    ROLE of the author. There is no reviewer name in that payload at all
 *    (see @ailx/backend `listComments`), so nothing here can render one.
 *
 * Neither component is a gate. Both POST to a route that re-authorizes
 * server-side; hiding a textarea is not access control.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  COMMENT_BODY_MAX,
  DEV_USER_HEADER,
  type CandidateComment,
  type CandidateThread as Thread,
  type ModerationComment,
} from "@ailx/backend";
import { isServerMode } from "./mode";
import { browserApiOptions, devUser, getServerAttemptId } from "./persistence";

const AUTHOR_LABEL: Record<string, string> = {
  reviewer: "AILX moderator",
  candidate: "The candidate",
};

/** A composer that never lets an empty body reach the server. */
function Composer({
  id,
  label,
  hint,
  submitLabel,
  busy,
  error,
  onSubmit,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (body: string) => void;
  children?: React.ReactNode;
}) {
  const [body, setBody] = useState("");
  return (
    <form
      className="mod-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim() === "") return;
        onSubmit(body);
        setBody("");
      }}
    >
      {/* Rendered before it has anything to say, so it announces when filled. */}
      <p role="alert" className="small" style={{ margin: 0, color: "var(--bad)" }}>
        {error}
      </p>
      <label className="small muted" htmlFor={id}>
        {label}
        {hint ? <span className="faint"> — {hint}</span> : null}
      </label>
      <textarea
        id={id}
        className="field"
        rows={3}
        maxLength={COMMENT_BODY_MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        style={{ width: "100%" }}
      />
      <div className="mod-composer-actions">
        {children}
        <button type="submit" className="btn primary small-btn" aria-busy={busy} disabled={busy}>
          {busy ? "Sending…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** One comment, in either audience's shape. */
function CommentRow({
  at,
  role,
  body,
  author,
  visibility,
  superseded,
  retracted,
}: {
  at: string;
  role: string;
  body: string;
  author?: string;
  visibility?: string;
  superseded?: boolean;
  retracted?: boolean;
}) {
  return (
    <li className={`mod-comment${superseded ? " superseded" : ""}`}>
      <p className="small mod-comment-head">
        <strong>{AUTHOR_LABEL[role] ?? role}</strong>
        {author ? <span className="mono faint"> {author}</span> : null}
        {visibility ? (
          <span className={`badge mod-vis-${visibility}`}>
            {visibility === "internal" ? "internal note" : "sent to candidate"}
          </span>
        ) : null}
        <time className="faint" dateTime={at}>
          {at.slice(0, 16).replace("T", " ")}
        </time>
        {superseded ? <span className="faint"> · replaced, kept on the record</span> : null}
      </p>
      <p className="mod-comment-body">
        {retracted ? <em className="faint">Withdrawn by its author.</em> : body}
      </p>
    </li>
  );
}

const failure = (status: number): string =>
  status === 403 ? "You are not a moderator." : `That did not send (${status}). Nothing was written.`;

/**
 * MODERATOR side. The trail is rendered from the server component's data and
 * refreshed by `router.refresh()` after a write, so what is on screen is
 * always what the database says — never a locally patched optimistic copy of
 * an audit trail.
 */
export function ModeratorThread({ shareId, trail }: { shareId: string; trail: ModerationComment[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const send = async (body: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/moderation/${shareId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, visibility: shared ? "shared" : "internal" }),
      });
      if (!res.ok) setError(failure(res.status));
      else router.refresh();
    } catch {
      setError("The note did not reach the server. Nothing was written.");
    }
    setBusy(false);
  };

  return (
    <section className="mod-thread" aria-labelledby={`trail-${shareId}`}>
      <h2 id={`trail-${shareId}`} className="mod-h">
        Trail <span className="faint small">({trail.length})</span>
      </h2>
      {trail.length === 0 ? (
        <p className="muted small">Nothing written yet.</p>
      ) : (
        <ul className="mod-comments">
          {trail.map((c) => (
            <CommentRow
              key={c.id}
              at={c.at}
              role={c.role}
              body={c.body}
              author={c.author}
              visibility={c.visibility}
              superseded={!c.current}
              retracted={c.retracted}
            />
          ))}
        </ul>
      )}
      <Composer
        id={`note-${shareId}`}
        label="Add to the record"
        hint="every comment is an insert — nothing here can be edited away"
        submitLabel={shared ? "Send to the candidate" : "Save internal note"}
        busy={busy}
        error={error}
        onSubmit={send}
      >
        <label className="small mod-visibility">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Send this to the candidate (they never see who wrote it)
        </label>
      </Composer>
    </section>
  );
}

/**
 * CANDIDATE side, rendered inside their own report. Reads and writes only
 * `/api/attempts/:id/moderation`, which resolves the case from the ATTEMPT
 * they own — there is no case id to guess.
 */
export function CandidateThread({ attemptId }: { attemptId: string }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = useCallback(() => {
    const opts = browserApiOptions();
    const serverId = getServerAttemptId(window.localStorage, attemptId) ?? attemptId;
    return {
      url: `${opts.baseUrl}/attempts/${serverId}/moderation`,
      headers: { [DEV_USER_HEADER]: devUser(window.localStorage) },
      fetchFn: opts.fetchFn,
    };
  }, [attemptId]);

  const load = useCallback(async () => {
    const { url, headers, fetchFn } = endpoint();
    const res = await fetchFn(url, { headers });
    if (!res.ok) {
      setThread(null);
      return;
    }
    // A body that is not a thread is not a thread: the report page mounts this
    // next to other share calls, and half a payload must render nothing.
    const body = (await res.json()) as { thread?: Thread };
    const thread = body?.thread;
    setThread(thread && typeof thread.status === "string" && Array.isArray(thread.comments) ? thread : null);
  }, [endpoint]);

  useEffect(() => {
    if (!isServerMode()) return;
    void load().catch(() => setThread(null));
  }, [load]);

  if (!isServerMode() || thread === null) return null;
  // Nothing has been decided: there is nothing to respond to yet.
  if (thread.status !== "rejected" && thread.status !== "published") return null;
  if (thread.comments.length === 0 && !thread.canReply) return null;

  const send = async (body: string) => {
    setBusy(true);
    setError(null);
    try {
      const { url, headers, fetchFn } = endpoint();
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) setError("That did not send. Nothing was written.");
      else await load();
    } catch {
      setError("That did not reach the server. Nothing was written.");
    }
    setBusy(false);
  };

  return (
    <section className="mod-thread" aria-labelledby="candidate-thread">
      <h3 id="candidate-thread" className="mod-h">
        Your conversation with the moderators
      </h3>
      <p className="small muted" style={{ maxWidth: "62ch" }}>
        Moderators are shown as &ldquo;AILX moderator&rdquo;: you are told what was decided and
        why, never who decided it. Everything here is kept on the record.
      </p>
      {thread.comments.length === 0 ? null : (
        <ul className="mod-comments">
          {thread.comments.map((c: CandidateComment) => (
            <CommentRow key={c.id} at={c.at} role={c.role} body={c.body} />
          ))}
        </ul>
      )}
      {thread.canReply ? (
        <Composer
          id="candidate-reply"
          label="Respond to this decision"
          hint={
            thread.status === "rejected"
              ? "a moderator reads it and answers; the refusal itself stands unless they say otherwise"
              : "anything the moderators should know"
          }
          submitLabel="Send response"
          busy={busy}
          error={error}
          onSubmit={send}
        />
      ) : (
        <p className="small faint" role="status">
          Your response is with a moderator. You can write again once they answer.
        </p>
      )}
    </section>
  );
}
