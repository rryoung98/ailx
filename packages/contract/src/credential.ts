/**
 * The credential WIRE CONTRACT — what the holder's own credential view
 * carries. The issue, revoke and public verification reads are server-side
 * (`@ailx/backend` `credential.ts`); these shapes are what a browser renders.
 */

import type { CredentialClaim, CredentialState, LinkedInCertification } from "@ailx/report";
import { z } from "zod";

export interface CredentialRecord extends CredentialState {
  id: string;
  claim: CredentialClaim;
}

/** What the OWNER is shown: the record, plus the metadata they must paste. */
export interface OwnerCredential extends CredentialRecord {
  verifyPath: string;
  linkedIn: LinkedInCertification;
}

// ---------------------------------------------------------------------------
// The public document, as the VERIFICATION PAGE reads it
// ---------------------------------------------------------------------------

/**
 * `/verify/<code>` reads the public, unauthenticated JSON twin
 * (`GET /credentials/<code>`), which answers the derived Open Badges 3.0
 * document — the same bytes a machine verifier gets. That document carries
 * every fact the page prints, wrapped in the OB shape, so ONE pure function
 * unwraps it and every caller (the page and its metadata) reads the same
 * result.
 *
 * It lives HERE, in the contract, rather than in `apps/web`, because it is
 * the reader for a wire body and `API_RESPONSE_SCHEMAS` needs it: the seam
 * validates a route's body from that table, and a second spelling of this
 * shape as a zod schema would be two definitions of one document (TEN-216 —
 * same reasoning as `sharePayloadSchema`).
 *
 * Defensive on purpose: this is a public endpoint whose body a page renders,
 * so a document that is not shaped like ours yields null rather than a page
 * of `undefined`. Pure — no fetch, no env, no clock.
 *
 * The artifact is turned back into a stored PATH rather than used as the
 * absolute URL the document carries: `siteHref()` in `apps/web/lib/mode.ts`
 * is the one place allowed to decide which host serves a snapshot, and it
 * validates the path on the way (docs/ARCHITECTURE.md §10.1).
 */
export interface CredentialView {
  /** The canonical stored code, from the document, not from the URL. */
  readonly code: string;
  /** `credentialName(instrumentVersion)` — the credential's own title. */
  readonly name: string;
  readonly status: "valid" | "revoked";
  readonly issuedAt: string;
  readonly revokedAt: string | null;
  readonly revokeReason: string | null;
  readonly instrument: string;
  readonly completedOn: string;
  readonly tracksAttempted: readonly string[];
  readonly playerType: { readonly code: string; readonly name: string };
  /** A stored `/api/site/...` PATH, or null. Never a host. */
  readonly artifactPath: string | null;
  /** Absolute URL of the machine-readable document itself. */
  readonly documentUrl: string;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The code is the last segment of the document's own status URL. */
function codeFrom(statusId: string): string | null {
  const last = statusId.split("?")[0].split("#")[0].split("/").filter((s) => s !== "").pop();
  return last === undefined || last === "" ? null : decodeURIComponent(last);
}

/**
 * The artifact travels as `<issuer origin><stored path>`. Give the path back,
 * and only when the document really did prefix its own issuer — anything else
 * is a URL this frontend must not resolve.
 */
function artifactPathFrom(artifact: unknown, issuer: string | null): string | null {
  const abs = str(artifact);
  if (abs === null) return null;
  if (issuer !== null && abs.startsWith(issuer)) return abs.slice(issuer.length);
  return abs.startsWith("/") ? abs : null;
}

export function credentialViewFrom(document: unknown): CredentialView | null {
  const doc = obj(document);
  if (doc === null) return null;
  const subject = obj(doc.credentialSubject);
  // The vendor key is `foray` (docs/RENAME.md §3.6). `ailx` is still read
  // because the exam service picks up the renamed `@ailx/report` on its own
  // deploy cadence, and a page that stopped reading the old key would answer
  // "cannot be confirmed" for a real credential in the gap. Read both, emit
  // one: the document builder writes `foray` only.
  const facts = subject === null ? null : (obj(subject.foray) ?? obj(subject.ailx));
  const state = obj(doc.credentialStatus);
  const playerType = facts === null ? null : obj(facts.playerType);
  if (facts === null || state === null || playerType === null) return null;

  const statusId = str(state.id);
  const name = str(doc.name);
  const issuedAt = str(doc.validFrom);
  const instrument = str(facts.instrument);
  const completedOn = str(facts.completedOn);
  const typeCode = str(playerType.code);
  const typeName = str(playerType.name);
  if (statusId === null || name === null || issuedAt === null) return null;
  if (instrument === null || completedOn === null || typeCode === null || typeName === null) {
    return null;
  }
  const code = codeFrom(statusId);
  if (code === null) return null;

  const issuer = obj(doc.issuer);
  return {
    code,
    name,
    // Anything that is not the exact string "revoked" is treated as valid,
    // and a MISSING status is not treated as revoked: a page must not invent
    // a withdrawal, and a real revocation always says so.
    status: state.status === "revoked" ? "revoked" : "valid",
    issuedAt,
    revokedAt: str(state.revokedAt),
    revokeReason: str(state.revokeReason),
    instrument,
    completedOn,
    tracksAttempted: Array.isArray(facts.tracksAttempted)
      ? facts.tracksAttempted.filter((t): t is string => typeof t === "string")
      : [],
    playerType: { code: typeCode, name: typeName },
    artifactPath: artifactPathFrom(facts.artifact, issuer === null ? null : str(issuer.id)),
    documentUrl: statusId,
  };
}

/**
 * The credential document at the seam. `z.unknown().transform(...)` because
 * the reader above IS the definition of this shape; a strict object here
 * would be a second one. A body it refuses becomes `SERVICE_INVALID_COPY` on
 * the page — the service answered with something unreadable, which is a
 * different fact from "no such credential" and must not be shown as one
 * (TEN-216).
 */
export const credentialViewSchema = z.unknown().transform((value, ctx): CredentialView => {
  const view = credentialViewFrom(value);
  if (view === null) {
    ctx.addIssue({ code: "custom", message: "not a Foray credential document" });
    return z.NEVER;
  }
  return view;
});
