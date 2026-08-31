# ARCHITECTURE.md — separating the frontend from the exam

Status: decision document, 2026-08-30. Design only — no application code changed by this
commit. Supersedes nothing; extends spec §11 (architecture) and §14 (versioning) with the
decisions those sections left open.

## 0. The question, unconflated

The ask was "build an API backend and DB so we can separate the frontend". That sentence
contains three independent decisions, and answering them as one produces a rewrite nobody
needs:

1. **Content custody** — where the secure bytes live and who may read them.
2. **Runtime split** — one deployable, or a frontend plus a separate API service.
3. **Repo split** — one repository, or a public frontend repo plus a private backend repo.

Only the first is forced by the precipitating fact. The other two are options we buy later,
on evidence, and this document says exactly when.

### The precipitating fact (verified)

`apps/web/lib/instrument.ts` statically imports `instruments/2026.1/snapshot.json`. That
snapshot carried all 104 T2 items with `key`, `rationale` and `provenance` (since
2026-08-30 it carries the 84 operational items; the other 20 moved to the released-practice
tier `instruments/demo-2026.1` — see §10 step 1). The deployed
static export leaks them:

```
apps/web/out/_next/static/chunks/638-614dcaf82a885294.js
  → 40 occurrences of "key":"ai"
  → "rationale":"Genuinely model-generated (see provenance)…"
```

The repository is public as well, so the bank is readable twice over. An exam whose item
bank and answer keys are public is not an exam — it is a worksheet. Server-side scoring is
also the assessment-industry baseline: ATP/ITC *Guidelines for Technology-Based Assessment*
v1.1 (July 2025) §3.6 — "Scoring should be conducted at the server level to prevent
compromise or subversion at the browser level."

Note what is *already* right, because it decides the shape: `packages/backend` handlers are
framework-agnostic `(ctx, headers, body) => {status, body}`; `apps/web/app/api/**/route.api.ts`
are thin adapters; `packages/backend/src/practice.ts` already implements the exact security
pattern we need (deck dealt server-side, grade computed server-side, an answer to an undealt
item refused, bank never in a client module). FRONTEND.md §4.7 already declares answer keys
and item selection untrusted from the client. **The policy exists; T2 does not obey it.**

## 1. Recommendation

**Phase 1 (now): custody, not topology.** Keep one repo and one Next.js deployable. Add one
server-only deep module, `packages/instrument`, which owns the operational bank, deck
sampling, redaction and grading. Move the operational bank to a private, digest-pinned
source. Ship a public **practice-tier** instrument (spec §09's released tier) that keeps the
GitHub Pages demo working, keys and all, honestly labelled.

**Phase 2 (when Phase 4 judging lands, not before): runtime split inside one repo.** Re-host
the same handlers in `services/api` (Hono) and add `services/worker` for judging. `apps/web`
becomes a client of a versioned `/v1` API and `apps/web/lib/server/api.ts` plus
`app/api/**/route.api.ts` are **deleted** — a second host that leaves the first in place is a
pass-through layer and a second truth.

**Never: a repo split.** See §6.

This is deliberately staged. Phase 1 delivers the entire driver — a browser that cannot see
an answer key — with a diff measured in one new package and one new route. Phase 2 is bought
with a concrete workload (long-running model calls that must not run inside a serverless
request), not with an aesthetic preference for microservices.

## 2. Caller-first sketches

### 2.1 The candidate's browser, hosted mode

```ts
// apps/web/app/exam/useT2Deck.ts (client)
const { items, deckDigest } =
  await (await fetch(`/api/attempts/${attemptId}/items?track=t2`)).json();
// items[0] === { phase: "sitting", id: "itm_9f3…", type: "message-page", stem,
//   material, options: ["Human-written","AI-generated"], difficulty: 0.5, exposureSeconds: 25 }
// No `key`. No `rationale`. No `provenance`. Nothing to find in devtools.

// answering — the existing append-only route, unchanged shape
await fetch(`/api/attempts/${attemptId}/responses`, { method: "POST", body: JSON.stringify(
  { seq: 7, itemId, payload: { choice: "ai" }, clientTs: Date.now() }) });
// 201 { response: { seq: 7, created: true } }   ← no verdict during the sitting

// after POST /api/attempts/:id/finalize, the teaching/replay phase unlocks
const { items } = await (await fetch(`/api/attempts/${attemptId}/items?track=t2`)).json();
// items[0] === { phase: "review", …, key: "ai", rationale: "The gradient banding is …",
//                yourChoice: "ai" }
```

Phase is **derived** from `attempt.finalized_at`, never believed from a query parameter. The
client names a wish; the server states a fact. Same rule `practice.ts` already follows.

### 2.2 The static GitHub Pages demo — same call site, different provider

```ts
// apps/web/lib/instrument.client.ts (bundled in BOTH builds)
export const trackConfig = isServerMode() ? fetchTrackConfig : demoTrackConfig;
// demoTrackConfig comes from instruments/demo-2026.1 — the released practice tier:
// 20 items, keys and rationales published ON PURPOSE, labelled "practice".
```

The operational bank is simply absent from that build's module graph. `footerModeCopy()`
already tells the visitor the static build issues no score of record; that copy stays true.

### 2.3 Server wiring — one process-wide open, one adapter

```ts
const instrument = await openInstrument(process.env);   // digest-pinned, verified, cached
export const GET = (req: Request, c: AttemptRouteContext) =>
  apiRoute(req, async (ctx, h) =>
    handleGetItems({ ...ctx, instrument }, h, (await c.params).id));
```

### 2.4 Phase 2, when it arrives — the same handler, a second host

```ts
// services/api/src/main.ts — the whole host, ~40 lines
import { Hono } from "hono";
import { handleCreateAttempt, handleAppendResponse } from "@ailx/backend";
import { apiRoute } from "./bridge";        // ONE adapter, ported from lib/server/api.ts
const app = new Hono();
app.post("/v1/attempts", (c) => apiRoute(c, handleCreateAttempt));
app.post("/v1/attempts/:id/responses", (c) => apiRoute(c, handleAppendResponse));
export default app;                          // Node | Cloud Run | Bun | Workers
```

## 3. The shape: one deep module

```ts
// packages/instrument/src/index.ts — SERVER-ONLY package (no "browser" export condition)

export type Phase = "sitting" | "review";

/** Exactly the fields a candidate may hold. key/rationale are ABSENT in "sitting" —
 *  a discriminated union, never an optional field someone forgets to strip. */
type Presented = {
  id: string; type: string; stem: string; material: Material;
  options: readonly Option[]; difficulty: number; exposureSeconds?: number;
};
export type RedactedItem =
  | (Presented & { phase: "sitting" })
  | (Presented & { phase: "review"; key: string; rationale: string; yourChoice?: string });

export interface Instrument {
  readonly instrumentId: string;
  readonly instrumentVer: string;
  /** OCI/tarball digest recorded in `instruments.package_digest` (spec §14). */
  readonly packageDigest: string;
  /** The same pure sampler decks are already recorded with. */
  sampleDecks(attemptId: string, locale: string): readonly DeckRecord[];
  /** What the browser may see for this attempt at this phase. */
  itemView(deck: DeckRecord, phase: Phase, locale: string): readonly RedactedItem[];
  /** Grading and the config score() consumes. Keys never leave here. */
  gradeResponse(itemId: string, payload: unknown): Verdict;
  scoringConfig(trackId: TrackId, deck: DeckRecord, locale: string): unknown;
  rubricVersion(trackId: TrackId): string;
  scoringDigest(trackId: TrackId): string;
}

export async function openInstrument(env: Env): Promise<Instrument> { /* not implemented */ }
/** Dev, tests, and the static build: the released practice tier, keys and all. */
export function openDemoInstrument(): Instrument { /* not implemented */ }
```

`ApiContext` gains `instrument` and **loses** `sampleDecks?` — that callback forwards
arguments and hides nothing, and the new module absorbs it. `packages/backend` stays
content-agnostic: it holds an interface, not a bank.

Why this module is deep rather than shallow: six methods hide package fetch and digest
verification, bank parsing, locale fallback, the `material` transform, deck sampling, key
custody, redaction policy, phase authorisation, exposure seconds, and the rubric/scoring
digest lookups — all 357 lines of today's `apps/web/lib/instrument.ts` plus the loader.
Moving it also closes the FRONTEND.md §9 / PLAN.md Phase 1 holdout that says `instrument.ts`
must leave `apps/web`; the asset-URL coupling that blocked that move becomes an injected
`(path: string) => string`.

Red flags screened (per the architect skill's `design-red-flags.md`):

- **Information leakage — rejected** "return the full item and let the client call
  `redactItem()`". One policy, two homes, one of them the candidate's machine.
- **Pass-through — removed one** (`ApiContext.sampleDecks?`).
- **Temporal decomposition — rejected** a `loadBank → validate → sample → redact` chain of
  four modules re-parsing one item shape. One module owns "what an item is and who may see it".
- **Shallow module — rejected** a `ContentClient` HTTP wrapper over a separate content
  service: wide surface (auth, retries, caching, error mapping), hides nothing but a `fetch`.

## 4. Trust boundary — what the browser may ever see

| Bytes | Sitting | After finalize | Never |
|---|---|---|---|
| T2 item id, stem, material, options, exposure seconds | yes | yes | — |
| T2 `key`, `rationale`, `provenance` | **no** | yes (own attempt only) | — |
| Which items were sampled for *another* attempt | no | no | **never** |
| Full operational bank (84 items), bank `sha256` preimage | no | no | **never** |
| T1/T4 judge prompts, rubric criteria weights, band anchors | no | anchors only, as report copy | raw prompts **never** |
| Scoring config that embeds keys | no | no | **never** |
| `scorers[]` digests, rubric versions, instrument digest | yes | yes | — (they are audit facts, not secrets) |
| Own event log, own score, own report, own credential | yes | yes | — |
| Practice-tier bank with keys | yes | yes | — (published on purpose) |

Consequences we accept, stated plainly:

- In hosted mode the browser **cannot** compute a T2 score during the sitting, because
  `score()` needs the keys. That is correct: FRONTEND.md §4.7 already says client scores are
  advisory. The score of record is recomputed server-side from the append-only log. The UI
  shows progress, not correctness, until finalize.
- `score()` does **not** move and does not change. It stays pure in `packages/tracks`,
  inside the CI purity sandbox, imported by whichever runtime needs it. Byte-identical
  recomputability rests on purity + stored inputs + the `scorers[]` source digest — never on
  *where* the function runs. What changes is who is allowed to **issue** a score row.
- Screenshot leakage is not solved by any of this. Only three-tier rotation and a withheld
  anchor block (spec §09) address a candidate photographing items. Custody stops bulk
  extraction; it does not stop a camera.

## 5. Stack decision (Phase 2, prepared now)

**Hono**, if and when a service is extracted. Single strongest reason: it is Fetch-native, so
`apps/web/lib/server/api.ts` — which already speaks `Request`/`Response` — ports almost
verbatim, and the same binary runs on Node, Cloud Run, Bun and Workers without a rewrite of
the host. Typed client via `hc<AppType>` with no codegen step.

Honest evidence, gathered 2026-08-30 from npm registry, GitHub API and the GitHub Advisory
Database (blog-tier sources deliberately excluded):

| pkg | latest | rel./12mo | dl/wk | advisories |
|---|---|---|---|---|
| hono | 4.13.5 | 68 | 59.6M | 47 total, 39 in 2026 — clustered in optional middleware and `hono/jsx` |
| fastify | 5.12.1 | 22 | 12.6M | 10 total; 2 highs in 2026 are **core** content-type parsing bypasses |
| express | 5.2.1 (2025-12) | 5 | 132.9M | 6 total; risk lives in `path-to-regexp` / `body-parser` |
| elysia | 1.4.30 | 32 | 1.09M | critical 2025-12-09; Bun in production |
| @nestjs/core | 12.0.1 | 31 | 14.3M | 2 total — healthiest, but DI/module layering we do not have |
| encore.dev | 1.58.4 | 69 | **31.1k** | 0 — adoption outlier, MPL-2.0, hosted control plane |
| next | 16.3.3 | 81 | 55.3M | 64 total, **31 in 2026, 13 high**, several in the request path |

Readings, in order of weight:

- **Throughput is not our bottleneck and pretending otherwise would be dishonest.** A scored
  sitting is low-QPS; judging is multi-second model calls. Framework routing overhead is
  microseconds — under 0.1% of request latency. Benchmarks do not decide this.
- **Patch surface does decide it.** Next.js has the weakest 2026 posture in the table and the
  advisories sit in exactly the request-handling path an exam API uses. Serving the exam from
  the same process as the marketing site couples the exam's patch cadence to a frontend
  framework's. That, not performance, is the real argument for a separate host.
- Hono's advisory count is disclosure discipline plus a wide optional-middleware surface, not
  defect density; we use core only. It is still real patch load: 68 releases in 12 months.
- Rejected: **NestJS** (DI over ~190 lines of plain functions), **Fastify** (Node-only; core
  advisories have larger blast radius; a second schema world next to our validators),
  **Express** (no Fetch, weakest types), **Elysia** (Bun lock-in), **Encore.ts** (own deploy
  plane, collides with spec §11's GCP shape, and would swallow the `AuthProvider` /
  `SnapshotStore` seams we already own).
- What would change my mind: if Phase 4 judging is deferred indefinitely, keep Next route
  handlers and skip Phase 2 entirely. The custody fix does not depend on it.

## 6. Repo split — rejected

A private backend repo plus a public frontend repo buys one thing custody does not already
give us: it prevents a contributor from *accidentally* importing the bank. It costs:

- Atomic changes across the seam become two PRs and a version bump (the handlers and their
  callers change together constantly today).
- CI, vitest workspace, the purity sandbox, golden fixtures and `pnpm -r build` all fork.
- The `scorers[]` audit digest walks a source closure — splitting the repo splits the closure
  and makes PLAN.md's known cross-package hashing gap worse, not better.

Instead: keep one repo, make the **content** private (spec §14 already plans exactly this —
OCI-packaged, cosign-signed instrument packages loaded by digest), and enforce the boundary
mechanically, not by discipline:

- `packages/instrument` has no `browser` export condition and is not a dependency of any
  client module.
- A CI test greps the built client bundles for a known key/rationale string and any
  operational item id, and fails the build. The leak we just found must not be findable twice.
- A separate repo becomes right only when item writers need bank commit rights without
  platform commit rights. Then it is the **instrument package** that moves out — not the API.

## 7. Data layer and migrations

**Stay on raw `pg` with hand-written SQL.** `pg` 8.23.0: one advisory ever, none since 2024.
The alternatives fail on failure class, not features: all four Kysely 2026 advisories are
**injection bugs in its own SQL compiler** (one an incomplete fix of another); Drizzle has the
same class and its 1.0 is still RC. Parameterised `pg` has no such surface. Our SQL is
already SQL-shaped — partial unique indexes as `ON CONFLICT` targets, `num_nonnulls` CHECKs,
`ON CONFLICT DO NOTHING RETURNING` — and no builder type-checks those anyway. The 2-method
`Queryable` seam that lets tests run PGlite in-process is the property worth protecting.

**Adopt migration tooling. This is a real gap and hand-run SQL blocks will bite us.**

- `db/migrations/NNNN_name.sql` — forward-only, plain SQL, reviewable in a PR. The blocks
  currently in `db/README.md` become `0001…`.
- Applied in deployments by **dbmate** (single static binary, plain SQL, no ORM) or
  **node-pg-migrate 9** in SQL-file mode if we prefer staying in the pnpm ecosystem. Either is
  defensible; pick one in the implementation PR and do not keep both.
- Applied in tests by a ~20-line loop over the *same* files, so tests and production never
  diverge and PGlite needs no tool support. One set of SQL, two appliers — that is the DRY
  line, and the file order is the only shared contract.
- `db/schema.sql` becomes **generated** (`dbmate dump`) with a CI equality check, so it stays
  the readable artefact it already is without becoming a second truth.
- Rejected: **Atlas** (views/functions gated behind `atlas login`; a diff engine planning DDL
  against append-only tables is where you want a human), **graphile-migrate** (idempotent
  re-run model assumes a disposable dev DB), **Flyway** (JVM), **drizzle-kit** (requires the
  ORM). Keep the prose in `db/README.md` for the one migration whose data genuinely cannot be
  migrated (`share_links.token_sha256` → `token`); no tool solves that.

**UNVERIFIED**: whether any deployed database has drifted from `schema.sql`. Baseline
migration `0000` must be written to match what is actually deployed, not what is committed.

## 8. The judging pipeline (spec Phase 4) — the boundary that must survive

Judging is the workload that actually justifies a second runtime: model calls, ×3 samples,
medians, retries, minutes not milliseconds. Design the seam now, build it later.

```ts
// packages/backend/src/judging.ts — ONE module owns capture → judge → aggregate → scored
export interface JudgeRun { attemptId: string; trackId: TrackId; rubricVersion: string; }
export async function runJudging(ctx: JudgeContext, run: JudgeRun): Promise<void> {
  // not implemented — ×3 samples, median, disagreement flag; writes judgments then a score row
}
/** The only thing a request handler knows about async work. */
export interface JobQueue { enqueue(stage: StageName, payload: JobPayload): Promise<void>; }
```

Rules that make the later split a re-host rather than a re-architecture:

- **Idempotency lives in the database**, per spec §11 and `db/README.md`: the `judgments`
  UNIQUE constraint, not queue de-duplication. The queue only has to deliver at-least-once,
  which is why the queue choice is reversible.
- **Recommended queue: `pg-boss`** on the Postgres we already run (12.28.1, 1.49M dl/wk, zero
  advisories ever). Transactional enqueue in the same statement as the response insert, no
  second stateful system. Cloud Tasks stays available behind `JobQueue` when spec §11's GCP
  shape lands — note its task-level retry config is still Preview. Rejected BullMQ (adds
  Redis) and Inngest/Trigger.dev (hosted-first, control plane we do not need).
- `runJudging` takes the same context shape as a request handler, so it runs in-process
  today and in `services/worker` tomorrow with no signature change.
- Judge outputs are **stored as inputs**. `score()` still consumes stored judgments and stays
  pure. This is the invariant the whole architecture exists to protect.

## 9. Module and service map

```
packages/
  core/        TrackPlugin, content addressing, purity sandbox        (unchanged)
  session/     event-sourced engine                                   (unchanged)
  report/      composite, insights, export tiers                      (unchanged)
  tracks/*     Runner + PURE score()                                  (unchanged)
  instrument/  NEW · server-only · bank custody, redaction, grading, digest-pinned loader
  backend/     store + handlers + auth + t1 + share      (+ judging.ts, JobQueue; −sampleDecks?)
apps/
  web/         Next: pages, runners, presentation. Phase 1 keeps app/api adapters;
               Phase 2 deletes app/api/**/route.api.ts and lib/server/api.ts.
services/
  api/         PHASE 2 · Hono host over @ailx/backend handlers
  worker/      PHASE 2 · pg-boss consumer running @ailx/backend/judging
  openrouter-proxy/                                                    (unchanged)
instruments/
  demo-2026.1/ NEW · public practice tier (keys published on purpose)
  2026.1/      operational; bank moves to a private digest-pinned artefact
db/
  migrations/  NEW · forward-only SQL; schema.sql becomes generated
```

## 10. Migration plan — shippable at every step

Each step is independently releasable and independently revertible.

1. **Stop the leak (highest value, smallest diff).** Create `packages/instrument`; move
   `apps/web/lib/instrument.ts` into it behind `Instrument`; add
   `GET /api/attempts/:id/items` returning the `RedactedItem` union; publish
   `instruments/demo-2026.1` for the static build. Add the CI bundle-grep test. Ship. **The
   driver is now satisfied** even if nothing else in this document ever happens.
2. **Make custody real.** Move the operational bank out of the public repo into a private,
   digest-pinned artefact (spec §14 OCI + cosign, or a private package as an interim);
   `instruments.package_digest` records it. Rotate the 84 exposed operational items — they
   are burned,
   and a leaked bank cannot be un-leaked. Treat 2026.1's operational form as compromised and
   re-cut it.
3. **Migrations.** Baseline `0000` from the deployed database, then `0001…` from
   `db/README.md`'s blocks; generated `schema.sql` + CI equality check.
4. **Judging seam.** Land `judging.ts` and `JobQueue` with the in-process implementation and
   the `judgments` uniqueness test. No new deployable yet.
5. **Only then, if step 4 proved the need: extract.** `services/api` (Hono) + `services/worker`
   (pg-boss), `/v1` versioned surface, and **delete** `app/api/**/route.api.ts`,
   `lib/server/api.ts` and the `AILX_BACKEND` dual-mode branch. Budget for what this costs:
   CORS, a second deploy target, the loss of the `ailx_dev_user` cookie convenience, and
   server-rendered pages like `/progress` becoming client fetches.


### 10.1 Step 5, staged: the API base seam (2026-08-31)

`services/api` exists and is deployed
(`https://ailx-backend-932932410694.us-central1.run.app`, Cloud Run, project
`tenken-staging`), so the frontend can now be pointed at it. It is pointed by ONE
variable and the routes are NOT deleted yet.

**The seam.** `NEXT_PUBLIC_AILX_API_BASE` is read in exactly one place,
`apps/web/lib/mode.ts`, which exposes:

| helper | unset (today) | set to the service |
|---|---|---|
| `apiOrigin()` | `""` | the validated absolute origin |
| `apiBase()` | `<basePath>/api` | `<origin>/v1` |
| `siteApiRoot()` | `<basePath>/api` | `<origin>/api` |
| `siteHref(path)` | validated path, basePath-prefixed | validated path on the service |

Two path spaces, deliberately: the versioned API is `/api` here and `/v1` there, but a
served T1 snapshot is `/api/site/<digest>/index.html` on BOTH hosts, because that exact
string is already frozen inside issued share payloads and credential claims
(`packages/backend/src/site-url.ts`) and those rows are append-only. `siteHref()` validates
the stored path and resolves the host in one call, so no caller can do the second without
the first. A value that is not a bare absolute http(s) origin is ignored, not
half-honoured — `lib/origin.ts` holds the one origin predicate, shared with the server's
`AILX_PUBLIC_ORIGIN`. `apps/web/test/apiBase.test.ts` fails the build if a second module
reads the variable or hard-codes an `/api` fetch.

**Auth, cross-origin.** The `ailx_dev_user` cookie is `SameSite=Lax` and therefore is NOT
sent to another origin — the cookie convenience §10 step 5 predicted losing is lost the
moment the seam is set. It survives only for same-origin server-rendered pages. So:
**header for cross-origin, cookie for same-origin.** Every browser call already sent
`x-ailx-dev-user`; the two that did not (the reviewer's gallery decision and the moderator
comment) now do, and the service's CORS allowlist names that header explicitly. The
`DevAuthProvider` precedence is unchanged and still fails closed: an explicit header is
read first and an ILLEGAL header is refused outright, never demoted to the cookie.

**CORS.** `AILX_ALLOWED_ORIGINS` on the service is an explicit allowlist
(`https://rryoung98.github.io,https://ailx-staging.vercel.app`) that drops `*` and `null`
and never reflects an arbitrary `Origin`. A Vercel PREVIEW deployment gets a different
hostname and is therefore refused by design; only the production alias is allowed.

**`app/api/**` and `lib/server/api.ts` are now a DUPLICATE HOST.** They are kept only
because `apps/web/e2e/**` still boots the Next app and drives its own routes. Before they
can be deleted, in this order:

1. Repoint the Playwright suite at a running `services/api` (its fixtures seed the database
   and assert against `/api/...` today).
2. Move the server-rendered pages that read the database — `/progress`, `/s/[token]`,
   `/review`, `/verify/[code]`, `/gallery`, `/world` — off `lib/server/api.ts`. Each becomes
   either a client fetch through `apiBase()` (and loses the cookie identity, so `/progress`
   needs the header) or a page the service renders.
3. Delete `app/api/**/route.api.ts`, `lib/server/api.ts`, and the frontend half of the
   `AILX_BACKEND` dual-mode branch that exists only to compile them.

Until then the two hosts share one Neon database, so a request answered by either sees the
same rows — a duplicate host, not a second truth. That is tolerable for exactly as long as
step 1 takes.

### 10.2 Clerk: why the switch must be ATOMIC, and the recipe

`AILX_AUTH` has no default and dev auth is asserted, never proven, so staging must not stay
on `dev` once real people can reach it. The switch cannot be staged, though: the instant the
service is `AILX_AUTH=clerk`, every call carrying only `x-ailx-dev-user` is 401, and a
frontend without a signed-in user is a dead page. Provider, sign-in route, token seam and
the service's env therefore land together or not at all.

What already exists, dormant and tested (`apps/web/lib/authHeaders.ts`,
`apps/web/test/authHeaders.test.ts`): every browser call gets its identity headers from
`authHeaders()`. Register a source with `setAuthTokenSource(() => getToken())` and all of
them send `Authorization: Bearer <jwt>` instead of the dev id — no call site changes. A
token that is absent, empty, or whose refresh throws falls back to the dev id rather than
killing the run, because the SERVER decides whether that is enough. It is a registration
rather than an import so the static Pages export never pulls an auth SDK into its bundle.

The remaining steps, in order:

1. `pnpm --filter @ailx/web add @clerk/nextjs`.
2. `apps/web/app/layout.tsx`: wrap the tree in `<ClerkProvider>`. Hosted build only — the
   static export has no auth and must keep rendering without one.
3. A small client component mounted once (not in `lib/authHeaders.ts`, which must stay
   SDK-free) that calls `setAuthTokenSource(() => getToken())` on sign-in and
   `setAuthTokenSource(null)` on sign-out.
4. A `/sign-in` route, and whatever the run flow does when a candidate is anonymous.
5. Vercel (project `ailx-staging`, Production): add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   (publishable by design) and `CLERK_SECRET_KEY` if any server page verifies.
6. Cloud Run: repo variable `AILX_AUTH=clerk`; the deploy workflow then mounts
   `CLERK_SECRET_KEY=ailx-clerk-secret-key:latest` on its own
   (`.github/workflows/deploy.yml`). Drop `AILX_ALLOW_INSECURE_DEV_AUTH`.
7. Deploy the FRONTEND first (it still works on dev auth), then flip the service, then
   re-verify in a browser: sign in, create an attempt, sit a card, upload a T1 site.

Verify, not assume: a signed-in `fetch` must carry `Authorization`, and the row it writes
must land under `participants.auth_ref = clerk:<sub>`. That column is provider-scoped, so
the existing `dev:<id>` rows stay separate and nothing already in Neon is rewritten — the
same person signing in with Clerk becomes a NEW participant, which is correct and worth
saying out loud to anyone demoing a "previous" run.

Rollback: set the repo variable `AILX_AUTH=dev` (plus `AILX_ALLOW_INSECURE_DEV_AUTH=1`) and
redeploy the service, or `gcloud run services update-traffic ailx-backend --to-revisions
<previous>=100` for an immediate revert. The frontend needs no rollback: with no provider
mounted, `authHeaders()` is already back on the dev id.

The Clerk instance is a DEVELOPMENT instance repurposed from another product, which is fine
for staging and NOT fine for real candidates: dev instances have relaxed limits and a
separate user pool, so a production Clerk instance is a prerequisite for the first real
sitting.

## 11. What I would not do

- **Do not split the repository.** §6.
- **Do not move `score()` server-only or make it impure.** Purity is the audit story. The
  server becomes the only *issuer* of scores, not the only *runner* of the function.
- **Do not build tRPC/GraphQL/a BFF.** The API is ~20 REST routes consumed by one client.
- **Do not adopt an ORM or a query builder** to solve a problem we do not have, and do not
  put a schema DSL in front of partial unique indexes and CHECK constraints.
- **Do not start with the runtime split.** It answers a custody question with a deployment
  change and leaves the keys in the bundle for another month.
- **Do not keep two hosts alive** once a service exists. A second adapter over the same
  handlers is a pass-through layer and a second security posture to patch.
- **Do not adopt Bun, Redis, or a hosted job platform** for a low-QPS workload whose
  idempotency is already a database constraint.
- **Do not claim the leak is closed by rotation alone.** Rotate *and* move custody; the old
  bank stays public forever in git history.

## 12. Open questions (unverified)

- Does any deployed database differ from `db/schema.sql`? Decides migration `0000`.
- Does the `scorers[]` audit digest currently hash anything that would move into the private
  package? It must keep hashing `score()` source only — content digests are separate.
- Does the private-content requirement break a clean-clone hosted build for contributors?
  Intended answer: hosted mode falls back to `openDemoInstrument()` without a credential, and
  says so in the footer copy.
