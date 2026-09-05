"use client";

/**
 * The verification view — the SOURCE OF TRUTH for an AILX credential.
 *
 * A CLIENT component reading the public, unauthenticated JSON twin
 * (`GET /credentials/<code>`) through `apiBase()`, instead of resolving the
 * row in-process (docs/ARCHITECTURE.md §10.1). No identity is sent: a
 * credential is a public claim, and who is checking it must not change the
 * answer.
 *
 * WHAT THIS PAGE IS FOR. A stranger — a recruiter, a hiring manager — arrives
 * with a code from a CV and needs three answers: is it real, is it still
 * good, and what does it actually say. So:
 *
 *  * the page reads the record LIVE and uncached, so a revocation shows the
 *    moment it lands;
 *  * a revoked credential is shown as REVOKED, with its date and reason,
 *    rather than hidden — a share token 404s when revoked because it is a
 *    capability, but a credential code is published and must answer honestly;
 *  * an unknown code gets an explicit "AILX cannot confirm this", never a
 *    blank 404 the reader has to interpret (the same JSON twin answers 404
 *    for machines);
 *  * a network failure is NOT dressed as "cannot be confirmed". Refusing to
 *    vouch for a real credential because a request timed out would be its own
 *    kind of forgery, so an unreachable service says exactly that;
 *  * what the credential does NOT assert is printed with the same weight as
 *    what it does. Today AILX has no judging pipeline, so there is no score
 *    to claim, and a reader must not be able to infer one.
 *
 * TONE: serious (docs/UX-DIRECTION.md). This is the surface that makes the
 * playful ones affordable — no animation, no streak, no share prompt.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiPath } from "@ailx/contract";
import { CREDENTIAL_ASSERTS, CREDENTIAL_ISSUER, CREDENTIAL_LIMITS } from "@ailx/report";
import { credentialViewFrom } from "./credentialView";
import { siteHref } from "../../lib/mode";
import { PageError, PageLoading } from "../../components/PageNotice";
import { serviceRefusedCopy, useService } from "../../lib/data/serviceFetch";

const EYEBROW = "AILX · CREDENTIAL VERIFICATION";

/** A fact too long for a 140px auto-fit column: give it the whole row. */
const WIDE_FACT = { gridColumn: "1 / -1" } as const;

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** The code is unknown, or the document was not one of ours. */
function CannotConfirm() {
  return (
  <main className="page">
    <div className="container" style={{ maxWidth: 720 }}>
      <p className="eyebrow" style={{ margin: 0 }}>{EYEBROW}</p>
      <section className="card verify-card verify-unknown" aria-live="polite">
        <h1 className="verify-status">Cannot be confirmed</h1>
        <p style={{ marginBottom: 0 }}>
          AILX has no credential with this id. Nothing on this page vouches for it. An image,
          PDF or screenshot claiming otherwise is not evidence.
        </p>
      </section>
      <p className="small muted">
        Codes look like <span className="mono">AILX-2026.1-XXXX-XXXX-XXXX-XXXX</span>. Check for
        a typo, then ask the holder for the credential URL itself.
      </p>
      <p className="small">
        <Link href="/methodology">What AILX measures</Link>
      </p>
    </div>
  </main>
  );
}

export function VerifyView() {
  const params = useParams<{ code: string }>();
  const code = typeof params?.code === "string" ? params.code : null;
  // A CAPABILITY read: the code in the URL is the whole claim, so the answer
  // must not depend on who is holding it. Anonymous is spelled out because
  // every call site now says which identity it wants, and silence is what
  // let `/world` ask with none by accident (TEN-107).
  const result = useService<unknown>(
    code === null ? null : apiPath("credentialView", { code }),
    { identity: "anonymous" },
  );
  if (result.state === "loading") {
    return <PageLoading eyebrow={EYEBROW} title="Checking this credential" />;
  }
  if (result.state === "error") {
    return <PageError eyebrow={EYEBROW} title="Checking this credential" message={result.message} />;
  }
  // 404 is the honest "no such credential". Any other refusal is neither a
  // verdict nor an outage: the service was reached and said no, and the page
  // says which (TEN-107).
  if (result.state === "missing") {
    return result.status === 404 ? (
      <CannotConfirm />
    ) : (
      <PageError
        eyebrow={EYEBROW}
        title="Checking this credential"
        message={serviceRefusedCopy(result.status, result.reason)}
      />
    );
  }
  const credential = credentialViewFrom(result.data);
  if (credential === null) return <CannotConfirm />;

  const revoked = credential.status === "revoked";
  // The document carries the site PATH under the issuer's origin; which host
  // serves it is a deployment fact resolved by lib/mode.ts, never payload data.
  const artifact = siteHref(credential.artifactPath);
  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 720 }}>
        <p className="eyebrow" style={{ margin: 0 }}>{EYEBROW}</p>

        <section
          className={`card verify-card ${revoked ? "verify-revoked" : "verify-valid"}`}
          aria-live="polite"
        >
          <h1 className="verify-status">{revoked ? "Revoked" : "Verified"}</h1>
          <p style={{ margin: 0 }}>
            {revoked ? (
              <>
                This credential was withdrawn on{" "}
                <span className="mono">{day(credential.revokedAt ?? "")}</span> and should not be
                relied on. Reason given: <em>{credential.revokeReason}</em>
              </>
            ) : (
              <>
                This credential was issued by {CREDENTIAL_ISSUER} and is current. AILX serves
                this page and reads the record live, so only this page can confirm the credential.
                Never an image of it.
              </>
            )}
          </p>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>{credential.name}</h2>
          {/* `.verify-facts` is a 140px auto-fit grid, which is right for a
              date and wrong for the two long values: the 29-character
              credential id — the one fact a checker copies — broke across
              four lines. Those two claim a full row instead of being
              hyphenated into confetti. */}
          <dl className="verify-facts">
            <div>
              <dt>Issued by</dt>
              <dd>{CREDENTIAL_ISSUER}</dd>
            </div>
            <div>
              <dt>Issued on</dt>
              <dd className="mono">{day(credential.issuedAt)}</dd>
            </div>
            <div>
              <dt>Sitting completed on</dt>
              <dd className="mono">{credential.completedOn}</dd>
            </div>
            <div>
              <dt>Instrument</dt>
              <dd className="mono">{credential.instrument}</dd>
            </div>
            <div>
              <dt>Tracks attempted</dt>
              <dd className="mono">{credential.tracksAttempted.join(" · ")}</dd>
            </div>
            <div style={WIDE_FACT}>
              <dt>Credential id</dt>
              <dd className="mono" style={{ overflowWrap: "anywhere" }}>{credential.code}</dd>
            </div>
            <div style={WIDE_FACT}>
              <dt>Player type</dt>
              <dd>
                <span className="mono">{credential.playerType.code}</span> — {credential.playerType.name}
              </dd>
            </div>
          </dl>
          {artifact !== null ? (
            <p style={{ marginBottom: 0 }}>
              <a className="btn" href={artifact} target="_blank" rel="noreferrer">
                Open the site they built <span aria-hidden>↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          ) : null}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>What this credential asserts</h2>
          <ul className="verify-list">
            {CREDENTIAL_ASSERTS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h2>What it does not assert</h2>
          <ul className="verify-list verify-limits">
            {CREDENTIAL_LIMITS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="small muted" style={{ marginBottom: 0 }}>
            AILX has no judging pipeline yet, so no AILX credential reports a score today. When
            scoring exists, this same credential id carries the result. The id, the URL and the
            holder&rsquo;s profile entry keep working, and this page will say so.
          </p>
        </section>

        <p className="faint small" style={{ marginBottom: 0 }}>
          Machine-readable form (Open Badges 3.0 shape):{" "}
          <a className="mono" href={credential.documentUrl}>
            {credential.documentUrl}
          </a>
          . Verification is by link, not by search: this page is not indexed.
        </p>
      </div>
    </main>
  );
}
