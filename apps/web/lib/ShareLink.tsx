"use client";

/**
 * Create / copy / revoke the candidate's unlisted share link, and choose what
 * goes in it.
 *
 * PRIVATE BY DEFAULT: nothing exists until this button is pressed, and the
 * revoke button destroys it. What the link carries is a per-section opt-in —
 * the checkboxes below are a HINT, not the gate: the server rebuilds the
 * payload from the stored log and applies the same selection again
 * (`createShare` in @ailx/backend), so an unchecked section cannot appear.
 *
 * The token is stored, so the link is RECOVERABLE by its owner: this panel
 * asks the server for it and shows it again on any device the candidate signs
 * in from. Losing the URL is no longer a reason to revoke (docs/SHARING.md §2).
 *
 * Static export: `isServerMode()` is false, there is no backend to share to,
 * and this component renders nothing — no dead buttons (FRONTEND.md §2.3.4).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { needsHumanApproval, shareUrlPath, type ShareStatus } from "@ailx/backend";
import { authHeaders } from "./authHeaders";
import {
  DEFAULT_SHARE_SECTIONS,
  SHARE_NOTE_MAX,
  SHARE_SECTIONS,
  type SharePayload,
  type ShareSection,
  type ShareSections,
} from "@ailx/report";
import { assetUrl, basePath, isServerMode } from "./mode";
import { ShareTargets } from "./ShareTargets";
import { CandidateThread } from "./Moderation";
import { browserApiOptions, getServerAttemptId } from "./persistence";
import { loadSiteSubmission } from "./siteUpload";

/** Label and one honest line per section. Rendered here and nowhere else. */
const SECTION_COPY: Record<ShareSection, { label: string; hint: string }> = {
  profile: {
    label: "Your strengths and watch-outs",
    hint: "The short text your type implies — derived from the same four numbers.",
  },
  process: {
    label: "How you worked",
    hint: "Time on task per track, how much you iterated, how often you verified. No items, no answers.",
  },
  completed: { label: "The day you finished", hint: "A date, to the day." },
  site: {
    label: "The site you built in T1",
    hint: "Your own work, served live. A human reviews it before it can be listed in the gallery.",
  },
  note: {
    label: "A line about what you built",
    hint: "Your words, shown on the card. Reviewed by a human before it can be listed.",
  },
};

interface ShareState {
  status: ShareStatus;
  token: string;
  views: number;
  payload: SharePayload;
  /** The refusal reason, verbatim. The refuser is never sent to the owner. */
  rejectReason: string | null;
}

type Phase = "loading" | "none" | "live" | "busy" | "error";

/** Which sections a live link actually carries, read from its frozen payload. */
function includedSections(payload: SharePayload): ShareSection[] {
  return SHARE_SECTIONS.filter((key) => {
    if (key === "profile") return payload.profile !== null;
    if (key === "process") return payload.process !== null;
    if (key === "completed") return payload.completedOn !== null;
    if (key === "site") return payload.site !== null;
    return payload.note !== null;
  });
}

/**
 * The one control that moves a share into the public gallery, and the one
 * place its four possible answers are worded.
 *
 * The split between "listed now" and "a human looks first" is NOT decided
 * here: `needsHumanApproval` is the same pure predicate the server applies to
 * the stored payload (docs/SHARING.md §3), imported rather than restated, so
 * this copy cannot promise something the server will not do. Rendering it
 * from the payload also means the button can say up front which of the two
 * the candidate is about to get.
 */
function PublishControl({
  status,
  needsHuman,
  busy,
  failed,
  onPublish,
}: {
  status: ShareStatus;
  needsHuman: boolean;
  busy: boolean;
  failed: boolean;
  onPublish: () => void;
}) {
  if (status === "revoked" || status === "rejected") return null;
  if (status === "published") {
    return (
      <p className="small muted" style={{ margin: 0 }} data-testid="publish-state">
        Listed in the <Link href="/gallery">public gallery</Link>. Revoking the link removes it from
        there too, immediately.
      </p>
    );
  }
  if (status === "submitted") {
    return (
      <p className="small muted" style={{ margin: 0 }} data-testid="publish-state">
        Waiting for a human. You submitted this to the public gallery; because it carries your own
        work — the site you built, or your own words — a person reads it before it is listed.
        Your link works in the meantime, and revoking it withdraws the submission.
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gap: "0.4rem" }} data-testid="publish-state">
      <div>
        <button type="button" className="btn small-btn" onClick={onPublish} disabled={busy}>
          {busy ? "Submitting…" : "Publish to the gallery"}
        </button>
      </div>
      <p className="faint small" style={{ margin: 0 }}>
        {needsHuman
          ? "Your card carries your own work, so a person reads it before it is listed. It is not public until they say yes."
          : "Your player-type card carries no words of your own, so it is listed as soon as you press this. Revoke the link and it leaves the gallery."}
      </p>
      {failed ? (
        <p className="small" style={{ margin: 0, color: "var(--bad)" }} role="alert">
          That did not reach the gallery. Your link is untouched — try again in a moment.
        </p>
      ) : null}
    </div>
  );
}

export function ShareLink({ attemptId }: { attemptId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [share, setShare] = useState<ShareState | null>(null);
  const [sections, setSections] = useState<ShareSections>({ ...DEFAULT_SHARE_SECTIONS });
  const [note, setNote] = useState("");
  const [hasSite, setHasSite] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishFailed, setPublishFailed] = useState(false);

  const serverId = useCallback(
    () => getServerAttemptId(window.localStorage, attemptId) ?? attemptId,
    [attemptId],
  );

  const request = useCallback(
    async (method: "GET" | "POST" | "DELETE", body?: unknown, suffix = ""): Promise<Response> => {
      const opts = browserApiOptions();
      return opts.fetchFn(`${opts.baseUrl}/attempts/${serverId()}/share${suffix}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(await authHeaders(window.localStorage)),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    [serverId],
  );

  useEffect(() => {
    if (!isServerMode()) return;
    setHasSite(loadSiteSubmission(window.localStorage, attemptId) !== null);
    let live = true;
    void (async () => {
      try {
        const res = await request("GET");
        if (!live) return;
        if (res.ok) {
          const body = (await res.json()) as { share: ShareState };
          setShare(body.share);
          setPhase("live");
        } else {
          setPhase("none");
        }
      } catch {
        if (live) setPhase("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [attemptId, request]);

  if (!isServerMode()) return null;

  const url =
    share === null ? null : `${window.location.origin}${shareUrlPath(share.token, basePath())}`;

  const create = async () => {
    setPhase("busy");
    try {
      const res = await request("POST", {
        sections: { ...sections, site: sections.site && hasSite },
        note: sections.note ? note : "",
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { share: ShareState };
      setShare(body.share);
      setPhase("live");
    } catch {
      setPhase("error");
    }
  };

  /**
   * Ask for the public gallery. The BODY IS EMPTY on purpose: whether this
   * lists immediately or waits for a human is decided server-side from the
   * stored payload (docs/SHARING.md §3), so there is nothing here a client
   * could lie about. The new status comes back from the row.
   */
  const publish = async () => {
    setPublishing(true);
    setPublishFailed(false);
    try {
      const res = await request("POST", undefined, "/publish");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { share?: ShareState };
      if (body.share) setShare(body.share);
    } catch {
      setPublishFailed(true);
    } finally {
      setPublishing(false);
    }
  };

  const revoke = async () => {
    setPhase("busy");
    try {
      const res = await request("DELETE");
      if (!res.ok) throw new Error(String(res.status));
      setShare(null);
      setPhase("none");
    } catch {
      setPhase("error");
    }
  };

  const toggle = (key: ShareSection) => (checked: boolean) =>
    setSections((prev) => ({ ...prev, [key]: checked }));

  return (
    <section className="card" aria-labelledby="share-heading" style={{ marginBottom: "2rem" }}>
      <p className="eyebrow" style={{ margin: 0 }}>share · private until you say so</p>
      <h2 id="share-heading" style={{ margin: "0.2rem 0 0.4rem" }}>Send someone your player type</h2>
      <p className="muted small" style={{ maxWidth: "62ch" }}>
        Creates an unlisted link showing your type, your four-track shape and your band, plus
        whatever else you tick below — never your answers, the items you saw, or anything that
        could identify you. It is not listed anywhere and it is not indexed. Revoke it and it
        stops working immediately, everywhere.
      </p>

      {phase === "loading" ? <p className="faint small" role="status">Checking…</p> : null}

      {phase === "none" || phase === "busy" || phase === "error" ? (
        <>
          <fieldset className="share-sections">
            <legend className="small muted">What goes in the link</legend>
            {SHARE_SECTIONS.map((key) => {
              const disabled = key === "site" && !hasSite;
              return (
                <label key={key} className={`share-section${disabled ? " off" : ""}`}>
                  <input
                    type="checkbox"
                    checked={sections[key] && !disabled}
                    disabled={disabled}
                    onChange={(e) => toggle(key)(e.target.checked)}
                  />
                  <span>
                    <span className="share-section-label">{SECTION_COPY[key].label}</span>
                    <span className="faint small share-section-hint">
                      {disabled ? "You did not submit a site in this run." : SECTION_COPY[key].hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {sections.note ? (
            <p style={{ margin: "0 0 0.8rem" }}>
              <label className="small muted" htmlFor="share-note">
                Your line ({SHARE_NOTE_MAX - note.length} characters left)
              </label>
              <textarea
                id="share-note"
                className="field"
                rows={2}
                maxLength={SHARE_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="I built a portfolio for a bike-repair co-op, and the assistant argued with me twice."
                style={{ width: "100%" }}
              />
            </p>
          ) : null}
          <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn primary" onClick={create} disabled={phase === "busy"}>
              {phase === "busy" ? "Working…" : "Create a share link"}
            </button>
          </div>
        </>
      ) : null}

      {phase === "live" && share && url ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <label className="small muted" htmlFor="share-url">Your link</label>
          <input
            id="share-url"
            className="mono"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: "100%", padding: "0.5rem 0.6rem", borderRadius: 8,
              border: "1px solid var(--border-strong)", background: "var(--bg)", color: "var(--fg)",
            }}
          />
          {/* Copy is the fallback, not the loop: the OS sheet and the three
              networks are the paths a link actually travels down. All of them
              read the same frozen payload (lib/ShareTargets.tsx). */}
          <ShareTargets url={url} payload={share.payload} perspective="mine">
            <a className="btn small-btn" href={url} target="_blank" rel="noreferrer">
              Open it <span aria-hidden>↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <button type="button" className="btn small-btn" onClick={revoke}>Revoke link</button>
            <span className="faint small" role="status">
              {share.views} view{share.views === 1 ? "" : "s"} · {share.status}
            </span>
          </ShareTargets>
          <p className="small muted" style={{ margin: 0 }}>
            This link carries: {includedSections(share.payload).length === 0
              ? "your type, shape and band only"
              : `your type, shape and band, ${includedSections(share.payload)
                  .map((k) => SECTION_COPY[k].label.toLowerCase())
                  .join(", ")}`}
            . A link&rsquo;s contents are frozen when it is made — to change them, revoke it and
            create a new one.
          </p>
          <PublishControl
            status={share.status}
            needsHuman={needsHumanApproval(share.payload)}
            busy={publishing}
            failed={publishFailed}
            onPublish={publish}
          />
          {share.status === "rejected" ? (
            <p className="small" style={{ margin: 0, color: "var(--bad)" }} role="alert">
              A moderator refused this submission for the public gallery, so it is no longer
              served. Their reason: &ldquo;{share.rejectReason}&rdquo; Revoke it and create a new
              link without the part they objected to — or respond below if you think the decision
              was wrong.
            </p>
          ) : null}
          {/* Their side of the moderation record: the messages exchanged about
              this decision, never who wrote them (docs/SHARING.md §7.6). */}
          <CandidateThread attemptId={attemptId} />
        </div>
      ) : null}

      {phase === "error" ? (
        <p className="small" style={{ color: "var(--bad)" }} role="alert">
          That did not work. Your run is saved — try again in a moment.
        </p>
      ) : null}
      <p className="faint small" style={{ marginBottom: 0 }}>
        Anyone with the link can open it without an account. Preview image and page are served by
        AILX from {assetUrl("/s/…")}, so a reader can see where the card came from.
      </p>
    </section>
  );
}
