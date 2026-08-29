"use client";

/**
 * Create / copy / revoke the candidate's unlisted share link.
 *
 * PRIVATE BY DEFAULT: nothing exists until this button is pressed, and the
 * second button destroys it. Two separate consents — the derived card, and
 * (only if there is one) the candidate's own live site — because a built site
 * is their creative work, not a derived figure.
 *
 * The plaintext token is returned exactly once, by the create call: the server
 * stores only its sha256. So the URL is kept HERE, in this browser, next to
 * the run it belongs to. If it is lost (cleared storage, another device) the
 * honest answer is "revoke and make a new one", which is what the UI says.
 *
 * Static export: `isServerMode()` is false, there is no backend to share to,
 * and this component renders nothing — no dead buttons (FRONTEND.md §2.3.4).
 */
import { useCallback, useEffect, useState } from "react";
import { DEV_USER_HEADER, shareUrlPath } from "@ailx/backend";
import { assetUrl, basePath, isServerMode } from "./mode";
import { browserApiOptions, devUser, getServerAttemptId } from "./persistence";
import { loadSiteSubmission } from "./siteUpload";

const shareKey = (attemptId: string) => `ailx:share:v1:${attemptId}`;

interface ShareState {
  status: "unlisted" | "submitted" | "published" | "revoked";
  views: number;
}

type Phase = "loading" | "none" | "live" | "busy" | "error";

export function ShareLink({ attemptId }: { attemptId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [share, setShare] = useState<ShareState | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [includeSite, setIncludeSite] = useState(false);
  const [hasSite, setHasSite] = useState(false);
  const [copied, setCopied] = useState(false);

  const serverId = useCallback(
    () => getServerAttemptId(window.localStorage, attemptId) ?? attemptId,
    [attemptId],
  );

  const request = useCallback(
    async (method: "GET" | "POST" | "DELETE", body?: unknown): Promise<Response> => {
      const opts = browserApiOptions();
      return opts.fetchFn(`${opts.baseUrl}/attempts/${serverId()}/share`, {
        method,
        headers: {
          "content-type": "application/json",
          [DEV_USER_HEADER]: devUser(window.localStorage),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    [serverId],
  );

  useEffect(() => {
    if (!isServerMode()) return;
    setHasSite(loadSiteSubmission(window.localStorage, attemptId) !== null);
    setUrl(window.localStorage.getItem(shareKey(attemptId)));
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

  const create = async () => {
    setPhase("busy");
    try {
      const res = await request("POST", { includeSite: includeSite && hasSite });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { share: ShareState & { token?: string } };
      setShare(body.share);
      if (body.share.token) {
        const next = `${window.location.origin}${shareUrlPath(body.share.token, basePath())}`;
        window.localStorage.setItem(shareKey(attemptId), next);
        setUrl(next);
      }
      setPhase("live");
    } catch {
      setPhase("error");
    }
  };

  const revoke = async () => {
    setPhase("busy");
    try {
      const res = await request("DELETE");
      if (!res.ok) throw new Error(String(res.status));
      window.localStorage.removeItem(shareKey(attemptId));
      setUrl(null);
      setShare(null);
      setPhase("none");
    } catch {
      setPhase("error");
    }
  };

  const copy = () => {
    if (!url) return;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <section className="card" aria-labelledby="share-heading" style={{ marginBottom: "2rem" }}>
      <p className="eyebrow" style={{ margin: 0 }}>share · private until you say so</p>
      <h2 id="share-heading" style={{ margin: "0.2rem 0 0.4rem" }}>Send someone your player type</h2>
      <p className="muted small" style={{ maxWidth: "62ch" }}>
        Creates an unlisted link showing your type, your four-track shape and your band — never
        your answers, the items you saw, or anything that could identify you. It is not listed
        anywhere and it is not indexed. Revoke it and it stops working immediately.
      </p>

      {phase === "loading" ? <p className="faint small" role="status">Checking…</p> : null}

      {phase === "none" || phase === "busy" || phase === "error" ? (
        <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn primary" onClick={create} disabled={phase === "busy"}>
            {phase === "busy" ? "Working…" : "Create a share link"}
          </button>
          {hasSite ? (
            <label className="small" style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeSite}
                onChange={(e) => setIncludeSite(e.target.checked)}
              />
              Also share the site I built
            </label>
          ) : null}
        </div>
      ) : null}

      {phase === "live" && share ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {url ? (
            <>
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
            </>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              A link is live, but its address was only ever shown once and this browser no longer
              has it. Revoke it and create a new one.
            </p>
          )}
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
            {url ? (
              <button type="button" className="btn small-btn" onClick={copy}>
                {copied ? "copied ✓" : "Copy link"}
              </button>
            ) : null}
            <button type="button" className="btn small-btn" onClick={revoke}>Revoke link</button>
            <span className="faint small" role="status">
              {share.views} view{share.views === 1 ? "" : "s"} · {share.status}
            </span>
          </div>
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
