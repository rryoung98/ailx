# The Foray credential — what it claims, and how a stranger checks it

Recorded 2026-08-29, alongside the skill diagnosis on `/report`. Code:
`packages/report/src/credential.ts` (the claim and the document),
`packages/backend/src/credential.ts` (issue / revoke / verify),
`apps/web/app/verify/[code]/page.api.tsx` (the public view).

## 1. The assumption this design rests on — correct it if it is wrong

**Foray has no judging pipeline (spec Phase 4), and the `scores` table is
empty.** So a credential cannot honestly report a score, a band, a percentile
or a pass mark, and this one does not. It asserts exactly:

> *This person sat Foray `<version>` and completed it on `<date>`; they
> attempted these tracks; their run produced this player type; here is the
> artifact they built.*

Everything it refuses to say is printed **on the credential itself**
(`CREDENTIAL_LIMITS`), including the one most people will assume: Foray does
not verify the holder's identity. Foray certifies the SITTING. The person
publishing the credential is asserting the sitting is theirs, exactly as a
LinkedIn certification entry is a self-published claim pointing at an
issuer-hosted record.

If the product decides a completion-only credential is not worth issuing, the
answer is to build judging first — not to widen the claim.

## 2. Why it can be upgraded without reissuing

The stored row is a FROZEN claim; the served document is DERIVED from it at
read time (`credentialDocument`). Two consequences, both deliberate:

- a revocation is visible immediately, because nothing was pre-baked;
- when judging lands, the same credential id gains a `result` block and a
  `scored` entry in `claims`. Every already-published URL, credential id and
  LinkedIn entry keeps working and starts carrying the stronger claim.
  `parseCredentialClaim` already round-trips a `scored` claim, so a row
  written by that future code reads back today rather than 500ing.

## 3. Format: Open Badges 3.0 shape, hosted verification, no crypto

An examiner nobody has audited yet should not invent a credential format
(`docs/POSITIONING.md`), so the document uses W3C VC 2.0 / Open Badges 3.0
field names: `@context`, `type: ["VerifiableCredential","OpenBadgeCredential"]`,
`issuer`, `credentialSubject.achievement`, `validFrom`, `credentialStatus`.

What we deliberately did NOT take on:

- **no JSON-LD processor.** We emit the context URLs; we never fetch or expand
  them. A consumer that cares can.
- **no signing key, no DID method, no status list.** An unsigned document plus
  an authoritative, issuer-hosted status endpoint is precisely Open Badges'
  "HostedBadge" model. It is what a human verifier actually does — follow the
  link — and it costs one dependency-free module. A signed profile is a field
  addition (`proof`) on the same document when there is a key-management story
  worth having.

The Foray-specific facts live under one key, `credentialSubject.ailx`, so a
strict Open Badges reader can ignore them and still get a valid object.

## 4. A credential is NOT a share link

| | share link (`/s/<token>`) | credential (`/verify/<code>`) |
|---|---|---|
| identity | capability: possession of the token IS the authorization | public claim, published on a CV |
| revoked | 404 — indistinguishable from never-issued, so a revocation cannot be confirmed | **resolves**, and says "revoked on `<date>`, because `<reason>`" |
| entropy | 256 bits, because the token is the secret | 80 bits, only to make enumeration pointless |
| indexing | noindex (unlisted) | noindex (verification is by link; a search directory of candidates is not the goal) |

Verification that cannot say "revoked" is not verification. That single
difference drives the whole table.

## 5. Anti-forgery

The verification VIEW is the artefact, not any image. The panel on `/report`
never renders a badge image, and `/verify` says out loud that a screenshot or
a PDF proves nothing. An unknown code gets "Cannot be confirmed" in words —
never a bare 404 the reader has to interpret — while the JSON twin
(`/api/credentials/<code>`) answers 404 for machines. Neither is cached.

## 6. LinkedIn

`linkedInCertification` computes the five fields LinkedIn's certification form
takes — name, issuing organisation, issue year, issue month (1-based, unlike
JavaScript's), credential id, credential URL — SERVER-side from the stored
claim, and `linkedInAddUrl` prefills the "Add to profile" deep link with them.
The panel displays the same fields, so a holder filling the form by hand
cannot produce a different entry from the one the button produces.

The credential NAME says "Sitting Completed". Not "certified", not "passed",
not "level". That wording is asserted in the tests, because it is the one line
a growth incentive will try to soften.

## 7. Diagnosis, and why it is the other half of this work

`packages/report/src/diagnosis.ts` turns a finished run into a next action —
strongest track, weakest track, the process habit behind it, and the drill
that targets it. It reads only the four aggregates and the share payload's
allowlisted process subset (`shareProcessFrom`), so no item, answer, deck size
or event count can reach it and the text is invariant to bank content. It
carries `DIAGNOSIS_BASIS` for the same reason `PROGRESS_BASIS` exists: a
figure that implies a judged score would be a claim we cannot back.
