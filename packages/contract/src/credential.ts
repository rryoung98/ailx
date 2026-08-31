/**
 * The credential WIRE CONTRACT — what the holder's own credential view
 * carries. The issue, revoke and public verification reads are server-side
 * (`@ailx/backend` `credential.ts`); these shapes are what a browser renders.
 */

import type { CredentialClaim, CredentialState, LinkedInCertification } from "@ailx/report";

export interface CredentialRecord extends CredentialState {
  id: string;
  claim: CredentialClaim;
}

/** What the OWNER is shown: the record, plus the metadata they must paste. */
export interface OwnerCredential extends CredentialRecord {
  verifyPath: string;
  linkedIn: LinkedInCertification;
}
