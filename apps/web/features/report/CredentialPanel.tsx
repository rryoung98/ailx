"use client";

/**
 * Issue, publish and revoke the holder's AILX credential.
 *
 * WHAT THIS PANEL IS CAREFUL ABOUT. A credential is the one artefact a
 * stranger will act on, so the copy here must never promise more than
 * /verify will confirm: it says "completed", never "passed", and it prints
 * the same `CREDENTIAL_LIMITS` the verification page prints. Every field a
 * holder pastes into LinkedIn is computed SERVER-side from the stored claim
 * (name, organisation, issue date, credential id, credential URL), so the two
 * can never drift.
 *
 * The code is public and idempotent: pressing the button twice returns the
 * same credential, because a published code must never be silently orphaned.
 * Revoking keeps the URL alive and makes it say "revoked" — the honest answer
 * to anyone already holding it.
 *
 * Static export: `isServerMode()` is false, there is nothing to issue against
 * and this component renders nothing (FRONTEND.md §2.3.4).
 */
import { useCallback, useEffect, useState } from "react";
import { API_ROUTES, apiPath, type OwnerCredential } from "@ailx/contract";
import { serviceHeaders } from "../../lib/data/traceparent";
import { CREDENTIAL_LIMITS, linkedInAddUrl } from "@ailx/report";
import { basePath, isServerMode } from "../../lib/mode";
import { browserApiOptions, getServerAttemptId } from "../../lib/data/persistence";

type Phase = "loading" | "none" | "live" | "busy" | "error";

/** The three manifest routes this panel drives — one path, three methods. */
type CredentialRoute = "issueCredential" | "getCredential" | "revokeCredential";

export function CredentialPanel({ attemptId }: { attemptId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [credential, setCredential] = useState<OwnerCredential | null>(null);
  const [copied, setCopied] = useState(false);

  const request = useCallback(
    async (route: CredentialRoute): Promise<Response> => {
      const opts = browserApiOptions();
      const id = getServerAttemptId(window.localStorage, attemptId) ?? attemptId;
      return opts.fetchFn(`${opts.baseUrl}${apiPath(route, { id })}`, {
        method: API_ROUTES[route].method,
        headers: {
          "content-type": "application/json",
          ...(await serviceHeaders(window.localStorage)),
        },
      });
    },
    [attemptId],
  );

  useEffect(() => {
    if (!isServerMode()) return;
    let live = true;
    void (async () => {
      try {
        const res = await request("getCredential");
        if (!live) return;
        if (res.ok) {
          setCredential(((await res.json()) as { credential: OwnerCredential }).credential);
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
  }, [request]);

  if (!isServerMode()) return null;

  const url =
    credential === null
      ? null
      : `${window.location.origin}${basePath()}${credential.verifyPath}`;

  const act = async (route: "issueCredential" | "revokeCredential") => {
    setPhase("busy");
    try {
      const res = await request(route);
      if (!res.ok) throw new Error(String(res.status));
      if (route === "revokeCredential") {
        setCredential(null);
        setPhase("none");
        return;
      }
      setCredential(((await res.json()) as { credential: OwnerCredential }).credential);
      setPhase("live");
    } catch {
      setPhase("error");
    }
  };

  const copy = () => {
    if (url === null) return;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <section className="card" aria-labelledby="credential-heading" style={{ marginBottom: "2rem" }}>
      <p className="eyebrow" style={{ margin: 0 }}>credential · checkable by anyone</p>
      <h2 id="credential-heading" style={{ margin: "0.2rem 0 0.4rem" }}>
        Put this sitting on your profile
      </h2>
      <p className="muted small" style={{ maxWidth: "62ch" }}>
        A credential states that you sat and completed AILX on a date, on a stated instrument
        version, and gives a link anyone can check. It carries no score: AILX does not operate a
        judging pipeline yet, so no AILX credential claims one. When scoring exists, this same
        credential id gains the result — you will not need to reissue it.
      </p>
      <ul className="verify-list verify-limits small">
        {CREDENTIAL_LIMITS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {phase === "loading" ? <p className="faint small" role="status">Checking…</p> : null}

      {phase === "none" || phase === "busy" || phase === "error" ? (
        <p style={{ marginBottom: 0 }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => act("issueCredential")}
            disabled={phase === "busy"}
          >
            {phase === "busy" ? "Working…" : "Issue my credential"}
          </button>
          {phase === "error" ? (
            <span className="small" style={{ marginLeft: "0.6rem", color: "var(--bad)" }} role="alert">
              That did not work. Finish and score every track first, then try again.
            </span>
          ) : null}
        </p>
      ) : null}

      {phase === "live" && credential !== null && url !== null ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <label className="small muted" htmlFor="credential-url">Verification link</label>
          <input
            id="credential-url"
            className="mono"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: "100%", padding: "0.5rem 0.6rem", borderRadius: 8,
              border: "1px solid var(--border-strong)", background: "var(--bg)", color: "var(--fg)",
            }}
          />
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn small-btn" onClick={copy}>
              {copied ? "copied ✓" : "Copy link"}
            </button>
            <a
              className="btn small-btn"
              href={linkedInAddUrl(credential.linkedIn)}
              target="_blank"
              rel="noreferrer"
            >
              Add to LinkedIn <span aria-hidden>↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a className="btn small-btn" href={url} target="_blank" rel="noreferrer">
              See what a stranger sees <span aria-hidden>↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <button type="button" className="btn small-btn" onClick={() => act("revokeCredential")}>
              Revoke
            </button>
          </div>
          <dl className="verify-facts">
            <div>
              <dt>Name</dt>
              <dd style={{ fontSize: "1rem" }}>{credential.linkedIn.name}</dd>
            </div>
            <div>
              <dt>Issuing organisation</dt>
              <dd style={{ fontSize: "1rem" }}>{credential.linkedIn.organizationName}</dd>
            </div>
            <div>
              <dt>Issue date</dt>
              <dd className="mono" style={{ fontSize: "1rem" }}>
                {credential.linkedIn.issueMonth}/{credential.linkedIn.issueYear}
              </dd>
            </div>
            <div>
              <dt>Credential id</dt>
              <dd className="mono" style={{ fontSize: "0.9rem" }}>{credential.linkedIn.credentialId}</dd>
            </div>
          </dl>
          <p className="small muted" style={{ margin: 0 }}>
            Those are the four fields LinkedIn asks for; the link above is the credential URL.
            Revoking keeps the link working and makes it say <strong>revoked</strong> — anyone who
            already has it learns the truth instead of hitting a dead page.
          </p>
        </div>
      ) : null}
    </section>
  );
}
