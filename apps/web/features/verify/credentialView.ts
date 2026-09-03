/**
 * The credential document, as the VERIFICATION PAGE needs it.
 *
 * `/verify/<code>` used to read the `credentials` row in-process. It now
 * reads the public, unauthenticated JSON twin (`GET /credentials/<code>`),
 * which answers the derived Open Badges 3.0 document — the same bytes a
 * machine verifier gets. That document carries every fact the page prints,
 * but wrapped in the OB shape, so ONE pure function unwraps it and every
 * caller (the page and its metadata) reads the same result.
 *
 * Defensive on purpose: this is a public endpoint whose body a page renders,
 * so a document that is not shaped like ours yields null rather than a page
 * of `undefined`. Pure — no fetch, no env, no clock — so it is cheap to test
 * exhaustively.
 *
 * The artifact is turned back into a stored PATH rather than used as the
 * absolute URL the document carries: `siteHref()` in `lib/mode.ts` is the one
 * place allowed to decide which host serves a snapshot, and it validates the
 * path on the way (see docs/ARCHITECTURE.md §10.1).
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
  const ailx = subject === null ? null : obj(subject.ailx);
  const state = obj(doc.credentialStatus);
  const playerType = ailx === null ? null : obj(ailx.playerType);
  if (ailx === null || state === null || playerType === null) return null;

  const statusId = str(state.id);
  const name = str(doc.name);
  const issuedAt = str(doc.validFrom);
  const instrument = str(ailx.instrument);
  const completedOn = str(ailx.completedOn);
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
    tracksAttempted: Array.isArray(ailx.tracksAttempted)
      ? ailx.tracksAttempted.filter((t): t is string => typeof t === "string")
      : [],
    playerType: { code: typeCode, name: typeName },
    artifactPath: artifactPathFrom(ailx.artifact, issuer === null ? null : str(issuer.id)),
    documentUrl: statusId,
  };
}
