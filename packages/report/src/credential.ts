/**
 * The AILX credential — what a person can put on LinkedIn, and what a
 * stranger can check.
 *
 * WHAT IT CLAIMS, AND WHY IT IS SO NARROW. The judging pipeline (spec Phase
 * 4) does not exist and `scores` is empty. A credential that implied a normed
 * score, a pass mark or a standard met would be the one lie that kills a
 * credential body (docs/POSITIONING.md: the neutral-examiner seat is the
 * whole asset). So today the credential asserts exactly one thing —
 * THIS PERSON SAT AND COMPLETED AILX <version> ON <date> — plus the plain
 * facts of that sitting: which tracks they attempted, the playful player type
 * their run produced, and a link to the artifact they built. Everything it
 * does NOT assert is stated on the credential itself (`CREDENTIAL_LIMITS`),
 * so nobody has to guess.
 *
 * THE UPGRADE PATH IS DESIGNED IN, NOT PROMISED. The stored claim carries a
 * `claims` list ("sitting-completed" today) and the served document is
 * DERIVED from that claim at read time. When judging lands, the same
 * credential id gains a `result` block and a "scored" entry in `claims`: the
 * code, the URL and the LinkedIn entry a holder already published keep
 * working, and a verifier reading the document sees the stronger claim
 * appear. No reissue, no broken link, no second credential to explain.
 *
 * VERIFICATION IS THE ARTEFACT — the image is not. Anything shareable points
 * at `/verify/<code>`, which reads the row live and therefore shows a
 * revocation the moment it happens. A screenshot can be forged; the page
 * cannot be, because it is served from this origin and says exactly what the
 * store says.
 *
 * FORMAT: Open Badges 3.0 shape, hosted verification, no crypto dependency.
 * `credentialDocument` emits the W3C VC 2.0 / OB 3.0 field names
 * (`issuer`, `credentialSubject.achievement`, `validFrom`,
 * `credentialStatus`) so an interoperable consumer sees a familiar object and
 * a future signed profile is a field addition rather than a rewrite. We do
 * NOT ship a JSON-LD processor, a DID method or a signing key: an unsigned
 * document plus an authoritative issuer-hosted status endpoint is exactly the
 * "HostedBadge" model, it is what a stranger can actually check, and it costs
 * one dependency-free module.
 *
 * Pure: no clock, no I/O, no randomness. Stamps and codes are injected.
 */
import { TRACK_IDS, type SessionState, type TrackRawScores } from "@ailx/session";
import { playerTypeFor } from "./playerType.js";
import { TRACK_META } from "./tracks.js";

/** Shape version of a STORED claim row, so an old row reads back honestly. */
export const CREDENTIAL_CLAIM_VERSION = 1;

/**
 * The claim kinds a credential can carry. `sitting-completed` is everything
 * that is true today; `scored` is reserved for the judged upgrade and is
 * never emitted until a `scores` row exists (see the module note).
 */
export const CREDENTIAL_CLAIMS = ["sitting-completed", "scored"] as const;
export type CredentialClaimKind = (typeof CREDENTIAL_CLAIMS)[number];

/** Issuing organisation, spelled once — LinkedIn, the page and the JSON. */
export const CREDENTIAL_ISSUER = "AILX";

/** Human name of the credential. Says "completed", never "passed". */
export function credentialName(instrument: string): string {
  return `AILX ${instrument} — Sitting Completed`;
}

/**
 * The code a holder types into LinkedIn's "Credential ID" box: readable,
 * unambiguous, and 80 bits of entropy in four groups of four Crockford
 * base32 characters (no I, L, O or U, so it survives being read aloud).
 */
export const CREDENTIAL_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CREDENTIAL_CODE_GROUPS = 4;
export const CREDENTIAL_CODE_GROUP_LEN = 4;
export const CREDENTIAL_CODE_RE =
  /^AILX-[0-9A-Za-z][0-9A-Za-z.\-]{0,15}-(?:[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-){3}[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;

/**
 * Format a code from raw random bytes. Separated from generation so it is
 * testable without a CSPRNG, and so the alphabet lives in ONE place.
 */
export function formatCredentialCode(instrumentVersion: string, bytes: Uint8Array): string {
  const need = CREDENTIAL_CODE_GROUPS * CREDENTIAL_CODE_GROUP_LEN;
  if (bytes.length < need) throw new Error(`credential code needs ${need} bytes`);
  const chars = Array.from(bytes.slice(0, need), (b) => CREDENTIAL_CODE_ALPHABET[b % 32]);
  const groups: string[] = [];
  for (let i = 0; i < need; i += CREDENTIAL_CODE_GROUP_LEN) {
    groups.push(chars.slice(i, i + CREDENTIAL_CODE_GROUP_LEN).join(""));
  }
  return `AILX-${instrumentVersion}-${groups.join("-")}`;
}

/** Canonical path of the public verification view. */
export function verifyUrlPath(code: string, root = ""): string {
  return `${root}/verify/${encodeURIComponent(code)}`;
}

/** Canonical path of the machine-readable document / status endpoint. */
export function credentialApiPath(code: string, apiRoot = "/api"): string {
  return `${apiRoot}/credentials/${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// The stored claim
// ---------------------------------------------------------------------------

/**
 * The FROZEN facts of one sitting. This is the allowlist: nothing outside
 * this interface is ever stored on, or served from, a credential.
 *
 * Deliberately absent, and each for a reason:
 *  - no composite, band, track value or percentile — that is the judged claim
 *    that does not exist yet, and a band is a comparison to a demo cohort;
 *  - no item id, item text, answer, per-item correctness, confidence or
 *    latency, and no deck or event counts — the same item-integrity boundary
 *    the share payload holds (see share.ts), for the same reason;
 *  - no holder name and no participant reference — AILX cannot verify a name,
 *    and publishing an unverified one would be the credential asserting
 *    something it did not check.
 */
export interface CredentialClaim {
  v: number;
  /** 'ailx 2026.1' — the instrument identity, as the report spells it. */
  instrument: string;
  /** Version alone ('2026.1'), used in the code and the LinkedIn name. */
  instrumentVersion: string;
  /** The day the sitting's last recorded entry landed (YYYY-MM-DD). */
  completedOn: string;
  /** Track codes attempted, in sitting order: ['T1','T2','T3','T4']. */
  tracksAttempted: string[];
  /** The playful four-letter type and its name. Never a score. */
  playerType: { code: string; name: string };
  /** Path of the candidate's own built site, or null. */
  artifact: string | null;
  /** What this credential asserts. Grows on the judged upgrade. */
  claims: CredentialClaimKind[];
}

/** The exact keys of a stored claim — asserted byte-for-byte in the tests. */
export const CREDENTIAL_CLAIM_KEYS = [
  "v",
  "instrument",
  "instrumentVersion",
  "completedOn",
  "tracksAttempted",
  "playerType",
  "artifact",
  "claims",
] as const;

/** Plain-language statement of what the credential says. Shown on /verify. */
export const CREDENTIAL_ASSERTS = [
  "This person sat the AILX examination and completed it on the date shown.",
  "The instrument version and the tracks they attempted are as listed.",
  "The player type is a descriptive read of how that run was played.",
] as const;

/** And what it does NOT say. Shown with equal weight — that is the point. */
export const CREDENTIAL_LIMITS = [
  "It does NOT report a score, a grade, a band or a percentile.",
  "It does NOT certify that any standard was met, or that the holder passed.",
  "It does NOT compare this person to any cohort or population.",
  "It does NOT verify the holder's identity: AILX certifies the sitting, and the person publishing this credential is asserting that the sitting is theirs.",
] as const;

/** Which tracks the run actually reached. Counts only — never item data. */
export function attemptedTrackCodes(state: SessionState): string[] {
  return TRACK_IDS.filter((t) => {
    const track = state.tracks[t];
    return track.status !== "pending" || track.events.length > 0 || track.score !== undefined;
  }).map((t) => TRACK_META[t].code);
}

/** Day of a millisecond stamp, UTC. Pure: reads a stored stamp, never a clock. */
function dayOf(ms: number | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export interface CredentialClaimOptions {
  /** The candidate's own built-site path, when they have one. */
  artifact?: string | null;
}

/**
 * Build the claim for a finished sitting, or null when there is nothing to
 * certify: a run with no completion stamp and no player type is not a
 * sitting, and issuing for one would be the first false claim.
 *
 * The player type reads the run's own behaviour (`playerTypeFor`). The claim
 * is written ONCE, at issue, and `/verify/<code>` serves the stored row — so
 * a later change to how the type is derived can never change what an
 * already-published credential says. Re-deriving one is not how verification
 * works, and a re-issue is a deliberate revoke-then-issue.
 */
export function buildCredentialClaim(
  state: SessionState,
  trackRawOrNull: TrackRawScores | null,
  options: CredentialClaimOptions = {},
): CredentialClaim | null {
  const completedOn = dayOf(state.lastTs);
  const tracksAttempted = attemptedTrackCodes(state);
  if (completedOn === null || trackRawOrNull === null || tracksAttempted.length === 0) return null;
  const version = state.config?.version ?? "2026.1";
  const p = playerTypeFor(state, trackRawOrNull);
  return {
    v: CREDENTIAL_CLAIM_VERSION,
    instrument: `${state.config?.instrument ?? "ailx"} ${version}`,
    instrumentVersion: version,
    completedOn,
    tracksAttempted,
    playerType: { code: p.code, name: p.name },
    artifact: options.artifact ?? null,
    claims: ["sitting-completed"],
  };
}

const str = (v: unknown): string => String(v ?? "");

/**
 * Parse a claim read back out of storage. A malformed or future-shaped row
 * reads as null rather than throwing — a verification view must answer
 * "cannot be confirmed", never 500.
 */
export function parseCredentialClaim(value: unknown): CredentialClaim | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.v !== CREDENTIAL_CLAIM_VERSION) return null;
  const pt = raw.playerType;
  if (typeof pt !== "object" || pt === null) return null;
  const claims = Array.isArray(raw.claims)
    ? raw.claims.filter((c): c is CredentialClaimKind =>
        (CREDENTIAL_CLAIMS as readonly unknown[]).includes(c),
      )
    : [];
  if (claims.length === 0) return null;
  const codes = new Set(Object.values(TRACK_META).map((m) => m.code));
  const tracksAttempted = Array.isArray(raw.tracksAttempted)
    ? raw.tracksAttempted.map(str).filter((c) => codes.has(c as "T1"))
    : [];
  if (tracksAttempted.length === 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(raw.completedOn))) return null;
  return {
    v: CREDENTIAL_CLAIM_VERSION,
    instrument: str(raw.instrument),
    instrumentVersion: str(raw.instrumentVersion),
    completedOn: str(raw.completedOn),
    tracksAttempted,
    playerType: {
      code: str((pt as Record<string, unknown>).code),
      name: str((pt as Record<string, unknown>).name),
    },
    artifact: typeof raw.artifact === "string" ? raw.artifact : null,
    claims,
  };
}

// ---------------------------------------------------------------------------
// The served document
// ---------------------------------------------------------------------------

export type CredentialStatus = "valid" | "revoked";

export interface CredentialState {
  code: string;
  status: CredentialStatus;
  /** ISO stamp the credential was issued. */
  issuedAt: string;
  /** ISO stamp of revocation, or null. */
  revokedAt: string | null;
  /** Why it was revoked — shown verbatim to anyone verifying. */
  revokeReason: string | null;
}

/** VC 2.0 + OB 3.0 contexts. Referenced, never fetched: we do no JSON-LD. */
export const CREDENTIAL_CONTEXT = [
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
] as const;

/**
 * The machine-readable credential, DERIVED from the stored claim and the
 * row's live state. Never stored: that is what makes revocation immediate
 * and what lets the judged upgrade appear without a reissue.
 *
 * `origin` must be an absolute origin (the caller resolves it from
 * AILX_PUBLIC_ORIGIN), so every id in the document is dereferenceable.
 */
export function credentialDocument(
  claim: CredentialClaim,
  state: CredentialState,
  origin: string,
): Record<string, unknown> {
  const id = `${origin}${verifyUrlPath(state.code)}`;
  return {
    "@context": [...CREDENTIAL_CONTEXT],
    id,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    name: credentialName(claim.instrumentVersion),
    description: CREDENTIAL_ASSERTS.join(" "),
    issuer: { id: origin, type: ["Profile"], name: CREDENTIAL_ISSUER },
    validFrom: state.issuedAt,
    credentialSubject: {
      type: ["AchievementSubject"],
      achievement: {
        id: `${origin}/methodology`,
        type: ["Achievement"],
        name: credentialName(claim.instrumentVersion),
        description: CREDENTIAL_ASSERTS.join(" "),
        criteria: { narrative: CREDENTIAL_ASSERTS.join(" ") },
      },
      // The sitting's own plain facts, under one key so an interoperable
      // reader can ignore them and still get a valid OB 3.0 object.
      ailx: {
        instrument: claim.instrument,
        completedOn: claim.completedOn,
        tracksAttempted: [...claim.tracksAttempted],
        playerType: { ...claim.playerType },
        artifact: claim.artifact === null ? null : `${origin}${claim.artifact}`,
        claims: [...claim.claims],
        doesNotAssert: [...CREDENTIAL_LIMITS],
      },
    },
    credentialStatus: {
      id: `${origin}${credentialApiPath(state.code)}`,
      type: "AilxHostedStatus",
      status: state.status,
      ...(state.revokedAt === null ? {} : { revokedAt: state.revokedAt }),
      ...(state.revokeReason === null ? {} : { revokeReason: state.revokeReason }),
    },
  };
}

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

/** The five fields LinkedIn's certification form takes. One definition. */
export interface LinkedInCertification {
  name: string;
  organizationName: string;
  issueYear: number;
  issueMonth: number;
  credentialId: string;
  credentialUrl: string;
}

export function linkedInCertification(
  claim: CredentialClaim,
  state: CredentialState,
  origin: string,
): LinkedInCertification {
  const issued = new Date(state.issuedAt);
  return {
    name: credentialName(claim.instrumentVersion),
    organizationName: CREDENTIAL_ISSUER,
    // getUTCMonth is 0-based; LinkedIn's issueMonth is 1-based.
    issueYear: issued.getUTCFullYear(),
    issueMonth: issued.getUTCMonth() + 1,
    credentialId: state.code,
    credentialUrl: `${origin}${verifyUrlPath(state.code)}`,
  };
}

/**
 * LinkedIn's "Add to profile" deep link. A GET with query parameters — the
 * holder still confirms it on LinkedIn, so this only prefills the form.
 */
export function linkedInAddUrl(cert: LinkedInCertification): string {
  const params = new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: cert.name,
    organizationName: cert.organizationName,
    issueYear: String(cert.issueYear),
    issueMonth: String(cert.issueMonth),
    certId: cert.credentialId,
    certUrl: cert.credentialUrl,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}
