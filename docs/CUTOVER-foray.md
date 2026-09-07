# Cutover: the origin moves to `foray.tenken.co`

Status: **planned, nothing cut over.** No DNS record was created, no Terraform
was applied, no environment variable was flipped and no Vercel project was
touched by the branches that carry this document. Date: 2026-09-07.
Branches: `w/foray-domain` (public), `w/foray-origin` (private).
Parent: `docs/RENAME.md` — this document EXECUTES its steps 1-3 and the domain
half of its step 13, and contradicts none of steps 8-15 (§8).
Yardstick: `docs/ADR-redis.md` — a measurement before a preference, and a named
thing that can go wrong before a recommendation.

The founder decided to skip a second Vercel subdomain and issue from a domain
we own. This document is the ordered sequence, because the expensive half of
this work is not the change, it is the order.

## 1. What is being moved, and what is not

One string moves: the origin a browser reaches, from
`https://ailx-staging.vercel.app` to `https://foray.tenken.co`.

Three things travel with it because they are derived from it or point at it:

| | today | after |
|---|---|---|
| `AILX_PUBLIC_ORIGIN` (Vercel env var) | `https://ailx-staging.vercel.app` | `https://foray.tenken.co` |
| `allowed_origins` (Terraform, both envs) | Pages + `ailx-staging.vercel.app` | Pages + both hostnames, then Pages + `foray.tenken.co` |
| `model_callback_url` (Terraform, `staging`) | `https://ailx-staging.vercel.app/exam` | `https://foray.tenken.co/exam` |

Three things do NOT move, and confusing any of them with the origin is how this
goes wrong:

- **`public_origin` in Terraform is the SERVICE's own origin**, the Cloud Run
  URL. It is not the browser origin and it does not change here.
- **`NEXT_PUBLIC_AILX_API_BASE`** points the browser at the exam service. The
  service is not moving. `docs/RENAME.md` step 10 moves it, later, separately.
- **The Clerk instance.** `foray.tenken.co` implies the production instance, but
  it does not require it in the same window. §4 is the whole argument.

## 2. The credential rule, and why it is free exactly once

`docs/CREDENTIAL.md` §3 states the rule this cutover has to survive: **a Foray
credential's issuer IS its origin.** No key, no DID, no signature, no status
list. Verification is two live dereferences against the origin baked into the
document — `${origin}/verify/<code>` for a human and
`${origin}/api/credentials/<code>` for a machine. An origin that stops answering
does not degrade a credential. It ends it. And a revoked credential is supposed
to keep RESOLVING and say "revoked", which it cannot do from a dead host.

`docs/RENAME.md` §3.5 drew the correct conclusion from that rule: the legacy
hostname answers forever, reduced to two 301 routes, and the Vercel project is
never renamed, because renaming RELEASES `ailx-staging.vercel.app` back to
Vercel's global pool where a stranger can claim it — at an address our
credentials point at.

**We are not paying that this time, and here is the evidence.** There are four
credential rows in the store. All four are ours:

- three issued 2026-08-29 and 2026-08-30 against `dev:` asserted identities.
  Two of those three are already revoked;
- one `FORAY-2026.1-…` issued 2026-09-06 against the Clerk test account used
  for a dogfood run.

No credential is held by a person outside this team. Nobody has typed one of
these codes into LinkedIn's "Credential ID" box. So the rule protects our own
test rows and nothing else, and retiring the hostname costs nothing real.

**Say the next sentence out loud, because it is the entire reason this document
exists.** This was safe ONLY because every credential was ours. The next origin
move will not be. The moment one credential is held by somebody we cannot phone,
§3.5 comes back in full force and the two 301 routes are not optional. **This is
the last time retiring an origin is free.**

The corollary, in advance: **before Foray issues a credential to a stranger,
the origin must be one we intend to keep forever.** `foray.tenken.co` is that
origin. That is the reason to move now rather than after the first real sitting.

### 2.1 The four rows: archive, not delete

The founder asked for the four rows to be removed. The house precedent decides
how. `db/migrations/0008_archive_dev_identity_rows.sql` faced the same question
about orphaned rows and argued: `responses` and `transcripts` are append-only,
a hard `DELETE` is an exception to the invariant this store is built on, and an
IRREVERSIBLE exception cannot be justified when the reason to run it is
housekeeping. So the rows MOVE to an `archive` schema — same columns, same
values, same ids, one `archived_at` stamp — and the down migration puts them
back.

That is what the private repo's migration does. It is the same shape as 0008
and it is reversible.

**Be honest about the reason, because the obvious reason is wrong.** The origin
is NOT stored in a credential row. `credentialDocument` derives it at read time
from `AILX_PUBLIC_ORIGIN`, which is exactly why an already-issued credential
survives an origin change at all (`docs/CREDENTIAL.md` §2,
`docs/RENAME.md` §3.3). These four rows would resolve perfectly well from
`foray.tenken.co` after the cutover. Nothing breaks them. They are archived
because they are test data, and leaving test sittings in a store that is about
to start taking real ones is how a population statistic gets quietly wrong
(`docs/SAMPLING.md`). Hygiene is a good enough reason. Pretending they were
broken is not.

**Why not revoke instead.** Revocation is the weaker option and the founder is
right about why: `docs/CREDENTIAL.md` §4 promises a revoked credential still
resolves and says "revoked on `<date>`, because `<reason>`". Two of the four are
already revoked, and that promise is the only thing their rows are still doing.
A revocation that cannot be read is not a revocation. Archiving is honest about
removing the row; revoking pretends to keep a promise it has stopped keeping.

## 3. The ordered cutover

Measured 2026-09-07 by `dig`, not assumed:

- `foray.tenken.co` — **no record of any kind.** This is the whole gate.
- `www.foray.tenken.co` — no record.
- `clerk.foray.tenken.co` → `frontend-api.clerk.services` → `worker.clerkprod-cloudflare.net`
- `accounts.foray.tenken.co` → `accounts.clerk.services` → same Clerk production edge
- `clkmail.foray.tenken.co` → `mail.t6nl0m3l8wcf.clerk.services` → SendGrid
- `tenken.co` → `216.198.79.1` (Vercel apex), `www.tenken.co` → a Vercel
  per-project CNAME target

So `docs/RENAME.md` step 1 is **already done**: the Clerk production instance
for `foray.tenken.co` is provisioned and its DNS is live. It is unused. Nothing
points at it. Step 1 is not on this list because there is nothing left to do in
it.

| # | step | who | rollback |
|---|---|---|---|
| 1 | Add `foray.tenken.co` to the EXISTING `ailx-staging` Vercel project as an additional domain. Copy the exact CNAME target Vercel prints and create that DNS record | founder | delete the DNS record and remove the domain |
| 2 | Verify: `foray.tenken.co` serves the same deployment as `ailx-staging.vercel.app`, over valid TLS, on both hostnames | — | — |
| 3 | Merge the private PR. Dispatch Terraform `apply` for **`staging`** (the live service) and for `resilient-staging`. Both hostnames are now in `allowed_origins` | founder | re-apply the previous tfvars |
| 4 | Verify: a CORS preflight from `Origin: https://foray.tenken.co` is accepted by the live service, and the old origin still is | — | — |
| 5 | Add `https://foray.tenken.co/exam` to the OpenRouter client's registered redirect allowlist, then flip `model_callback_url` and apply | founder | flip back |
| 6 | Flip `AILX_PUBLIC_ORIGIN` to `https://foray.tenken.co` in Vercel. Redeploy | founder | flip back and redeploy |
| 7 | Verify: a newly issued credential's `id`, `credentialStatus.id` and `achievement.id` all name `foray.tenken.co`; `/verify/<code>` resolves; the T1 served-site CSP carries the new origin and a candidate site loads with subresources intact | — | revert step 6 |
| 8 | Watch for one week. Both hostnames serve. Nothing is released yet | — | — |
| 9 | Apply the credential archive migration, after a backup and after reading the census | founder | the down migration |
| 10 | Remove `https://ailx-staging.vercel.app` from `allowed_origins` in both tfvars. Apply. Verify a preflight from the old origin is now REFUSED | founder | re-add and apply |
| 11 | **Rename the Vercel project `ailx-staging` → `foray-staging`. POINT OF NO RETURN** | founder | **none** |

### 3.1 Why step 10 must come before step 11, without exception

The rename releases `ailx-staging.vercel.app` to Vercel's global pool. A
stranger can then claim it and serve whatever they like from that hostname.

If `https://ailx-staging.vercel.app` is still in `allowed_origins` at that
moment, we have handed an attacker-controlled origin a CORS grant against the
live exam service, including every `/v1/model/*` route that spends a
candidate's sealed provider key. That is not a tidiness bug.

The same argument applies harder to `model_callback_url` (step 5), which is the
OpenRouter PKCE return URL. Leave it pointing at a released hostname and the
authorization `code` arrives in a stranger's query string.

**Remove the old origin from every allowlist first. Rename second. There is no
version of this that is safe in the other order.**

### 3.2 Rename, not delete, and not a new project

The founder asked for the simplest path. That is a **rename of the existing
project**, not a new one.

A rename keeps the project's environment variables, its domain attachments, its
deployment history and its Git connection. A new project rebuilds all four by
hand, and the failure mode of rebuilding environment variables by hand is a
missing `AILX_PUBLIC_ORIGIN`, which `docs/RENAME.md` §7.2 already names: the
service boots with an undefined origin and `credentialDocument` emits a
relative id. `docs/RENAME.md` step 13 preferred a new project only because the
old one had to stay alive to serve the 301s. That requirement is cancelled, so
the reason for a new project is cancelled with it.

Deleting is worse than renaming and buys nothing. A rename releases the
hostname; a delete releases the hostname AND the history.

### 3.3 Which steps have no rollback

**Step 11 only.** Everything above it is a DNS record, an environment variable,
a Terraform variable or a reversible migration, and every one of those is undone
by putting the old value back.

Step 11 cannot be undone. Renaming back works only while nobody has claimed
`ailx-staging.vercel.app` in the gap, and that is not a rollback, it is a race
we would be relying on. Treat step 11 as final.

Step 9 has a down migration, so it rolls back — but only while the archived rows
are still in the `archive` schema. Do not follow it with a cleanup that drops
them.

## 4. Clerk: the expensive half

### 4.1 The question

`foray.tenken.co` implies the Clerk PRODUCTION instance, whose DNS is already
live at `clerk.foray.tenken.co`. Staging today runs the DEVELOPMENT instance
(`ethical-ram-3554`), whose publishable key the frontend ships.

**Every instance switch orphans `auth_ref`.** A different instance mints
different `sub` values, `participants.auth_ref` is `clerk:<sub>` and UNIQUE, and
that column is the only thing tying a signed-in human to their participant row.
The same person signing in after the switch gets a new participant, a new
attempt, a new streak, and no access to the credential they already hold. This
is `docs/RENAME.md` I3, and it has no undo.

**This task does not switch instances.** The recommendation is below.

### 4.2 What migration 0010 does and does not buy

`0010_profiles.sql` added `profiles` and `profile_identities` precisely for this
moment, and its own header is careful about the limit:

> It does NOT undo RENAME I3: attempts, sittings and credentials still point at
> `participants.id` and are still orphaned by an instance switch. What it stops
> is the PROFILE — the type, the display name, the day the person first arrived
> — dying with the `auth_ref`.

So the link table exists. `profile_identities` is append-only with `auth_ref`
UNIQUE, so a new `clerk:<sub>` can be LINKED to an existing profile rather than
becoming a second person. **What is missing is the answer to "linked to WHICH
profile" — the merge key.** `verified_email_hash` is the column that would carry
it. Nothing writes it. That is founder step F2.

### 4.3 What is lost with no merge key

Switch with no merge key and every existing participant is a new person. Lost,
per participant:

- **attempts, sittings, responses, transcripts, scores** — still in the store,
  reachable by nobody;
- **credentials** — the holder can no longer see or manage a credential issued
  to them. The code still resolves publicly, because `/verify` reads the
  `credentials` row by code and joins nothing. So the credential outlives the
  account that earned it, which is a strange thing to have to explain;
- **the streak**, which is derived from `practice_sessions` on every read and
  simply restarts at zero;
- **the profile** — `person_key`, `display_name`, `locale`, `created_at` as
  "first seen", and the type readings in `profile_type_readings`;
- **the sealed OpenRouter key.** `provider_keys` is keyed by the identity
  STRING, so the sealed blob stays but becomes unreadable to its owner. The
  candidate must reconnect.

There is no reconstruction afterwards. 0008 already ruled on the shape of that
temptation: a mapping between an old identity and a new one that nobody kept
cannot be inferred from timestamps, and "anything reconstructed from timestamps
would be a guess written into a store whose entire value is that it does not
guess."

### 4.4 What a merge key saves, and the part people get wrong

A merge key is a value that is the SAME person across two identity providers.
`verified_email_hash` — an HMAC of the normalized email under a pepper held in
Secret Manager — is the one already designed for.

With it, `ensureParticipant` on the first post-switch sign-in does: look up
`profile_identities` by the new `auth_ref`; on a miss, look up by
`verified_email_hash`; on a hit, append a new `profile_identities` row pointing
at the EXISTING `participant_id`.

**That last clause is the part that is easy to get wrong.** Writing the column
alone saves only the profile, exactly as 0010 says. To save the attempts, the
credentials and the streak, `ensureParticipant` must resolve a login THROUGH
`profile_identities` to a participant id, instead of resolving
`participants.auth_ref` directly and minting a new row on a miss. That is a code
change on the hot authentication path, not just a column write. Scope it as one.

Two limits, stated rather than discovered later:

- **The email must be VERIFIED by the provider, and nothing else will do.** An
  unverified address is not a key, it is a text box. Merging on one hands a
  stranger who types a candidate's email at signup that candidate's exam
  history and credentials. This is the account-takeover vector this feature
  creates, and it is the reason the column is named `verified_email_hash` and
  not `email_hash`.
- **A merge key saves nobody who has no verified email, or who signs in with a
  different address at the new instance.** Some OAuth providers return no
  verified email. Those people are orphaned either way, and the plan should
  say so instead of implying a clean sweep.

The pepper is the other stated limit, already in 0010's header: an email address
is low-entropy, so the hash protects against a database read and not against a
leak of the pepper.

### 4.5 Recommendation

**Three parts.**

**(a) Decouple the domain move from the Clerk move. Ship this cutover on the
development instance.** They are independent changes and nothing forces them
into one window. A Clerk development instance is not bound to one origin, so
`foray.tenken.co` can serve with today's publishable key on day one. Keeping
them apart means step 11 — the only irreversible step here — is not entangled
with I3, the only step that can orphan a row. Two irreversible things in one
window is how a rollback becomes impossible.

**(b) Build the merge key NOW, under the development instance, before the
switch.** This is a timing argument, not a feature argument. `verified_email_hash`
can only be written by code running at sign-in against the instance that still
holds those users. Once the switch happens, the old `sub` values never appear
again and the only remaining route is exporting the old instance's user list and
matching it against rows — which is the reconstruction 0008 forbids. Write it
live, under the old instance, and let it accumulate.

Scope: one HMAC helper, one pepper in Secret Manager, one column write in
`ensureParticipant`, and the `profile_identities` resolution path of §4.4. Small.

**(c) The reason to do it now is that it is currently free, and it never will
be again.** Today the loss from switching with no merge key is four test
credentials and a handful of dev participants — effectively zero. That is not an
argument for skipping the work. It is the argument for doing it now, because a
merge key cannot be built retroactively for a person who has already gone, and
the population this protects is the one that has not arrived yet. Build the
mechanism while the cost of getting it wrong is a test row.

**Gate on the switch, unchanged from `docs/RENAME.md` step 11:** do not switch
the publishable key until either (i) the merge key has been writing long enough
that every active participant has one, or (ii) the loss is written down and
accepted in a Linear comment with a count next to it. "We will sort it out
after" is not option (ii).

## 5. Bot protection, and the test identity to set up first

Bot protection is DISABLED on the development instance, which is why automated
dogfooding can sign up at all. **Production has it ENABLED.** The moment staging
runs the production instance, an agent-driven sign-up gets "Bot traffic
detected" and every automated run goes red at the door.

From Clerk's documentation, read 2026-09-07:

- **Testing Tokens** bypass bot detection and **work in both development and
  production instances**. A token goes in the `__clerk_testing_token` query
  parameter on Frontend API requests, and `@clerk/testing` provides Playwright
  and Cypress integrations that do it automatically.
- **In production, the testing helpers do not support code-based authentication
  methods.** Authentication must be **email and password**, or sign-in via email
  address directly.
- **`+clerk_test` addresses with the fixed code `424242` are test mode**, on by
  default in development. Clerk says test mode can be turned on for a production
  instance but that doing so is "highly discouraged". Do not plan on it. This is
  the mechanism someone will reach for first, and it is the wrong one.
- **Agent Tasks** create an authenticated session on behalf of a user without
  the standard sign-in flow, and Clerk names automated end-to-end testing and AI
  agent workflows as the use case.

**What to set up, before the instance switch and not after:**

1. **One dedicated test identity in the production instance, created by hand,
   with an EMAIL AND A PASSWORD.** Not a code-based login — the production
   limitation above rules that out. Automation then only ever SIGNS IN. It never
   signs up, which is the flow bot protection is aimed at.
2. **Add `@clerk/testing` and use its Playwright integration** in the e2e suite.
   It is not a dependency today. It needs the production instance's
   `CLERK_SECRET_KEY` available to whatever runs the suite.
3. **Give agent-browser dogfooding a stored signed-in session** rather than a
   fresh sign-up per run, so a run costs no challenge at all.
4. **Decide how the test identity is excluded from every aggregate** — the
   population statistic, the gallery and item statistics. A test account that
   sits the exam nightly is a participant as far as the store is concerned, and
   `docs/SAMPLING.md` exists because that number has to mean something. This is
   an open question, not a solved one, and it is worth answering before the
   identity starts producing sittings.

Item 4 is the one most likely to be skipped and the one that quietly corrupts a
published figure.

## 6. Frontend: there is no code change, and that is the finding

`AILX_PUBLIC_ORIGIN` is an ENVIRONMENT VARIABLE, read in exactly one place
(`apps/web/lib/server/origin.ts`, `resolvePublicOrigin`), which is re-exported
so every server caller keeps one import site. `apps/web/test/apiBase.test.ts`
enforces the matching single-reader rule for the client seam
`NEXT_PUBLIC_AILX_API_BASE` in `lib/mode.ts` and fails the build on a second
reader.

Grepped 2026-09-07 across `*.ts`, `*.tsx`, `*.json`, `*.yml`, `*.mjs` outside
`node_modules` and `dist`: **`ailx-staging.vercel.app` appears in no source file
in this repository.** It appears only in prose. So the frontend half of the
cutover is a Vercel dashboard flip and nothing else, and no second reader is
introduced because no reader is introduced.

The single-reader property is what makes that true. It is worth keeping for the
same reason it was worth building: the alternative is grepping for an origin
across an app at the moment it is already wrong in production.

## 7. Service: both environments, and the one that matters

`allowed_origins` and `model_callback_url` live in Terraform tfvars, and there
are two files:

- `infra/terraform/env/staging.tfvars` — project `tenken-staging`. **This is the
  LIVE service** the browser talks to. Its apply is dispatch-only. It also
  carries `model_callback_url` and `auth_mode = "clerk"`.
- `infra/terraform/env/resilient-staging.tfvars` — project `resilient-staging`,
  `auth_mode = "dev"`. Applied automatically on a merge to `main`.

The legacy file is the live one. Getting that backwards means CORS refuses
`foray.tenken.co` on the service that is actually serving, and the failure looks
like the frontend being broken rather than the plan being wrong.

`public_origin` is NOT the browser origin in either file. `infra/terraform/run.tf`
sets `AILX_PUBLIC_ORIGIN` from it for the SERVICE, and both values are Cloud Run
URLs. It does not change here.

The Infra workflow reads the plan with a machine and fails any plan that
destroys or replaces a resource. Changing an environment variable value on a
Cloud Run service is an in-place update that produces a new revision, so the
plan is non-destructive and needs no `infra:allow-destroy` label.

## 8. Consistency with `docs/RENAME.md`

- **Steps 1-3 of §5** are executed here. Step 1 (Clerk DNS) is already done and
  was verified by `dig`, not assumed.
- **Step 13 is amended, in the open.** It said: new Vercel project, old project
  kept forever serving two 301 routes, never renamed. This document renames the
  existing project and builds no redirects. The amendment rests entirely on §2 —
  every credential is ours — and it does NOT weaken §3.5 as a rule. `RENAME.md`
  should carry a pointer to this amendment so a future reader does not follow
  step 13 as written.
- **Steps 4-8, 12, 14 and 15 are untouched.** No package is renamed, no storage
  key is renamed, no wire header is renamed, no environment variable is renamed,
  no repository is renamed, and the Pages base path does not move. In particular
  step 8 — `@ailx/*` → `@foray/*` across two repos in one window — is unaffected,
  and this cutover deliberately does not open that window.
- **Steps 9-11 are untouched.** The Cloud Run service does not move (I4), the
  Artifact Registry repo does not move (I5), and the Clerk key does not flip
  (I3). §4.5(a) argues for keeping it that way through this cutover.
- **I2 changes meaning.** It is no longer "avoided by not renaming". It is
  accepted, with the evidence in §2 and the ordering constraint in §3.1.
- **I7 is unaffected.** No issued code is rewritten. The four rows are archived
  reversibly, not edited.

## 9. Founder checklist

The numbered list, the DNS records and the point of no return are in the reply
that accompanies this branch and are reproduced there rather than duplicated
here, because the checklist is a thing to be worked through once and this
document is the thing that explains why.

Two items are worth repeating because they are the ones with no undo:

- **Do not rename the Vercel project until the old origin has been removed from
  `allowed_origins` and from `model_callback_url`, and both applies are
  verified** (§3.1).
- **Do not switch the Clerk publishable key in this window at all** (§4.5).
