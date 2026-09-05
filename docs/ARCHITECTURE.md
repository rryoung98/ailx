# ARCHITECTURE.md — separating the frontend from the exam

Status: decision document, 2026-08-30. Design only. This commit changed no application code.
It supersedes nothing. It answers the questions left open in spec §11 (architecture) and
§14 (versioning).

## 0. The question, unconflated

The request was "build an API backend and DB so we can separate the frontend". It contains
three separate decisions:

1. **Content custody** — where the secure bytes live and who may read them.
2. **Runtime split** — one deployable, or a frontend plus a separate API service.
3. **Repo split** — one repository, or a public frontend repo plus a private backend repo.

Only the first follows from the precipitating fact. We will make the other two later if the
evidence supports them. This document defines when.

### The precipitating fact (verified)

`apps/web/lib/instrument/instrument.ts` statically imports `instruments/2026.1/snapshot.json`. The
snapshot carried all 104 T2 items with `key`, `rationale` and `provenance`. Since
2026-08-30, it carries the 84 operational items. The other 20 moved to the released-practice
tier `instruments/demo-2026.1` — see §10 step 1. The deployed static export leaks them:

```
apps/web/out/_next/static/chunks/638-614dcaf82a885294.js
  → 40 occurrences of "key":"ai"
  → "rationale":"Genuinely model-generated (see provenance)…"
```

The repository is public as well, so the bank is readable twice over. An exam with a public
item bank and answer keys
is a worksheet, not an exam. Server-side scoring is also the assessment-industry baseline.
ATP/ITC *Guidelines for Technology-Based Assessment* v1.1 (July 2025) §3.6 says,
"Scoring should be conducted at the server level to prevent compromise or subversion at the
browser level."

The existing design determines the solution. `packages/backend` handlers use the
framework-independent shape `(ctx, headers, body) => {status, body}`.
`apps/web/app/api/**/route.api.ts` contains thin adapters.
`packages/backend/src/practice.ts` already uses the required security pattern. It deals the
deck and computes grades on the server. It refuses answers to undealt items. It never puts the
bank in a client module. FRONTEND.md §4.7 already treats client-provided answer keys and item
selection as untrusted. **The policy exists; T2 does not obey it.**

## 1. Recommendation

**Phase 1 (now): custody, not topology.** Keep one repo and one Next.js deployment. Add one
server-only deep module, `packages/instrument`, which owns the operational bank, deck
sampling, redaction and grading. Move the operational bank to a private, digest-pinned
source. Ship a public **practice-tier** instrument (spec §09's released tier). It keeps the
GitHub Pages demo working with published keys and an honest label.

**Phase 2 (when Phase 4 judging lands, not before): runtime split inside one repo.** Re-host
the same handlers in `services/api` (Hono) and add `services/worker` for judging. `apps/web`
becomes a client of a versioned `/v1` API and `apps/web/lib/server/api.ts` plus
`app/api/**/route.api.ts` are **deleted** — a second host that leaves the first in place is a
pass-through layer and a second truth.

**Never: a repo split.** See §6.

The work is staged. Phase 1 delivers the main requirement: the browser cannot see an answer
key. It adds one package and one route. Phase 2 requires a concrete workload: long-running
model calls that must not run inside a serverless request. A preference for microservices is
not enough.

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

The server **derives** the phase from `attempt.finalized_at`. It never trusts a query
parameter. The client requests a phase. The server decides the phase. `practice.ts` already
follows this rule.

### 2.2 The static GitHub Pages demo — same call site, different provider

```ts
// apps/web/lib/instrument/instrument.client.ts (bundled in BOTH builds)
export const trackConfig = isServerMode() ? fetchTrackConfig : demoTrackConfig;
// demoTrackConfig comes from instruments/demo-2026.1 — the released practice tier:
// 20 items, keys and rationales published ON PURPOSE, labelled "practice".
```

The operational bank is absent from that build's module graph. `footerModeCopy()`
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

`ApiContext` gains `instrument` and **loses** `sampleDecks?`. That callback only forwards
arguments. The new module absorbs it. `packages/backend` remains content-independent. It
holds an interface, not a bank.

The module has six methods. They hide package fetching, digest verification, bank parsing,
locale fallback, the `material` transform, deck sampling, key custody, redaction policy,
phase authorisation, exposure seconds, and rubric and scoring digest lookups. This covers all
357 lines of today's `apps/web/lib/instrument/instrument.ts` plus the loader. Moving the module also
satisfies the FRONTEND.md §9 / PLAN.md Phase 1 requirement that `instrument.ts` leave
`apps/web`. An injected `(path: string) => string` replaces the asset-URL coupling that
blocked the move.

Red flags screened (per the architect skill's `design-red-flags.md`):

- **Information leakage — rejected** "return the full item and let the client call
  `redactItem()`". That puts one policy in two places, including the candidate's machine.
- **Pass-through — removed one** (`ApiContext.sampleDecks?`).
- **Temporal decomposition — rejected** a `loadBank → validate → sample → redact` chain of
  four modules that parse the same item shape. One module owns "what an item is and who may see it".
- **Shallow module — rejected** a `ContentClient` HTTP wrapper over a separate content
  service. It adds auth, retries, caching, and error mapping but hides only a `fetch`.

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

This design has these consequences:

- In hosted mode the browser **cannot** compute a T2 score during the sitting because
  `score()` needs the keys. FRONTEND.md §4.7 already says client scores are advisory. The
  server recomputes the score of record from the append-only log. Until finalize, the UI
  shows progress but not correctness.
- `score()` does **not** move or change. It remains pure in `packages/tracks`, inside the CI
  purity sandbox. Any runtime that needs it can import it. Purity + stored inputs + the
  `scorers[]` source digest provide byte-identical recomputability. The runtime location does
  not. Only the actor allowed to **issue** a score row changes.
- For T3/T4, the judge's output is one of those **stored inputs**. An LLM judge is not
  reproducible even at temperature 0 (spec §14). A pipeline stage collects the evidence once.
  The row is immutable and content-addressed. `score()` replays it. Re-scoring reproduces;
  re-judging does not. We publish both facts.
- Screenshot leakage is not solved by any of this. Only three-tier rotation and a withheld
  anchor block (spec §09) address a candidate photographing items. Custody stops bulk
  extraction; it does not stop a camera.

## 5. Stack decision (Phase 2, prepared now)

Use **Hono** if and when we extract a service. It is Fetch-native.
`apps/web/lib/server/api.ts` already uses `Request`/`Response`, so it ports almost verbatim.
The same binary runs on Node, Cloud Run, Bun and Workers without a host rewrite. `hc<AppType>`
provides a typed client without a codegen step.

This evidence came from npm registry, GitHub API and the GitHub Advisory Database on
2026-08-30. It excludes blog-tier sources:

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
  sitting is low-QPS. Judging uses multi-second model calls. Framework routing takes
  microseconds — under 0.1% of request latency. Benchmarks do not decide this.
- **Patch surface does decide it.** Next.js has the weakest 2026 posture in the table. Its
  advisories affect the request-handling path used by an exam API. Serving the exam and the
  marketing site from one process ties the exam's patch schedule to a frontend framework.
  This patch risk, not performance, supports a separate host.
- Hono's advisory count is disclosure discipline plus a wide optional-middleware surface, not
  defect density; we use core only. It is still real patch load: 68 releases in 12 months.
- Rejected: **NestJS** (DI over ~190 lines of plain functions), **Fastify** (Node-only; core
  advisories affect more code; a second schema system beside our validators), **Express**
  (no Fetch, weakest types), **Elysia** (Bun lock-in), **Encore.ts** (own deploy plane,
  conflicts with spec §11's GCP shape, and would absorb the `AuthProvider` / `SnapshotStore`
  seams we already own).
- What would change my mind: if Phase 4 judging is deferred indefinitely, keep Next route
  handlers and skip Phase 2 entirely. The custody fix does not depend on it.

## 6. Repo split — rejected

A private backend repo plus a public frontend repo adds one protection beyond custody. It
prevents a contributor from *accidentally* importing the bank. It also adds these costs:

- Atomic changes across the seam become two PRs and a version bump (the handlers and their
  callers change together constantly today).
- CI, vitest workspace, the purity sandbox, golden fixtures and `pnpm -r build` all fork.
- The `scorers[]` audit digest walks a source closure — splitting the repo splits the closure
  and makes PLAN.md's known cross-package hashing gap worse, not better.

Instead, keep one repo and make the **content** private. Spec §14 already calls for
OCI-packaged, cosign-signed instrument packages loaded by digest. Enforce the boundary in
code and CI:

- `packages/instrument` has no `browser` export condition and is not a dependency of any
  client module.
- A CI test greps the built client bundles for a known key/rationale string and any
  operational item id, and fails the build. The leak we just found must not be findable twice.
- A separate repo becomes right only when item writers need bank commit rights without
  platform commit rights. At that point, move the **instrument package**, not the API.

## 7. Data layer and migrations

**Stay on raw `pg` with hand-written SQL.** `pg` 8.23.0 has had one advisory and none since
2024. The alternatives introduce a different failure class. All four Kysely 2026 advisories
are **injection bugs in its own SQL compiler**; one incompletely fixed another. Drizzle has
the same class of bug, and its 1.0 is still RC. Parameterised `pg` has no SQL compiler to
expose. Our SQL uses features that builders do not type-check: partial unique indexes as
`ON CONFLICT` targets, `num_nonnulls` CHECKs, and `ON CONFLICT DO NOTHING RETURNING`. Keep
the 2-method `Queryable` interface that lets tests run PGlite in-process.

**Adopt migration tooling. Hand-run SQL blocks leave a real gap.**

- `db/migrations/NNNN_name.sql` — forward-only, plain SQL, reviewable in a PR. The blocks
  currently in `db/README.md` become `0001…`.
- Apply migrations in deployments with **dbmate** (single static binary, plain SQL, no ORM)
  or **node-pg-migrate 9** in SQL-file mode if we choose the pnpm ecosystem. Pick one in the
  implementation PR. Do not keep both.
- A ~20-line loop applies the *same* files in tests. Tests and production therefore use one
  set of SQL, while PGlite needs no tool support. The two appliers share only the file order.
- Generate `db/schema.sql` with `dbmate dump` and check equality in CI. It remains a readable
  artefact without becoming a second source of truth.
- Rejected: **Atlas** (views/functions gated behind `atlas login`; a diff engine planning DDL
  against append-only tables is where you want a human), **graphile-migrate** (idempotent
  re-run model assumes a disposable dev DB), **Flyway** (JVM), **drizzle-kit** (requires the
  ORM). Keep the prose in `db/README.md` for the one migration whose data genuinely cannot be
  migrated (`share_links.token_sha256` → `token`); no tool solves that.

**UNVERIFIED**: whether any deployed database differs from `schema.sql`. Baseline migration
`0000` must match the deployed database, not the committed file.

## 8. The judging pipeline (spec Phase 4) — the boundary that must survive

Judging justifies a second runtime. It needs model calls, ×3 samples, medians, and retries.
It takes minutes, not milliseconds. Design the interface now and build it later.

```ts
// packages/backend/src/judging.ts — ONE module owns capture → judge → aggregate → scored
export interface JudgeRun { attemptId: string; trackId: TrackId; rubricVersion: string; }
export async function runJudging(ctx: JudgeContext, run: JudgeRun): Promise<void> {
  // not implemented — ×3 samples, median, disagreement flag; writes judgments then a score row
}
/** The only thing a request handler knows about async work. */
export interface JobQueue { enqueue(stage: StageName, payload: JobPayload): Promise<void>; }
```

These rules let the later split change the host without changing the design:

- **Idempotency lives in the database**, as required by spec §11 and `db/README.md`. The
  `judgments` UNIQUE constraint provides it, not queue de-duplication. The queue only needs
  at-least-once delivery, so we can replace it later.
- **Recommended queue: `pg-boss`** on the Postgres we already run (12.28.1, 1.49M dl/wk, zero
  advisories ever). It can enqueue a job transactionally in the same statement as the
  response insert. It adds no second stateful system. Cloud Tasks remains available behind
  `JobQueue` when spec §11's GCP shape lands. Its task-level retry config is still Preview.
  Reject BullMQ because it adds Redis. Reject Inngest/Trigger.dev because they are
  hosted-first control planes we do not need.
- `runJudging` takes the same context shape as a request handler, so it runs in-process
  today and in `services/worker` tomorrow with no signature change.
- Judge outputs are **stored as inputs**. `score()` continues to consume stored judgments and
  remains pure. The architecture must preserve this invariant.

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
  openrouter-proxy/  unchanged, and it STAYS: the service's /v1/model/* gateway
                     refuses an anonymous caller, so the Pages export cannot use
                     it (TEN-62)
instruments/
  demo-2026.1/ NEW · public practice tier (keys published on purpose)
  2026.1/      operational; bank moves to a private digest-pinned artefact
db/
  migrations/  NEW · forward-only SQL; schema.sql becomes generated
```

## 10. Migration plan — shippable at every step

Each step can ship and be reverted on its own.

1. **Stop the leak (highest value, smallest diff).** Create `packages/instrument`. Move
   `apps/web/lib/instrument/instrument.ts` into it behind `Instrument`; add
   `GET /api/attempts/:id/items` returning the `RedactedItem` union; publish
   `instruments/demo-2026.1` for the static build. Add the CI bundle-grep test. Ship. **The
   driver is now satisfied** even if no later step happens.
2. **Make custody real.** Move the operational bank from the public repo into a private,
   digest-pinned artefact (spec §14 OCI + cosign, or a private package as an interim);
   `instruments.package_digest` records it. Rotate the 84 exposed operational items — they
   are burned, and a leaked bank cannot be un-leaked. Treat 2026.1's operational form as
   compromised and re-cut it.
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

**The duplicate host is GONE (2026-08-31).** `app/api/**` and `lib/server/api.ts` were kept
only because `apps/web/e2e/**` booted the Next app and drove its own routes. All three steps
below are done, in this order, and the rest of this section is the record of what each one
cost:

1. ~~Repoint the Playwright suite at a running `services/api`.~~ Done.
2. ~~Move the server-rendered pages off `lib/server/api.ts`.~~ Done.
3. ~~Delete `app/api/**/route.api.ts` and `lib/server/api.ts`.~~ Done — with
   `packages/backend`, `packages/instrument`, `db/` and the `pg` dependency.

`packages/core/test/frontendOnly.test.ts` now fails the build if any of it comes back, and
the private repo's `pnpm sync:shared:check` fails if a package both repos need stops
matching this one. Read §10.3 before adding a route handler here.

**Step 2 is done: the seven server-rendered pages now fetch.** `/progress`, `/world`,
`/gallery`, `/review`, `/review/[id]`, `/s/[token]` and `/verify/[code]` no longer import
`lib/server/api.ts` or an `@ailx/backend` handler. Each keeps its `page.api.tsx` NAME —
that extension is the only thing keeping a database-backed page out of the static export,
and it never obliged the file to be server-only — but the file is now a shell that exports
`metadata` around a client component in `apps/web/lib/`. All seven go through ONE module,
`apps/web/lib/data/serviceFetch.ts`, so the URL always comes from `apiBase()`, a non-200 keeps
its status, and a thrown fetch becomes a sentence instead of a blank page. **Identity is
now a header, everywhere.** The `ailx_dev_user` cookie is `SameSite=Lax`, so the moment the
seam names another origin it is not sent at all; the three identity-carrying pages —
`/progress`, `/review`, `/review/[id]` — pass `identified: true` and send
`x-ailx-dev-user` (or the Clerk bearer) from `lib/data/authHeaders.ts`. `/world`, `/gallery`,
`/s/[token]` and `/verify/[code]` send nothing, because a public wall, a capability link
and a public credential must not depend on who is asking. Two consequences worth stating:
`generateMetadata` for `/s/[token]` and `/verify/[code]` still runs on the SERVER and does
its own read (a scraper never runs client code, and no read means no Open Graph card), for
which `lib/server/page.ts` makes `apiBase()` absolute; and the `/s/[token]` page no longer
COUNTS a view, because neither `GET /api/share/:token` nor `GET /v1/share/:token` counts
one — the figure it renders is still the store's, never the page's.

Four of the seven have no `/api` twin on this host: `/progress`, `/world`, `/gallery` and
`/review` call `/progress`, `/aggregates`, `/gallery` and `/moderation/cases`, which exist
under `/v1` in `services/api` but were never Next route handlers. With the seam unset those
four pages therefore render their honest "we could not reach the Foray service" state rather
than data. That is correct for the direction of travel — step 3 deletes `app/api/**`
anyway — but it means those pages need `NEXT_PUBLIC_AILX_API_BASE` set to work at all.

### 10.2 Clerk: why the switch must be ATOMIC, and the recipe

`AILX_AUTH` has no default and dev auth is asserted, never proven, so staging must not stay
on `dev` once real people can reach it. The switch cannot be staged, though: the instant the
service is `AILX_AUTH=clerk`, every call carrying only `x-ailx-dev-user` is 401, and a
frontend without a signed-in user is a dead page. Provider, sign-in route, token seam and
the service's env therefore land together or not at all.

What already exists, dormant and tested (`apps/web/lib/data/authHeaders.ts`,
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
3. A small client component mounted once (not in `lib/data/authHeaders.ts`, which must stay
   SDK-free) that calls `setAuthTokenSource(() => getToken())` on sign-in and
   `setAuthTokenSource(null)` on sign-out.
4. A `/sign-in` route, and whatever the run flow does when a candidate is anonymous.
5. Vercel (project `ailx-staging`, Production): add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   (publishable by design). NOT `CLERK_SECRET_KEY` — see "what steps 1-4 decided" below.
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

**Steps 1-4 are done (2026-09-01), and four things they decided.**

- *Nothing changes until a key exists.* `isClerkEnabled()` (`apps/web/lib/mode.ts`, the only
  reader of the variable) needs BOTH `AILX_BACKEND=1` and a publishable key. Without one no
  provider mounts, `authHeaders()` sends the asserted dev id, and the app is exactly what it
  was. Unsetting the key IS the frontend rollback, so the flip stays reversible in both
  directions.
- *The static export resolves a stub, not the SDK.* `app/layout.tsx` is ONE file for both
  builds, so the import of `@clerk/nextjs` sits in both graphs — and an import is enough to
  bundle it, whether or not the provider ever renders. `next.config.mjs` therefore aliases the
  package to `lib/auth/clerkStub.tsx` in the export build. `lib/data/authHeaders.ts` stays SDK-free
  as promised; the only modules that touch Clerk are `lib/auth/*` and the two sign-in pages,
  and a test pins that list.
- *No middleware, and no `CLERK_SECRET_KEY` in this repo.* This app verifies no token: Clerk
  runs in the BROWSER, the bridge hands `getToken()` to the header seam, and the exam service
  is the only thing that checks the JWT. `clerkMiddleware()` exists to make `auth()` work in a
  server component, which nothing here does — adding it would put a Clerk secret and a second
  auth surface into a repository whose own guard bans `@clerk/backend`.
- *Sign-in is a link, never a gate.* `/sign-in` and `/sign-up` are `page.api.tsx`, hosted-only
  by name, and nothing redirects to them. The game plays anonymously on the dev identity; an
  account buys a sitting that can be scored on the record and progress that outlives one
  browser. Forcing an account in front of `/practice` would trade the on-ramp for a signup.

One trap, paid for in a failed build: `@clerk/nextjs` v7 is Clerk **Core 3**, which REMOVED
`<SignedIn>`, `<SignedOut>` and `<Protect>` — it still exports them, as functions that throw
the moment they render, so every Core 2 snippet on the internet compiles here and dies during
prerender. Conditional UI asks `useAuth()`. `test/clerkMount.test.tsx` calls each imported
name against the real package and fails on that error message.

### 10.3 Step 3, and the three things it could not simply delete (2026-08-31)

**What went.** `apps/web/app/api/**` (25 route handlers), `lib/server/{api,site,instrument}.ts`,
`packages/backend`, `packages/instrument`, `db/`, and the `pg` / `@types/pg` /
`@ailx/backend` / `@ailx/instrument` dependencies. Roughly 16,000 lines. The public repository
is a frontend.

**The Playwright suite (step 1).** It seeds through the exam service now. `apps/web/e2e/service.ts`
is the only module that reads `AILX_E2E_API_BASE`, mirroring the one-place rule `lib/mode.ts`
follows, so `/v1` and the frozen `/api/site/<digest>` space cannot drift apart here either. There
is deliberately NO DEFAULT: a default of localhost makes a suite that seeds nothing look like a
suite that passed, and a default of staging writes append-only rows into a database people demo
from. The skip is granular — only files taking the seeding fixtures skip, with a reason naming the
variable, and the measurement specs still run with no backend at all. A suite that quietly skips
itself into silence is the same bug as a test that cannot fail (FRONTEND.md §6.7.3). Public CI
cannot boot a private service, so its `e2e` job is a documented skip and the private repo's CI
runs the same specs against a freshly booted `services/api`.

**One route handler survived, and it MOVED.** The Open Graph card is `app/s/[token]/card.png`,
beside the view it previews. It is not an exam handler: it reads the already-public share payload
over HTTP, holds no key, touches no store and makes no policy decision. What it does is
RASTERIZE, and rendering the frontend's own pictures is the frontend's job — putting it in
`services/api` would put React and satori inside the exam image, which that repo is deliberately
kept free of. Moving it out of `/api` is what lets the guard say "no `app/api/**`, ever" instead
of carrying an exception. Safe to move because `shareCardPath()` is computed when the page renders
its meta tags and is never frozen into an issued payload — unlike `/api/site/<digest>`, which is,
and which is exactly why THAT path space did not move.

**Three cross-repo assertions were rehomed, not dropped.** Each had been an in-process round trip
that only worked while both halves lived in one repository:

- *Dev identity.* The browser wrote a header and handed it straight to `DevAuthProvider`. The rule
  now lives once, in `@ailx/contract` (`DEV_USER_RE` / `isDevUserId`), and each repo pins its own
  half: here, every id the browser emits satisfies the predicate; there,
  `packages/backend/test/devIdentityContract.test.ts` asserts the provider accepts EXACTLY that
  set and refuses everything else, and fails if anyone re-adds a private copy of the regex. That is
  stronger than the round trip it replaces, which could only ever see one repo.
- *The T1 ZIP.* A candidate's browser zips their site and the service decides whether it is
  admissible; if the halves disagree by one CRC, every submission dies at the last step of a timed
  track. The test moved to the private repo, where the validator is, and drives `writeStoredZip`
  from `@ailx/core` — the same function `buildSiteZip` re-exports here, vendored there and compared
  byte for byte by the sync gate.
- *Server-only naming.* `serverOnlyPages.test.ts` now asserts there are NO `api/**` files at all,
  rather than naming which routes had to be server-only.

**The view counter, which the page migration silently dropped.** `/s/[token]` counted a view by
passing `countView` into the same call that read the share, because rendering the page and reading
the store were one server-side act. They are not any more, and putting `countView` back on the GET
would have counted every Open Graph crawler and link checker as a person opening the link. Counting
is now `POST /v1/share/:token/views`: same capability rule, same 404 for a revoked or unknown token
so a counter cannot confirm a link ever existed, and the read stays safe.

The route was mounted with no caller for a while, so `share_views` stayed empty and every surface
that reads it showed a zero it had no way to earn. The browser posts it now (TEN-146,
`apps/web/lib/data/shareViews.ts`): anonymous — no identity header, no cookie, no body, so the
request is CORS-simple — fired only from the RESOLVED branch of the share view, once per token per
browsing session through the funnel's own dedupe, and silent in a build with no API base. It is
fire and forget: the response is never read, a refusal is an uncounted view, and nothing is retried.

**It does not duplicate `funnel_events.share_opened`, and the two will not agree.** The funnel
carries no share token on purpose — a capability in a metrics table is a leak with a retention
policy — so it can only say opens-over-creates in aggregate; `share_views` is per-link and is the
only thing that can say WHICH link travelled. They also count different populations: the funnel
step is deduped per browsing session across ALL cards, a browser with storage denied drops funnel
rows it still counts here, and a `keepalive` POST refused by the anonymous limiter shows up in one
and not the other. Each number is honest about its own question; neither is a check on the other.

**The released-practice tier is now SHARED, with this repo as the source of truth.** It is public
by design and both repos serve it, and for one afternoon they served two different versions of it:
redacting the rubrics here moved all four `rubricVersion` values, while the private copy still
carried the old ones — so a practice score cut by the service would have recorded a version the
browser never displayed. `instruments/demo-2026.1` is in the sync contract now, as an explicit
FILE LIST rather than a directory, because the private copy legitimately keeps judge prompts and
dealt `form.json` files beside the shared ones and a directory-wide rule would have pushed those
the wrong way.

### 10.4 Public pages, and the identity a visitor does not have (2026-09-04, TEN-107)

`/gallery` and `/world` are public surfaces: a reader with no account is meant to
read them. On staging they were both broken, and the browser's half of that is
fixed here.

**What went wrong.** `/world` asked `GET /v1/aggregates` with no identity and got
401. Every `/v1` route sits behind `apiRoute` in the private repo, so an
unauthenticated caller is refused before a body is read; the page only ever
looked fine because a developer's browser had asserted a dev id in
localStorage. The trace seam's test (`apps/web/test/traceparent.test.ts`) could
not catch it: it proves a call goes THROUGH `serviceHeaders`, and this one did
— it just asked for no identity, which was an unspoken default. The seam now
requires every service read to NAME its identity (`"anonymous"`, `"optional"`
or `"required"`), because a decision nobody wrote down is a decision nobody
reviews.

**The frontend is correct under BOTH policies.** The two public pages ask with
`identity: "optional"`: they send the id this browser already has, and they
MINT none. Under today's policy a returning browser keeps working; under an
anonymous-read policy nothing changes; and a first-time visitor is never shown
a page that worked only because it invented a caller.

**The recommendation, which belongs in the private repo.** `GET /v1/gallery`,
`GET /v1/aggregates` and `GET /v1/share/:token` should be served anonymously.
All three are already public by construction — the gallery response drops
`approvedBy`, aggregates publish nothing below `MIN_COHORT_SIZE` and a share
token is itself the capability — so authentication on them protects nothing and
costs the audience the gallery exists to reach. Every write and every
candidate-scoped read stays authenticated. Not done here: this repo has no
handlers.

**The gallery query is one contract.** The page used to forward its own URL to
the service verbatim, so `?sort=top&site=0` reached the wire and came back 400.
`top` is `/wall`'s vote sort and has never been a gallery sort — it is not being
added — and an absent filter is an ABSENT parameter, never `site=0`. The browser
now reads its URL with `parseGalleryQuery` and writes the service's query with
`galleryQueryString`, both from `@ailx/contract`, so a spelling the parser
refuses cannot leave the browser. `galleryQueryString` and `parseApiError` are
NEW exports of `@ailx/contract`: the private repo vendors that package byte for
byte and needs a re-vendor.

**Three failures, three sentences.** "We could not reach the Foray service" was
false for both defects: the service was reached and refused. A failed read is
now one of three facts, each with its own copy — the call never landed
(`SERVICE_ERROR_COPY`), the call landed and was refused with a status and the
service's own reason (`serviceRefusedCopy`), or the answer is real and empty.

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
