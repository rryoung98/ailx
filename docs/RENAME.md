# The rename: AILX becomes Foray

Status: **planned, nothing renamed.** Not one identifier, package name, env var
or URL was changed by the branch that added this document. Date: 2026-09-05.
Branch: `w/rename-plan`. Parent issue: TEN-134 (children listed in §5).
Yardstick: `docs/ADR-redis.md` and `docs/ADR-orpc.md` — a number before a
preference, and a named thing that could go wrong before a recommendation.

The founder has decided the name. This document exists so the change arrives as
a sequence with a rollback at every step, instead of piecemeal through
unrelated PRs. Every count below was taken by grep on 2026-09-05 against the
three working copies on this machine, at `main` for the public repo (21b4dbf
lineage, worktree head 740ccae).

## 1. Inventory — counts, not adjectives

Method: `rg -c` over each repo with `node_modules`, `.git`, `dist`, `.next`,
`coverage`, `.vercel`, `build`, `.turbo` and `pnpm-lock.yaml` excluded. "occ"
is occurrences, "files" is files containing at least one. Categories overlap
where a line carries two kinds of the name (a `@ailx/` import inside a doc
sentence counts in both), so the category rows do not sum to the total row.

| | public `ailx` | private `ailx-backend` | private `ailx-admin` |
|---|---|---|---|
| **total, case-insensitive `ailx`** | **2078 occ / 408 files** | **1508 occ / 297 files** | **333 occ / 49 files** |
| package specifier `@ailx/…` | 745 / 280 | 567 / 191 | 9 / 2 |
| distinct package names | 14 seen, 10 declared here | 16 seen, 12 declared there | 2 seen, 0 declared |
| env vars `AILX_*` | 212 / 52 | 282 / 53 | 13 / 8 |
| distinct env var names | 26 | 33 | 3 |
| of which `NEXT_PUBLIC_AILX_*` | 110 / 51 | 2 / 2 | 0 |
| hostnames `ailx*.vercel.app` etc. | 12 / 11 | 11 / 6 | 6 / 2 |
| Pages base path `/ailx` | 32 / 21 | 9 / 7 | 9 / 8 |
| GCP: Cloud Run + Artifact Registry | 22 / 16 | 36 / 16 | 0 |
| Vercel project names | 7 / 4 | 12 / 5 | 7 / 5 |
| GitHub slug `rryoung98/ailx*` | 8 / 5 | 10 / 6 | 8 / 7 |
| credential code prefix `AILX-` | 58 / 34 | 36 / 15 | 13 / 10 |
| `AilxHostedStatus` / `credentialSubject.ailx` | 13 / 4 | 14 / 4 | 0 |
| browser storage keys `ailx:…` | 96 / 49 (13 distinct keys) | 6 / 6 | 0 |
| SQL identifiers matching `ailx_` | 20 / 15 | 6 / 5 | 0 |
| docs prose, `*.md` only | 340 / 39 | 153 / 29 | 282 / 31 |
| user-visible copy (`apps/web/app,components,features`, `packages/report/src`, `packages/tracks`) | 133 / 43 | n/a | 5 / 5 |
| Linear identifiers `TEN-nnn` | 329 / 148 | 313 / 96 | 65 / 11 |
| instrument version `2026.1` | 314 / 128 | 294 / 104 | 20 / 7 |

**Read three rows carefully.**

- **Database identifiers are almost absent, and that is the good news.** There
  is no table, column, enum or index carrying the name. The 20 `ailx_` hits in
  the public repo are the dev-identity cookie `ailx_dev_user`, not schema. The
  name reaches the store in exactly two places, both *values*: `instruments.id`
  is the literal `'ailx'` (`db/schema.sql:14`, `db/migrations/0000_baseline.sql:32`),
  and `credentials.code` is `'AILX-2026.1-XXXX-XXXX-XXXX-XXXX'`
  (`db/schema.sql:246`). §4 deals with both.
- **`2026.1` never contained the name.** The 314 + 294 + 20 hits are the
  instrument VERSION. They are listed only so nobody mistakes them for work.
  §6 argues they must not move.
- **`TEN-` is the Tenken team, not the product.** 707 references across the
  three repos, none of them in scope.

Twelve workspace packages are in play across the two code repos: `@ailx/core`,
`contract`, `report`, `session`, `content-tools`, `track-t1`…`t4`, `web`
(public, source of truth), plus `@ailx/backend`, `@ailx/instrument`, `@ailx/db`,
`@ailx/api`, `@ailx/model-proxy`, `@ailx/tools`, `@ailx/track-t9` (private).
The first eight are vendored into the backend BYTE FOR BYTE and compared on
every backend PR by `pnpm sync:shared:check`. `services/openrouter-proxy` is
named `ailx-openrouter-proxy` — unscoped, so it is a thirteenth name.

## 2. What is irreversible or externally visible

Listed first because it fixes the order. "Irreversible" here means: cannot be
undone by a `git revert`, or can be undone only by re-acquiring a name someone
else may take in the gap.

| # | Thing | Why it is not a revert | Who sees it |
|---|---|---|---|
| I1 | **GitHub repo names** `ailx`, `ailx-backend`, `ailx-admin` | GitHub redirects the old path — until somebody creates a repo at the old name, and then the redirect dies silently. Every existing clone's `origin`, every PR permalink in 707 Linear comments, every agent worktree remote | anyone with a link or a clone |
| I2 | **Vercel project rename** `ailx-staging` → new name | The rename RELEASES `ailx-staging.vercel.app` back to the global pool. Three issued credentials name that origin (§3) | anyone holding a credential URL or a share link |
| I3 | **Clerk production instance cutover** to `foray.tenken.co` | A different Clerk instance mints different `sub` values, and `participants.auth_ref` is `clerk:<sub>` UNIQUE. Every existing participant is orphaned from their attempts, sittings and credentials. There is no undo that re-links them | every signed-in candidate |
| I4 | **Cloud Run service name** `ailx-backend` | Cloud Run has no rename. A new service is a new `*.run.app` URL; deleting the old one breaks any browser still holding `NEXT_PUBLIC_AILX_API_BASE` | the frontend, and any e2e runner configured by hand |
| I5 | **Artifact Registry repo** `us-central1-docker.pkg.dev/tenken-staging/ailx` | `instruments.package_digest` pins an immutable OCI digest. Deleting the repo makes a stored digest unresolvable, and a rollback needs it | nobody — until a rollback needs it, and then it is fatal |
| I6 | **Pages base path** `/ailx` | Not irreversible, but every external link to the static demo (`…/ailx/...`) 404s the moment it moves, and GitHub Pages will not redirect | anyone who linked the demo |
| I7 | **Credential codes already issued** (`AILX-2026.1-…`) | Stored, UNIQUE, printed on LinkedIn entries we cannot edit. §3 | verifiers, forever |
| I8 | **`foray.tenken.co` DNS** | The only reversible item here — remove the records. Listed because everything user-facing waits on it |  |

I1, I2 and I3 are the three most dangerous. I2 and I3 both destroy something no
code change can rebuild: a name a stranger may already hold, and an identity
link inside our own store.

## 3. The credential issuer identity

This is the hardest part, and the only part where getting the ORDER wrong is
not recoverable by shipping a fix. Read with `docs/CREDENTIAL.md`.

### 3.1 What identifies the issuer today

Nothing durable. The issuer is **an origin string plus a display name**, and
both are computed at read time (`packages/report/src/credential.ts`):

- `issuer` = `{ id: origin, type: ["Profile"], name: CREDENTIAL_ISSUER }`,
  where `CREDENTIAL_ISSUER` is the literal `"AILX"`.
- the credential's own `id` = `${origin}/verify/<code>`.
- `credentialSubject.achievement.id` = `${origin}/methodology`.
- `credentialStatus` = `{ id: ${origin}/api/credentials/<code>, type: "AilxHostedStatus", status }`.
- the sitting's facts sit under the vendor key `credentialSubject.ailx`.
- the holder-facing code is `AILX-<version>-XXXX-XXXX-XXXX-XXXX`, minted by
  `formatCredentialCode` and validated by `CREDENTIAL_CODE_RE`, which is
  anchored on the literal `AILX-`.
- LinkedIn's `organizationName` is the same `"AILX"` string, and
  `credentialUrl` is `${origin}/verify/<code>`.

`origin` is resolved by the caller from `AILX_PUBLIC_ORIGIN` (AGENTS.md,
`docs/DEPLOY.md`). Today that is `https://ailx-staging.vercel.app`. **There is
no DID, no key, no registry entry and no signature.** The issuer IS the origin.

### 3.2 What a verifier fetches

Nothing automatically. `docs/CREDENTIAL.md` §3 is explicit: we emit the VC 2.0
and OB 3.0 context URLs and never expand them, and there is no signature to
check. So verification is two dereferences, both against the origin baked into
whatever the holder published:

1. a human opens `${origin}/verify/<code>` — the rendered view, read live from
   the row;
2. a machine gets `${origin}/api/credentials/<code>` — the JSON twin and the
   status endpoint, uncached.

That is the Open Badges "HostedBadge" model. Its whole security property is
that the origin answering is the issuer. It has exactly one failure mode, and
a rename is that failure mode.

### 3.3 What happens to an already-issued credential when the origin changes

Three credentials exist: 1 live, 2 revoked.

The **document** is fine. It is derived at read time, never stored
(`credentialDocument`), so the moment a row is served from a new origin, the
new document names the new origin consistently in all four places. Nothing was
pre-baked, so nothing goes stale.

The **published pointers** are not fine, and they are the artefact. The
holder's LinkedIn certification entry, any CV PDF, any email — each carries the
literal string `https://ailx-staging.vercel.app/verify/AILX-2026.1-…`. We
cannot edit LinkedIn's copy. If that origin stops answering, the verifier gets
a DNS error or a stranger's Vercel project. **That failure is worse than
"revoked".** The design's own table (`docs/CREDENTIAL.md` §4) reserves the
unresolvable case for a token that was never issued; a real credential that
cannot be reached is indistinguishable from a forgery, which is precisely the
outcome the whole `/verify` view was built to prevent.

### 3.4 How a revoked credential keeps resolving

By being read live and answered in words. `/verify/<code>` reads the row, sees
`status: "revoked"`, and says "revoked on `<date>`, because `<reason>`". That
is the difference from a share token, which 404s. Two of the three existing
credentials depend on this, and a revoked credential is exactly the one a
sceptical reader will check.

So the promise "a revoked credential still resolves" is a promise about the
ORIGIN, not about the row. Move the origin and drop the old one, and the
promise is broken for the two revoked credentials first.

### 3.5 Does the old origin have to answer forever? Yes — but only two paths

**Answer: yes, for as long as any credential issued under it exists, which is
forever unless we contact all holders.** The minimum is small, and it is not a
whole application:

- `GET /verify/<code>` → **301** to `https://<new-origin>/verify/<code>`
- `GET /api/credentials/<code>` → **301** to the same path on the new origin

Two routes. A 301 preserves the link for a human and for any machine that
follows redirects, and the new origin serves the live row, so a revocation
recorded after the move is still visible through an old URL. No database, no
build, no secrets on the legacy host.

That has one hard prerequisite, and it is why this drives the order: **the
legacy hostname must stay ours.** `ailx-staging.vercel.app` is ours only while
the Vercel project is called `ailx-staging`. Renaming the project (I2) releases
the subdomain, and anyone can then claim it and serve whatever they like at a
URL three credentials point at. Therefore:

1. **Before anything else user-facing, move the credential origin off
   `*.vercel.app` and onto a domain we own** — `foray.tenken.co`. Flip
   `AILX_PUBLIC_ORIGIN` to it while the Vercel project still holds the old
   subdomain, so newly issued credentials are already on durable ground.
2. **Keep the `ailx-staging` Vercel project alive**, renamed to nothing, doing
   nothing but the two redirects above. It costs one Vercel project on the free
   plan. The new deployment gets a NEW project. **Do not rename the old one.**
   Renaming to free up tidiness is the single most expensive mistake available
   in this whole piece of work.
3. Reissue is **not** a way out. Reissue mints a new code, and the code is what
   is typed into LinkedIn's "Credential ID" box. Revoke-and-reissue turns a
   holder's published entry into a revoked one.

### 3.6 What may change in the credential, and what may not

| | change | why it is safe / not |
|---|---|---|
| `CREDENTIAL_ISSUER` `"AILX"` → `"Foray"` | **yes** | derived at read time, unsigned. A holder's LinkedIn `organizationName` will disagree with the served document until they edit it — accept it, and say so on `/verify` |
| `credentialName()` → `Foray 2026.1 — Sitting Completed` | **yes**, same caveat | the word "Completed" is asserted in tests and does not move |
| `type: "AilxHostedStatus"` → `"ForayHostedStatus"` | **yes** | a vendor-defined status type, unsigned, no consumer known to key on it |
| `credentialSubject.ailx` → `.foray` | **yes** | namespaced by design so a strict OB reader ignores it; nothing external parses it. *Rejected: emitting both keys for a transition period. Two spellings of one fact is a bug waiting to be read twice, and there are three credentials.* |
| new code prefix `FORAY-` | **yes, for NEW codes only** | `CREDENTIAL_CODE_RE` must be WIDENED to accept both prefixes, never switched |
| existing `credentials.code` values | **no — never rewrite** | §4 |
| existing `/verify/<code>` URLs | **no** | §3.5 |

## 4. The database

Read from `db/schema.sql` and all eight migrations in the private backend repo.

**No structure carries the name.** No table, column, enum, index or constraint
is named after the product. There is no stored URL column at all — the only
`http` string in the schema is a comment. `participants.auth_ref` is
`clerk:<sub>` or `dev:<id>`; the prefix is the auth provider, not the product.

**Two stored VALUES carry it:**

1. `instruments.id = 'ailx'`, primary key `(id, version)`, referenced by a
   foreign key from `track_versions (instrument_id, instrument_ver)` and read
   by everything that resolves an attempt to a form.
2. `credentials.code`, `text NOT NULL UNIQUE`, of the form `AILX-2026.1-…`,
   and the frozen `claim` JSON alongside it whose `instrument` field is the
   string `'ailx 2026.1'`.

A third-order one: the dev-identity request header is `x-ailx-dev-user` and the
client timestamp header is `x-ailx-client-ts`, both frozen in
`packages/contract/src/headers.ts` and both on the CORS allowlist the exam
service must send back. Those are wire, not storage, but they are shared
between two repos and must move in the same window as the packages (§5.8).

**A rename that rewrites stored rows in an append-only store is a
contradiction, so do not rewrite them.** The rule is: *the name in the store is
a historical fact about a sitting, not a brand asset.*

- **`instruments.id`:** leave `('ailx', '2026.1')` exactly as it is. When the
  next instrument version ships, INSERT `('foray', '2026.2', …)`. The two rows
  coexist; that is what a two-column primary key with `effective_from` /
  `effective_to` is for. Renaming the id in place would require an `UPDATE`
  that cascades through `track_versions` and every attempt that references it,
  and would retroactively claim that a sitting in September was sat under a
  name that did not exist.
- **`credentials.code`:** never touched. Widen the regex, mint `FORAY-` going
  forward, keep the three `AILX-` rows resolving. A test that feeds one legacy
  code and one new code — each in both `valid` and `revoked` state — is the
  gate.
- **`claim.instrument = 'ailx 2026.1'`:** frozen by design
  (`docs/CREDENTIAL.md` §2: "the stored row is a FROZEN claim"). It renders on
  `/verify` as the instrument the person sat. Leave it. If the display grates,
  the fix is a display-layer note, not an `UPDATE`.

Net database work: **zero migrations, zero row rewrites.** The only DDL the
rename could justify is a `COMMENT ON` refresh, and it is not worth a
migration.

## 5. Order of operations

Each step ships alone and reverts alone. Steps 1–3 are ops with no code. Steps
4–7 are public-repo code. Step 8 is the one step that must land in two repos in
one window. Steps 9–13 are the irreversible ones, deliberately last.

| step | what | reverts by | irreversible items |
|---|---|---|---|
| 1 | Add the four Clerk CNAMEs for `foray.tenken.co` to DNS. Verify the Foray production instance. Nothing points at it yet | delete the records | I8 |
| 2 | Add `foray.tenken.co` as an ADDITIONAL domain on the existing `ailx-staging` Vercel project. Both hostnames serve the same deployment | remove the domain | — |
| 3 | Flip `AILX_PUBLIC_ORIGIN` to `https://foray.tenken.co`. New credentials are now minted against a domain we own | flip the env var back | — |
| 4 | Prose: 340 md occurrences in the public repo, plus `AILX-Spec-2026.1.md` (a filename), README and AGENTS.md | `git revert` | — |
| 5 | User-visible copy: 133 occurrences in `apps/web` and `packages/report` | `git revert` | — |
| 6 | Credential surface (§3.6): issuer name, credential name, `ForayHostedStatus`, `credentialSubject.foray`, `FORAY-` minting, WIDENED regex. Tests for legacy + new × valid + revoked | `git revert` — no stored row changed | — |
| 7 | Browser storage keys: 13 `ailx:*` keys → `foray:*`, each with a one-shot read of the old key. `ailx:attempt` may hold an in-flight sitting; losing it loses a candidate's run | `git revert`, old keys still present | — |
| 8 | **Packages `@ailx/*` → `@foray/*`** in BOTH repos in one window (745 + 567 occurrences), plus the two `x-ailx-*` wire headers, plus the regenerated `instruments/demo-2026.1/snapshot.json` in the same commit. `sync:shared:check` compares byte for byte, so a split lands the backend red | revert both repos together | — |
| 9 | Cloud Run: deploy a NEW service `foray-backend` from a NEW Artifact Registry repo `…/tenken-staging/foray`. Old service and old image repo keep running | point the frontend back | I4, I5 |
| 10 | Point `NEXT_PUBLIC_AILX_API_BASE` (still so named until step 12) at the new service. Watch for one week | flip back | — |
| 11 | Clerk: switch the frontend publishable key to the Foray production instance. **Do this only after the `auth_ref` question in §2/I3 has an answer with a migration or an accepted loss** | flip the key back — but any `auth_ref` written in between is orphaned either way | I3 |
| 12 | Env vars: `FORAY_*` read with an `AILX_*` fallback in all three repos (40 distinct names), then set the new names in Vercel / Cloud Run / GitHub, then delete the fallback one release later | revert the deleting release | — |
| 13 | New Vercel project `foray-staging`. **The old `ailx-staging` project is NOT renamed and NOT deleted** — it is reduced to the two 301 routes of §3.5 and left running forever | — | I2 (avoided by not renaming) |
| 14 | Pages base path `/ailx` → `/foray`, with the old path left as a redirect page if GitHub Pages allows one | `git revert` | I6 |
| 15 | GitHub repo renames, all three, last. Announce first; update every worktree remote in the same hour | rename back, if nobody claimed the old name | I1 |

DNS (step 1) is first because Clerk verification and propagation take hours and
everything user-facing waits on it. Clerk's key cutover (step 11) is late
because it is the only step that can orphan a row. The repo renames are last
because they break the links people use to review the earlier steps.

Child issues, one per irreversible step: see §8.

## 6. What should NOT be renamed

- **The instrument version `2026.1`.** Agreed, and the reason is stronger than
  "it is an anchor": it never contained the name in the first place. What must
  not move is the instrument IDENTITY — the row `('ailx', '2026.1')`, the
  content-addressed digest chain hanging off it, and the string `'ailx 2026.1'`
  frozen into the three credential claims. Renaming a version that has been
  content-addressed and referenced by an issued credential would break the one
  property the whole design is built on: that a score is byte-identically
  recomputable from stored inputs (AGENTS.md, core invariants).
- **Anything already in a published credential or a share link.** Credential
  codes, `/verify/<code>` URLs, `/s/<token>` share tokens, and the old origin
  itself (§3.5). Agreed without qualification.
- **The Linear `TEN-` prefix.** 707 references. The team is Tenken; the product
  is Foray. They were never the same name.
- **Git history and past PR titles.** Rewriting them changes every commit hash
  and every content address derived from a commit. Not negotiable.
- **`instruments/demo-2026.1/snapshot.json` digest VALUES, other than by
  regeneration.** Step 8 moves them, because the recorded scorer paths are
  package-qualified (`@ailx/core/src/rounding.ts`) and the package name is in
  the path. The bytes of `score()` do not change. Say that in the commit
  message, because a reviewer diffing a moved audit digest should be
  suspicious by default, and this is the one time the answer is "yes, and here
  is why it is not a scoring change".
- **The `AILX_*` env names in the backend's judge configuration**, until step
  12 — they are set in Cloud Run and in GitHub secrets, and a half-renamed env
  var is a service that boots with an undefined origin (§7).

## 7. Cost, and what a half-done rename breaks

### 7.1 Hours

Estimates are engineering hours including tests, not calendar time.

| | hours | the biggest single item |
|---|---:|---|
| public repo (`ailx`) | 30 | packages `@ailx/*` (6 h), credential surface + its tests (5 h), env dual-read (4 h), prose (4 h), storage keys (3 h), CI/workflows and base path (3 h), tests everywhere else (5 h) |
| private `ailx-backend` | 20 | packages and the vendored sync (5 h), Cloud Run / Artifact Registry / Terraform (5 h), env dual-read (4 h), credential emit (2 h), tests (4 h) |
| private `ailx-admin` | 4 | 333 occurrences, mostly prose |
| ops: DNS, Clerk, Vercel, GCP, repo renames | 8 | Clerk instance cutover and the `auth_ref` decision |
| docs, Linear, PR review overhead | 8 | |
| **total** | **70** | |

Add **30% for the two-repo lockstep and the deprecation windows: ~90 hours.**
Calendar time is at least three weeks regardless, because steps 10 and 12 each
carry a one-week watch and step 1 waits on DNS.

The `auth_ref` question in I3 is NOT costed. If the answer is "migrate", it is
its own piece of work in the backend repo and it is not small.

### 7.2 What breaks if it stops half-way

- **Packages renamed in one repo only:** `pnpm sync:shared:check` goes red and
  stays red, and every backend PR is blocked until someone finishes the job.
  This is why step 8 is a single window.
- **Env vars renamed in the platform but not in code (or the reverse):**
  `AILX_PUBLIC_ORIGIN` resolves to undefined, and `credentialDocument` emits a
  document whose `id`, `issuer.id` and `credentialStatus.id` are not absolute.
  A verifier gets an object that dereferences nowhere. AGENTS.md already
  requires a bare absolute origin; nothing enforces it at boot.
- **A code-prefix switch instead of a widening:** `/verify/AILX-2026.1-…`
  fails the regex and answers "Cannot be confirmed" for a real, live
  credential. The worst output this system can produce, and it looks exactly
  like a forgery.
- **Copy renamed, credential not:** the site says Foray, the credential says
  AILX, and a verifier comparing the issuer name to the site concludes the
  credential is fake.
- **Vercel project renamed before the redirect exists:** `ailx-staging.vercel.app`
  is claimable by a stranger while three credentials point at it. There is no
  fix from our side.
- **Base path moved without a redirect:** every external link to the static
  demo 404s, and GitHub Pages will not redirect for us.
- **Repo renamed while PRs are open:** the links resolve until someone creates
  a repo at the old name, and then 707 Linear references point at a 404 or, at
  worse, at somebody else's repository.

## 8. Linear

Parent: **TEN-134** — "Rename AILX to Foray". Children, one per irreversible
step, in the order of §5:

- TEN-135 — DNS + Clerk production instance for `foray.tenken.co` (§5.1, I8)
- TEN-136 — `foray.tenken.co` on the existing Vercel project, then flip
  `AILX_PUBLIC_ORIGIN` (§5.2–3)
- TEN-137 — the permanent two-route credential redirect, and the decision NOT
  to rename the `ailx-staging` Vercel project (§3.5, I2)
- TEN-138 — `@ailx/*` → `@foray/*` in both repos in one window (§5.8)
- TEN-139 — new Cloud Run service and Artifact Registry repo (§5.9, I4/I5)
- TEN-140 — Clerk key cutover and the `auth_ref` decision (§5.11, I3)
- TEN-141 — Pages base path `/ailx` → `/foray` (§5.14, I6)
- TEN-142 — GitHub repo renames, all three (§5.15, I1)

codex review skipped: usage limit
