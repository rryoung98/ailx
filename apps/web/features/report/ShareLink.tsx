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
import { API_ROUTES, apiPath, needsHumanApproval, shareUrlPath, type ShareStatus } from "@ailx/contract";
import { TRACK_IDS, type TrackId } from "@ailx/session";
import { serviceHeaders } from "../../lib/data/traceparent";
import { deadline, isTimeout } from "../../lib/data/deadline";
import {
  DEFAULT_SHARE_SECTIONS,
  SHARE_NOTE_MAX,
  SHARE_SECTIONS,
  type SharePayload,
  type ShareSection,
  type ShareSections,
} from "@ailx/report";
import { funnel } from "../../lib/data/funnel";
import { assetUrl, basePath, isServerMode } from "../../lib/mode";
import { ShareTargets } from "../../components/ShareTargets";
import { CandidateThread } from "../../components/Moderation";
import { browserApiOptions, getServerAttemptId } from "../../lib/data/persistence";
import { loadSiteSubmission } from "../../lib/data/siteUpload";

/** Label and one honest line per section. Rendered here and nowhere else. */
const SECTION_COPY: Record<ShareSection, { label: string; hint: string }> = {
  profile: {
    label: "Your strengths and watch-outs",
    hint: "Derived from the same four numbers as your type.",
  },
  process: {
    label: "How you worked",
    hint: "Time per track, how much you iterated, how often you verified. No items, no answers.",
  },
  completed: { label: "The day you finished", hint: "A date, to the day." },
  site: {
    label: "The site you built in T1",
    hint: "Your own work, served live. A human reviews it before it can be listed.",
  },
  note: {
    label: "A line about what you built",
    hint: "Your words, on the card. A human reads it before it can be listed.",
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

/** The four manifest routes this panel drives, and nothing else. */
type ShareRoute = "createShare" | "getShare" | "revokeShare" | "publishShare";

/**
 * The share off the wire, or null when the body is not one. A 200 carrying no
 * share is not a share, and rendering one threw on `share.token` — the same
 * check `scoresOfRecord.ts` makes, for the same reason.
 */
function ownerShare(body: unknown): ShareState | null {
  const record = body as { share?: unknown } | null;
  const share = record?.share as ShareState | undefined;
  return share !== null &&
    typeof share === "object" &&
    typeof share?.token === "string" &&
    typeof share.payload === "object"
    ? share
    : null;
}

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
  timedOut,
  onPublish,
}: {
  status: ShareStatus;
  needsHuman: boolean;
  busy: boolean;
  failed: boolean;
  /** Whether that failure was us giving up waiting, which reads differently. */
  timedOut: boolean;
  onPublish: () => void;
}) {
  if (status === "revoked" || status === "rejected") return null;
  if (status === "published") {
    return (
      <p className="small muted" style={{ margin: 0 }} data-testid="publish-state">
        Listed in the <Link href="/gallery">public gallery</Link>. Revoking the link removes it
        from there at once.
      </p>
    );
  }
  if (status === "submitted") {
    return (
      <p className="small muted" style={{ margin: 0 }} data-testid="publish-state">
        Waiting for a human. Your card carries your own work, so a person reads it before it is
        listed. Your link works meanwhile, and revoking it withdraws the submission.
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
          ? "Your card carries your own work, so a person reads it before it is listed."
          : "Your card carries no words of your own, so it is listed as soon as you press this."}
      </p>
      {failed ? (
        <p className="small" style={{ margin: 0, color: "var(--bad)" }} role="alert">
          {timedOut
            ? "The gallery did not answer in time, so nothing was submitted. It is slow rather than down — your link is untouched, so try again."
            : "That did not reach the gallery. Your link is untouched. Try again in a moment."}
        </p>
      ) : null}
    </div>
  );
}

export function ShareLink({
  attemptId,
  sat,
}: {
  attemptId: string;
  /**
   * Which tracks this sitting covered. A sitting over PART of the instrument
   * has no four-letter type, no character and no band to send, so the card
   * this panel offers must not be described as if it had them (TEN-149).
   */
  sat?: readonly TrackId[];
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [share, setShare] = useState<ShareState | null>(null);
  const [sections, setSections] = useState<ShareSections>({ ...DEFAULT_SHARE_SECTIONS });
  const [note, setNote] = useState("");
  const [hasSite, setHasSite] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishFailed, setPublishFailed] = useState(false);
  /** Whether the failure on screen is "too slow" rather than "did not land". */
  const [timedOut, setTimedOut] = useState(false);
  /** The same fact for the publish button, which has a failure line of its own. */
  const [publishTimedOut, setPublishTimedOut] = useState(false);

  const serverId = useCallback(
    () => getServerAttemptId(window.localStorage, attemptId) ?? attemptId,
    [attemptId],
  );

  /**
   * One call to a share route. The route KEY carries both the path and the
   * method, so a caller cannot pair "DELETE" with the publish path.
   */
  const request = useCallback(
    async (route: ShareRoute, body?: unknown): Promise<Response> => {
      const opts = browserApiOptions();
      /* BOUNDED, by what the route is FOR: asking whether a link exists is a
         `read`, and creating, publishing or revoking one is a `write`. This
         helper passed no signal at all until TEN-210, so a stalled service
         left the panel on "Checking…" — or the button on "Submitting…" —
         for the life of the page. */
      const bound = deadline(route === "getShare" ? "read" : "write");
      try {
        return await opts.fetchFn(`${opts.baseUrl}${apiPath(route, { id: serverId() })}`, {
          method: API_ROUTES[route].method,
          headers: {
            "content-type": "application/json",
            ...(await serviceHeaders(window.localStorage)),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: bound.signal,
        });
      } finally {
        bound.settle();
      }
    },
    [serverId],
  );

  useEffect(() => {
    if (!isServerMode()) return;
    setHasSite(loadSiteSubmission(window.localStorage, attemptId) !== null);
    let live = true;
    void (async () => {
      try {
        const res = await request("getShare");
        if (!live) return;
        /* 404 is the ordinary answer for a sitting nobody has shared yet, and
           it is the OFFER below rather than an error. */
        const held = res.ok ? ownerShare(await res.json()) : null;
        if (held === null) {
          setPhase("none");
          return;
        }
        setShare(held);
        setPhase("live");
      } catch (err) {
        if (!live) return;
        setTimedOut(isTimeout(err));
        setPhase("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [attemptId, request]);

  if (!isServerMode()) return null;

  const url =
    share === null ? null : `${window.location.origin}${shareUrlPath(share.token, basePath())}`;

  /* A PARTIAL SITTING HAS NO TYPE TO SEND. The card's type, shape and band
     are read over the whole instrument; a sitting that covered part of it has
     no four-letter code, no character and no band, so this panel says what
     the link DOES carry rather than promising three things that are not
     there (docs/CREDENTIAL.md §6 makes the same point for the credential). */
  const partial = sat !== undefined && sat.length > 0 && sat.length < TRACK_IDS.length;
  const satList = (sat ?? []).map((t) => t.toUpperCase()).join(" · ");
  const cardCopy = partial
    ? `the tracks you sat (${satList}) and how far you got in each`
    : "your type, your four-track shape and your band";

  const create = async () => {
    setPhase("busy");
    setTimedOut(false);
    try {
      const res = await request("createShare", {
        sections: { ...sections, site: sections.site && hasSite },
        note: sections.note ? note : "",
      });
      if (!res.ok) throw new Error(String(res.status));
      const created = ownerShare(await res.json());
      if (created === null) throw new Error("no share in the response");
      setShare(created);
      setPhase("live");
      // A link now exists. The TOKEN never leaves with this event: it is a
      // capability, and a capability in a metrics table is a leak.
      funnel().step("share_created");
    } catch (err) {
      setTimedOut(isTimeout(err));
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
    setPublishTimedOut(false);
    try {
      const res = await request("publishShare");
      if (!res.ok) throw new Error(String(res.status));
      const published = ownerShare(await res.json());
      if (published !== null) setShare(published);
    } catch (err) {
      setPublishTimedOut(isTimeout(err));
      setPublishFailed(true);
    } finally {
      setPublishing(false);
    }
  };

  const revoke = async () => {
    setPhase("busy");
    setTimedOut(false);
    try {
      const res = await request("revokeShare");
      if (!res.ok) throw new Error(String(res.status));
      setShare(null);
      setPhase("none");
    } catch (err) {
      setTimedOut(isTimeout(err));
      setPhase("error");
    }
  };

  const toggle = (key: ShareSection) => (checked: boolean) =>
    setSections((prev) => ({ ...prev, [key]: checked }));

  return (
    <section className="card" aria-labelledby="share-heading" style={{ marginBottom: "2rem" }}>
      <p className="eyebrow" style={{ margin: 0 }}>share · private until you say so</p>
      <h2 id="share-heading" style={{ margin: "0.2rem 0 0.4rem" }}>
        {partial ? "Send someone this sitting" : "Send someone your player type"}
      </h2>
      <p className="muted small" style={{ maxWidth: "62ch" }} data-testid="share-card-copy">
        Creates an unlisted link with {cardCopy}, plus whatever you tick below. Never your
        answers, the items you saw, or anything that could identify you. It is unlisted and not
        indexed. Revoke it and it stops working everywhere, at once.
      </p>
      {partial ? (
        <p className="small" style={{ maxWidth: "62ch" }} data-testid="share-partial-notice">
          You sat {satList} of the four tracks, so this card carries no four-letter type, no
          character and no band. Those are read over the whole instrument.
        </p>
      ) : null}

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
              read the same frozen payload (components/ShareTargets.tsx). */}
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
              ? `${cardCopy} only`
              : `${cardCopy}, ${includedSections(share.payload)
                  .map((k) => SECTION_COPY[k].label.toLowerCase())
                  .join(", ")}`}
            . Contents are frozen when the link is made. To change them, revoke it and create a
            new one.
          </p>
          <PublishControl
            status={share.status}
            needsHuman={needsHumanApproval(share.payload)}
            busy={publishing}
            failed={publishFailed}
            timedOut={publishTimedOut}
            onPublish={publish}
          />
          {share.status === "rejected" ? (
            <p className="small" style={{ margin: 0, color: "var(--bad)" }} role="alert">
              A moderator refused this for the public gallery, so it is no longer served. Their
              reason: &ldquo;{share.rejectReason}&rdquo; Revoke it and create a new link without
              that part, or reply below if you think they were wrong.
            </p>
          ) : null}
          {/* Their side of the moderation record: the messages exchanged about
              this decision, never who wrote them (docs/SHARING.md §7.6). */}
          <CandidateThread attemptId={attemptId} />
        </div>
      ) : null}

      {phase === "error" ? (
        <p className="small" style={{ color: "var(--bad)" }} role="alert">
          {timedOut
            ? "The exam service did not answer in time. It is slow rather than down — your run is saved, so try again."
            : "That did not work. Your run is saved. Try again in a moment."}
        </p>
      ) : null}
      <p className="faint small" style={{ marginBottom: 0 }}>
        Anyone with the link can open it, no account needed. Foray serves the page and its preview
        image from {assetUrl("/s/…")}, so a reader can see where the card came from.
      </p>
    </section>
  );
}
