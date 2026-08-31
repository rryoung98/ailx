"use client";

/**
 * Take your T1 site with you — the offboarding panel.
 *
 * The product principle this serves is in docs/FUTURE-TRACKS.md: AILX is not
 * a site builder and not an agent-hosting platform, so when a candidate wants
 * to go further we hand their work over and point them at real tools. Export
 * READS the scored artifact; it never changes it.
 *
 * Three rungs, in order of certainty (see ./siteExport.ts):
 *   1. Download — always works, no account anywhere, exact scored bytes.
 *   2. GitHub — one public repository in the candidate's own account.
 *   3. Vercel — a deploy link off that repository.
 * Anything the deployment cannot do collapses to the rung below it, and the
 * static export renders nothing at all.
 *
 * The GitHub step states what it is about to do to the candidate's account
 * BEFORE they authorize, and names the scope GitHub actually recorded rather
 * than a string hard-coded here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_EXPORT_REPO_NAME,
  V0_NOTE,
  V0_URL,
  downloadSiteZip,
  pollGithubExport,
  startGithubExport,
  type ExportError,
  type ExportedRepo,
  type GithubAuthorization,
} from "./siteExport";
import { isServerMode } from "./mode";

type Phase = "idle" | "downloading" | "consent" | "authorizing" | "done";

export function SiteExportPanel({ attemptId }: { attemptId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<ExportError | null>(null);
  const [auth, setAuth] = useState<GithubAuthorization | null>(null);
  const [repo, setRepo] = useState<ExportedRepo | null>(null);
  const [repoName, setRepoName] = useState(DEFAULT_EXPORT_REPO_NAME);
  const [githubOffered, setGithubOffered] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const download = useCallback(async () => {
    setError(null);
    setPhase("downloading");
    const result = await downloadSiteZip(window.localStorage, attemptId);
    if (!live.current) return;
    setPhase("idle");
    if (!result.ok) setError(result);
  }, [attemptId]);

  /** One poll, rescheduling itself until GitHub answers something final. */
  const poll = useCallback(
    async (authorization: GithubAuthorization, name: string, deadline: number) => {
      const result = await pollGithubExport(window.localStorage, attemptId, {
        deviceCode: authorization.deviceCode,
        repoName: name,
      });
      if (!live.current) return;
      if (result.ok) {
        setRepo(result.value);
        setPhase("done");
        return;
      }
      if (result.kind !== "pending") {
        setError(result);
        setPhase("consent");
        return;
      }
      if (Date.now() >= deadline) {
        setError({ kind: "authorization_failed", message: "The GitHub code expired — start again." });
        setPhase("consent");
        return;
      }
      // GitHub's own interval, and its slow_down override when it sends one.
      const seconds = result.retryAfterSeconds ?? authorization.intervalSeconds;
      timer.current = window.setTimeout(() => {
        void poll(authorization, name, deadline);
      }, seconds * 1000);
    },
    [attemptId],
  );

  const connect = useCallback(async () => {
    setError(null);
    const started = await startGithubExport(window.localStorage, attemptId);
    if (!live.current) return;
    if (!started.ok) {
      setError(started);
      if (started.kind === "unsupported") setGithubOffered(false);
      setPhase("consent");
      return;
    }
    setAuth(started.value);
    setPhase("authorizing");
    const deadline = Date.now() + started.value.expiresInSeconds * 1000;
    timer.current = window.setTimeout(() => {
      void poll(started.value, repoName, deadline);
    }, started.value.intervalSeconds * 1000);
  }, [attemptId, poll, repoName]);

  if (!isServerMode()) return null;

  return (
    <section className="card" aria-labelledby="site-export-heading" style={{ marginTop: "1rem" }}>
      <p className="eyebrow" style={{ margin: 0 }}>export · your work, your copy</p>
      <h3 id="site-export-heading" style={{ margin: "0.2rem 0 0.4rem" }}>
        Take this site with you
      </h3>
      <p className="muted small" style={{ maxWidth: "62ch" }}>
        AILX is an exam, not a website builder. The site you built is yours: export it and keep
        going somewhere that is built for it. Exporting changes nothing here — the snapshot AILX
        scored stays exactly as it was.
      </p>

      <p style={{ margin: "0.6rem 0" }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => void download()}
          disabled={phase === "downloading"}
        >
          {phase === "downloading" ? "Preparing…" : "Download ZIP"}
        </button>{" "}
        <span className="faint small">
          The exact files that were scored — no account needed, anywhere.
        </span>
      </p>

      {githubOffered && phase !== "done" ? (
        <div style={{ marginTop: "0.8rem" }}>
          {phase === "consent" || phase === "authorizing" ? null : (
            <button type="button" className="btn" onClick={() => setPhase("consent")}>
              Put it on GitHub
            </button>
          )}

          {phase === "consent" ? (
            <>
              <p className="small" style={{ maxWidth: "62ch" }}>
                AILX will ask GitHub for one permission — <code>public_repo</code> — and use it
                once: to create a single PUBLIC repository in your account and push this site into
                it, with a README saying what it is. It cannot see your private repositories, and
                cannot touch any repository it did not just create. The permission is never stored;
                it is used inside that one request and dropped.
              </p>
              <label className="small" htmlFor="ailx-export-repo" style={{ display: "block" }}>
                Repository name
              </label>
              <input
                id="ailx-export-repo"
                type="text"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                style={{ marginBottom: "0.5rem" }}
              />
              <p style={{ margin: 0 }}>
                <button type="button" className="btn primary" onClick={() => void connect()}>
                  Connect GitHub
                </button>{" "}
                <button type="button" className="btn" onClick={() => setPhase("idle")}>
                  Cancel
                </button>
              </p>
            </>
          ) : null}

          {phase === "authorizing" && auth !== null ? (
            <p className="small" role="status" style={{ maxWidth: "62ch" }}>
              Open{" "}
              <a href={auth.verificationUri} target="_blank" rel="noreferrer noopener">
                {auth.verificationUri}
              </a>{" "}
              and enter this code: <strong><code>{auth.userCode}</code></strong>. It grants{" "}
              <code>{auth.scope}</code>. Waiting for you to approve…
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === "done" && repo !== null ? (
        <div style={{ marginTop: "0.8rem" }}>
          <p className="small" style={{ margin: "0 0 0.4rem" }}>
            Pushed to{" "}
            <a href={repo.htmlUrl} target="_blank" rel="noreferrer noopener">
              {repo.owner ? `${repo.owner}/${repo.name}` : repo.name}
            </a>
            .
          </p>
          {repo.deployUrl !== "" ? (
            <p style={{ margin: 0 }}>
              <a
                className="btn primary"
                href={repo.deployUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                Deploy with Vercel
              </a>{" "}
              <span className="faint small">Clones the repository above into your Vercel account.</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="faint small" style={{ margin: "0.8rem 0 0", maxWidth: "62ch" }}>
        {V0_NOTE}{" "}
        <a href={V0_URL} target="_blank" rel="noreferrer noopener">
          v0.app
        </a>
      </p>

      {error !== null ? (
        <p className="small" role="alert" style={{ color: "var(--bad)", marginBottom: 0 }}>
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
