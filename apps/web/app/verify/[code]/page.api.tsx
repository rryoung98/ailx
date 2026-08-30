import type { Metadata } from "next";
import Link from "next/link";
import {
  CREDENTIAL_ASSERTS,
  CREDENTIAL_ISSUER,
  CREDENTIAL_LIMITS,
  credentialApiPath,
  credentialName,
} from "@ailx/report";
import { resolveCredential, type CredentialRecord } from "@ailx/backend";
import { pageOrigin, withApiContext } from "../../../lib/server/api";

/**
 * The verification view — the SOURCE OF TRUTH for an AILX credential.
 *
 * `page.api.tsx`, not `page.tsx`: the `.api.*` extensions are only in
 * `pageExtensions` for the AILX_BACKEND=1 build (next.config.mjs), so this
 * database-reading page does not exist in the static GitHub Pages export.
 *
 * WHAT THIS PAGE IS FOR. A stranger — a recruiter, a hiring manager — arrives
 * with a code from a CV and needs three answers: is it real, is it still
 * good, and what does it actually say. So:
 *
 *  * the page reads the row LIVE, so a revocation shows the moment it lands;
 *  * a revoked credential is shown as REVOKED, with its date and reason,
 *    rather than hidden — a share token 404s when revoked because it is a
 *    capability, but a credential code is published and must answer honestly;
 *  * an unknown code gets an explicit "AILX cannot confirm this", never a
 *    blank 404 the reader has to interpret (the JSON twin at
 *    /api/credentials/:code answers 404 for machines);
 *  * what the credential does NOT assert is printed with the same weight as
 *    what it does. Today AILX has no judging pipeline, so there is no score
 *    to claim, and a reader must not be able to infer one.
 *
 * TONE: serious (docs/UX-DIRECTION.md). This is the surface that makes the
 * playful ones affordable — no animation, no streak, no share prompt.
 *
 * NOINDEX: verification is by link, not by search. A credential names a
 * person's sitting; indexing them would build a directory of candidates
 * nobody asked for. It costs a verifier nothing — they arrive with the URL.
 */

export const dynamic = "force-dynamic";

type VerifyParams = { params: Promise<{ code: string }> };

async function readCredential(code: string): Promise<CredentialRecord | null> {
  return withApiContext((ctx) => resolveCredential(ctx.db, code));
}

export async function generateMetadata({ params }: VerifyParams): Promise<Metadata> {
  const { code } = await params;
  const credential = await readCredential(code);
  const robots = { index: false, follow: false };
  if (credential === null) return { title: "AILX — credential not found", robots };
  return {
    title: `${credentialName(credential.claim.instrumentVersion)} — verification`,
    description:
      credential.status === "revoked"
        ? "This AILX credential has been revoked."
        : "Issued by AILX. This page states exactly what the credential asserts, and what it does not.",
    robots,
  };
}

/** A fact too long for a 140px auto-fit column: give it the whole row. */
const WIDE_FACT = { gridColumn: "1 / -1" } as const;

function day(iso: string): string {
  return iso.slice(0, 10);
}

export default async function VerifyPage({ params }: VerifyParams) {
  const { code } = await params;
  const credential = await readCredential(code);
  const origin = await pageOrigin();

  if (credential === null) {
    return (
      <main className="page">
        <div className="container" style={{ maxWidth: 720 }}>
          <p className="eyebrow" style={{ margin: 0 }}>AILX · CREDENTIAL VERIFICATION</p>
          <section className="card verify-card verify-unknown" aria-live="polite">
            <h1 className="verify-status">Cannot be confirmed</h1>
            <p style={{ marginBottom: 0 }}>
              AILX has no credential with this id. Nothing on this page vouches for it — an
              image, a PDF or a screenshot claiming otherwise is not evidence.
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

  const { claim } = credential;
  const revoked = credential.status === "revoked";
  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 720 }}>
        <p className="eyebrow" style={{ margin: 0 }}>AILX · CREDENTIAL VERIFICATION</p>

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
                This credential was issued by {CREDENTIAL_ISSUER} and is current. This page is
                served by AILX and reads the record live, so it is the only thing that can confirm
                the credential — never an image of it.
              </>
            )}
          </p>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>{credentialName(claim.instrumentVersion)}</h2>
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
              <dd className="mono">{claim.completedOn}</dd>
            </div>
            <div>
              <dt>Instrument</dt>
              <dd className="mono">{claim.instrument}</dd>
            </div>
            <div>
              <dt>Tracks attempted</dt>
              <dd className="mono">{claim.tracksAttempted.join(" · ")}</dd>
            </div>
            <div style={WIDE_FACT}>
              <dt>Credential id</dt>
              <dd className="mono" style={{ overflowWrap: "anywhere" }}>{credential.code}</dd>
            </div>
            <div style={WIDE_FACT}>
              <dt>Player type</dt>
              <dd>
                <span className="mono">{claim.playerType.code}</span> — {claim.playerType.name}
              </dd>
            </div>
          </dl>
          {claim.artifact !== null ? (
            <p style={{ marginBottom: 0 }}>
              <a className="btn" href={claim.artifact} target="_blank" rel="noreferrer">
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
            AILX does not yet operate a judging pipeline, so no AILX credential reports a score
            today. When scoring exists, this same credential id will carry the result — the id, the
            URL and the entry on the holder&rsquo;s profile keep working, and this page will say so.
          </p>
        </section>

        <p className="faint small" style={{ marginBottom: 0 }}>
          Machine-readable form (Open Badges 3.0 shape):{" "}
          <a className="mono" href={credentialApiPath(credential.code)}>
            {origin}
            {credentialApiPath(credential.code)}
          </a>
          . Verification is by link, not by search: this page is not indexed.
        </p>
      </div>
    </main>
  );
}
