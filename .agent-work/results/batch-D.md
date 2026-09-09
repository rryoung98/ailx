# Batch D — results

Worktree `/Users/rickyyoung/GitHub/ailx.worktrees/rl-d`, branch `rl/batch-d`, from `e90a8a5`.
Method per issue: write the failing test first, run it on the unmodified code, record the
failure, then fix. No guard test was weakened; all three guards only got stricter.

---

## TEN-225 — the bundleSecrecy sentinel can never fail — **FIXED**

Commit `49c8540` — `fix(web): the bundle-secrecy sentinel counts build outputs only and fails in CI (TEN-225)`

Baseline (helper extracted, behaviour unchanged, new test run against it):

```
FAIL  test/bundleSecrecy.test.ts > ... > the sentinel counts build outputs only, and fails when neither exists
AssertionError: expected [ Array(3) ] to deeply equal [ Array(2) ]
  Array [
    "static export (apps/web/out)",
    "hosted client assets (apps/web/.next/static)",
+   "public asset tree (apps/web/public)",
  ]
 ❯ test/bundleSecrecy.test.ts:724:49
```

Fix: `SENTINEL_MODES = BUILD_MODES` (only modes with `expectItemIds: true`); pure
`scannedOutputs()` / `missingOutputs()` helpers; a new CI-only test that fails when EITHER build
output is missing instead of skipping.

Proof of the second half, run with no build output present:

```
CI=1 vitest run test/bundleSecrecy.test.ts
 × scanned at least one build output → no build output found ...: expected [] to not deeply equal []
 × scanned EVERY build output in CI  → CI builds both modes before this test ...: expected [ Array(2) ] to deeply equal []
```

Now covered by `apps/web/test/bundleSecrecy.test.ts:468` (CI sentinel) and
`apps/web/test/bundleSecrecy.test.ts:722` (machinery: fails when neither build directory exists).

---

## TEN-226 — the database ban is a six-name list — **FIXED**

Commit `e12e6e8` — `fix(core): ban a database dependency by capability and a db/ tree in any app (TEN-226)`

Baseline (the six-name list extracted into `bannedDependencies()` unchanged, fixture run against it):

```
FAIL  test/frontendOnly.test.ts > ... > names a database driver added to an app, not just the six it knew about
AssertionError: expected [] to deeply equal [ '@neondatabase/serverless' ]
 ❯ test/frontendOnly.test.ts:130:42
FAIL  test/frontendOnly.test.ts > ... > bans a database by capability, and lets a browser capability through
AssertionError: pg-promise: expected [] to deeply equal [ 'pg-promise' ]
```

Fix: `DATABASE_DEPS`, a capability set of regexes (pg and pg-*, node-pg-migrate, postgres,
`@neondatabase/*`, `@vercel/postgres`, PlanetScale, libsql, PGlite, mysql/sqlite/mongo, the ORMs,
redis) plus the three exam-service package names. `@vercel/blob` and `@clerk/nextjs` are proved to
stay allowed. The `db/` check is no longer root-only: any `db/` or `migrations/` directory in the
tree fails, and the pattern is proved on `apps/web/db/schema.sql`.

Covered by `packages/core/test/frontendOnly.test.ts:182` (Neon fixture from the real
`apps/web/package.json`), `:194` (capability table), `:223` (per-app `db/`).

---

## TEN-227 — @clerk/backend reachable through @clerk/nextjs/server — **FIXED**

Commit `35e79a5` — `fix(core): grep sources for a server-side Clerk import, not just the manifest (TEN-227)`

Baseline (no such guard existed; `rg '@clerk/nextjs/server' packages/core/test` returned nothing):

```
FAIL  test/frontendOnly.test.ts > no server-side auth is reachable from this repo > (3 tests)
ReferenceError: serverAuthImports is not defined
 ❯ test/frontendOnly.test.ts:219:5
```

Fix: `serverAuthImports()` greps every source (comments stripped) for `@clerk/nextjs/server` and
any `@clerk/backend/...` path in any import form (`from`, `require`, dynamic `import()`), and the
scan runs over the whole repo. This file is the one self-exemption (it must quote the strings it
bans), spelled once as `GUARD_FILE` and asserted to exist.

Covered by `packages/core/test/frontendOnly.test.ts:248` (real scan) and `:256` (fixtures).

---

## TEN-228 — 'use server' banned in prose only — **FIXED**

Commit `424ae82` — `fix(core): fail on a 'use server' directive in any app source (TEN-228)`

Baseline:

```
FAIL  test/frontendOnly.test.ts > no server action anywhere under an app > (3 tests)
ReferenceError: hasUseServerDirective is not defined
```

Fix: `hasUseServerDirective()` matches a directive statement on its own line, at module or
function scope, after comment stripping; every source under `apps/*/app/**` is scanned. Proved to
fire inside a page component and proved not to fire on prose, on `"use client"`, or on
`const mode = "use server"`.

Covered by `packages/core/test/frontendOnly.test.ts:334` (real scan) and `:339`/`:346` (fixtures).

---

## TEN-236 — the public-tree gate constrains file names — **FIXED**

Commit `c796973` — `fix(content-tools): every file under instruments/ must be named by a manifest or the frozen list (TEN-236)`

Baseline is the issue's own scenario, planted on disk on the unmodified code:

```
$ mkdir -p instruments/2027.1/tracks/t2-discrimination/items
$ echo '{"id":"aaa…","key":"ai","rationale":"…"}' > .../items/bank.jsonl
$ vitest run test/public-tree.test.ts
 ✓ test/public-tree.test.ts (12 tests) 367ms
 Test Files  1 passed (1)   Tests  12 passed (12)
```

A keyed, unmanifested bank in a new instruments directory passed every assertion.

With the fix in place and the same file planted:

```
 × instruments/ holds only what a manifest or the frozen list names > carries no file that no manifest and no frozen list accounts for
   → 1 unaccounted file(s) under instruments/: expected [ Array(1) ] to deeply equal []
```

Fix: an inventory. The demo package's files are derived from its `manifest.yaml` and each
`track.yaml` (including the bank the track deals); everything else — the two unconstrained
corpora, the tooling, the sidecars, the READMEs, the snapshot — is a frozen list with a reason on
each entry. The planted file was removed before the commit.

Covered by `packages/content-tools/test/public-tree.test.ts:236` (real tree) and `:247`
(machinery: the exact TEN-236 shape).

---

## TEN-180 — dev identities counted as registered users — **OUT-OF-SCOPE-DEPENDENCY**

Nothing to fix in this repository, and no commit.

Every artefact the issue names lives in the PRIVATE `rryoung98/ailx-backend` repo:

* `lib/kpi.ts` / `KPI_COUNTS_SQL`, `lib/truth.ts`, `lib/tiles.ts`, `features/people/model.ts`
  (`providerOf()`) — none exist here:
  `grep -rn 'KPI_COUNTS_SQL|providerOf|Registered users|Sittings started'` over the whole
  worktree returns only the issue file itself.
* This repo has no store, no `participants` table and no participant-derived query. `/world` is
  `apps/web/app/world/page.api.tsx`, a two-line shell over `features/world/WorldView.tsx`, which
  fetches already-counted aggregates from the exam service over HTTP.
* The public half of the predicate is already here and already correct:
  `packages/contract/src/identity.ts:52` `isDevUserId`.

The frozen criterion ("a test that seeds one `dev:` and one `clerk:` participant asserts the
headline count is one") cannot be written here: there is no store to seed, and the counting SQL is
in the other repo. Adding a dev/real split to the wire type would also be dead until the service
emits it. Recorded as an out-of-scope dependency on the private repo rather than faked.

---

## Gate

`bash .agent-work/gates.sh d`

**GREEN** — `.agent-work/gate-d.log`:

```
=== static export build
=== hosted build (AILX_BACKEND=1)
=== test
=== lint
GATES: GREEN (d)
```

`pnpm test`: 236 files passed, 3373 tests passed, 5 skipped. Baseline on `e90a8a5` was 236 files /
3347 tests; the 26 new tests are the five fixes above.


---

## Review findings (PR #68)

An adversarial reviewer confirmed the five fixes were real and no guard was weakened, then found
three ADJACENT holes of the same shape. All three are in
`packages/core/test/frontendOnly.test.ts`. Each was written as a failing fixture against the
branch code FIRST, then fixed. No assertion was loosened.

### 1. TEN-228 — the `use server` scan read the route tree only

`apps/*/app/**` was the scope, so `apps/web/features/exam/actions.ts` with a `'use server'`
directive passed. A directive is a property of a MODULE, not of a path: Next compiles it into
the same public endpoint the moment a page imports it. The scope is now every source under an
app, expressed as a named `isAppSource` predicate so a fixture can prove what it reads.

Baseline (`bf7ad03^^`, before the fix):

```
FAIL  test/frontendOnly.test.ts > no server action anywhere under an app > scans every app source, not only the route tree
AssertionError: expected false to be true // Object.is equality
 ❯ expect(isAppSource("apps/web/features/exam/actions.ts")).toBe(true)
```

The prose, `"use client"` and `const mode = "use server"` fixtures are untouched, and the scan
now really reads `apps/web/features/exam/ConnectPanel.tsx` (asserted).

**Commit `427df53`** — `fix(core): scan every app source for a 'use server' directive, not just app/ (TEN-228, review)`

**Adjacent path checked:** the other path-scoped scans in the same file. `app/api/**`
(`^apps/[^/]+/app/api/`) is correctly route-tree-scoped — Next serves no API route from
outside `app/`. The `route.(api.)?tsx?` handler scan and the `db/`|`migrations/` scan already
walk the WHOLE tree. `services/` is not a Next app, so a directive there compiles nothing.

### 2. TEN-227 — server-side Clerk was two literals

`@clerk/nextjs/server` and `@clerk/backend` were named; `@clerk/express`, `@clerk/fastify`,
`@clerk/clerk-sdk-node`, `@clerk/remix` and `@clerk/astro` passed BOTH the manifest scan and the
import scan. Every one of them wraps `@clerk/backend` and verifies a token with a secret key.
Adding three names leaves the next one open, so the rule is inverted the way `DATABASE_DEPS`
matches a shape: a `@clerk/*` specifier is server-side UNLESS it is a browser half
(`BROWSER_AUTH_MODULES` — `@clerk/nextjs` exactly, `clerk-react`, `clerk-js`, `themes`,
`localizations`, `types`, `shared`). One predicate, `isServerAuthModule`, now feeds both scans,
and `@clerk/backend` left `BANNED_PACKAGES` because the capability rule subsumes it.

Baseline:

```
FAIL  test/frontendOnly.test.ts > no server-side auth is reachable from this repo > names a server-side Clerk SDK by capability, not by the two it knew about
AssertionError: expected [] to deeply equal [ '@clerk/express' ]
```

`@clerk/nextjs` stays allowed and is PROVEN so on both sides: `bannedDependencies` returns `[]`
for it as a dependency and as a devDependency, and `serverAuthImports` returns `[]` for
`import { SignUp } from "@clerk/nextjs"`, for `@clerk/clerk-react`, `@clerk/themes` and
`@clerk/types`, and for the prose mention. The real tree still passes: the sign-in/sign-up pages
and `lib/auth/*` import only `@clerk/nextjs`.

**Commit `bf7ad03`** — `fix(core): ban server-side Clerk by capability, not by two names (TEN-227, review)`

**Adjacent path checked:** `packages/contract/test/purity.test.ts:45`, which carries the same
kind of `SERVER_PACKAGES` name list. Not a hole: four lines later it asserts
`expect(deps).toEqual(["@ailx/report", "zod"])` — an EXACT allowlist, so any Clerk package added
there fails whatever it is called. The name list is belt-and-braces over a closed set.

### 3. TEN-226 — `bannedDependencies` read two manifest fields

`dependencies` and `devDependencies` only, so a driver entered unseen through
`optionalDependencies`, `peerDependencies`, `overrides`, `resolutions`, `pnpm.overrides` or a
bundled list — each of which really does put a package in `node_modules` or pin the version that
lands there. `declaredPackages()` now reads all of them. An override key may carry a version
selector (`pg@8`) and may be NESTED under the package it applies to (`{ next: { mongodb: "6" } }`);
both are unwrapped, scoped names included.

Baseline:

```
FAIL  test/frontendOnly.test.ts > no second copy of the exam service > reads every dependency field a manifest can carry, not just the two
AssertionError: expected [] to deeply equal [ 'pg' ]
```

The real tree stays green: the only non-`dependencies` field any manifest here carries is the four
track packages' `peerDependencies: { react: "^19.0.0" }`, asserted quiet by fixture.

**Commit `7040eb7`** — `fix(core): read every dependency field a manifest can carry (TEN-226, review)`

**Adjacent path checked:** every other manifest reader in the repo
(`grep devDependencies` over non-`node_modules` sources): `packages/contract/test/purity.test.ts`
(exact-allowlist, above) and `apps/web/test/traceparent.test.ts:264`, which unions
`dependencies` + `devDependencies` for its own narrower claim about `apps/web` alone. Neither is
a database-entry path this guard owns.

### Gate

`bash .agent-work/gates.sh d2`

**GREEN** — `.agent-work/gate-d2.log`:

```
=== static export build
=== hosted build (AILX_BACKEND=1)
=== test
=== lint
GATES: GREEN (d2)
```

`pnpm test`: 236 files passed, 3376 tests passed, 5 skipped — three more tests than the `d` run,
one new fixture per finding.
