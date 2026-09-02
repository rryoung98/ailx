# AGENTS.md — AILX (resilience)

Monorepo for AILX, the AI Literacy Examination. Spec: `AILX-Spec-2026.1.md`. Plan: `docs/PLAN.md`. Positioning: `docs/POSITIONING.md`. Progression/streaks loop: `docs/PROGRESSION.md`.

## Layout

**This repository is a FRONTEND.** The exam service — the HTTP handlers, the append-only store,
the auth providers and the OPERATIONAL item bank — lives in the PRIVATE `rryoung98/ailx-backend`
repository and nowhere else. It used to live here too, and that cost us twice: the bank was
readable in a public JS chunk, and the two copies of the handlers drifted until a browser called
a route the deployed service did not have. Do not bring either back. See "The repository split".

- `apps/web/` — Next.js frontend. Static export on GitHub Pages, and a hosted build (`AILX_BACKEND=1`) that adds the seven database-reading PAGES. It has NO API routes: it calls the exam service through `lib/mode.ts`
- `packages/core/` — TrackPlugin interface, scoring purity harness, content addressing, the T1 ZIP writer
- `packages/contract/` — the browser-facing API CONTRACT: wire types, frozen URL spellings, query parsers, the dev-identity predicate. Pure — no `node:`, no env, no I/O
- `packages/report/` — pure scoring-adjacent derivation: composite, insights, calibration, export tiers, demo judging, track metadata
- `packages/tracks/` — t1-creative-build, t2-discrimination, t3-reasoning, t4-generative
- `packages/session/` — event-sourced session engine
- `instruments/demo-2026.1/` — the ONLY instrument in this repo. PUBLIC released-practice tier for the static demo: 20 T2 items whose keys/rationales are published on purpose, no score of record. Self-contained and REDACTED — `manifest.yaml` sets `redacted: true`, and the content-tools loader refuses the package if a rubric `description`, a `band_anchors` block or a `prompts/` directory ever appears. Regenerate with `pnpm --filter @ailx/content-tools run snapshot:demo-2026.1`
- The OPERATIONAL tier (`instruments/2026.1`: 84 keyed T2 items, T1/T3/T4 judge prompts, rubric marking detail, the T1/T3/T4 `form.json` files) lives in the PRIVATE backend repo and must never be added here. `packages/content-tools/test/public-tree.test.ts` fails the build if it comes back
- `instruments/characters/2026.1/` — the sixteen player-type characters (art direction, prompts, vetting ledger); assets ship in `apps/web/public/characters/`
- `services/` — openrouter-proxy (the shared demo MODEL proxy; it holds no exam content and answers no exam route)
- `infra/` — GCP infrastructure

## The repository split

| | public (`rryoung98/ailx`) | private (`rryoung98/ailx-backend`) |
|---|---|---|
| the browser's code | **here** | — |
| HTTP handlers, store, auth | — | **there** (`packages/backend`, `services/api`) |
| operational bank, judge prompts | — | **there** (`instruments/2026.1`) |
| released-practice tier | **source of truth** | vendored copy |
| `core`, `contract`, `report`, `session` | **source of truth** | vendored copy |

**Two gates keep it that way, and they are not optional.**

- Here: `packages/core/test/frontendOnly.test.ts` fails if this repo declares or imports
  `@ailx/backend`/`@ailx/instrument`, grows a `pg`/`node-pg-migrate`/`@clerk/backend`
  dependency, grows an `app/api/**` route, re-adds a server request adapter or `db/`, or adds
  a second route handler. It fails just as loudly if what a browser legitimately needs goes
  missing. `packages/content-tools/test/public-tree.test.ts` guards the content tree.
- There: `pnpm sync:shared:check` compares the vendored copies byte for byte against THIS repo
  on every PR. **This repo is the source of truth**, so fix a shared package HERE and sync it
  there — never the other way round.

There is exactly ONE route handler in this repo, `app/s/[token]/card.png`: the frontend's own
Open Graph image. It rasterizes an already-public share payload. It holds no key, touches no
store and decides no policy, and the guard allows it BY NAME so a second one is a decision
somebody makes in front of a reviewer.

## Commands
- `pnpm install` · `pnpm test` · `pnpm -r build` (both must pass before any commit)
- `pnpm test` is ONE vitest for the whole monorepo (`vitest-workspace.ts`), with one worker pool capped at 4 forks — the ceiling is memory, not CPU. Raise it with `AILX_TEST_FORKS=8 pnpm test` on a big machine. `pnpm -r test` still works and still runs the same tests, but it starts a vitest per package, so it costs more RAM and more time.
- `vitest run` inside a package is the way to debug one package.
- `pnpm test:reap` — kill vitest workers orphaned by an interrupted run (reparented to pid 1, each still holding its heap). The capped pool and the per-file PGlite close make this rare rather than routine.
- `pnpm --filter @ailx/web e2e` — Playwright (FRONTEND.md §6). Deliberately outside `pnpm test`. It boots the frontend itself but needs a RUNNING EXAM SERVICE: set `AILX_E2E_API_BASE` to a throw-away `services/api` from the private repo (never staging — every spec appends rows). There is no default, on purpose: guessing localhost makes a suite that seeds nothing look like it passed. Only the seeding specs skip without it; the measurement specs still run. See `apps/web/e2e/README.md`.
- Run the static build and `AILX_BACKEND=1 pnpm --filter @ailx/web build` SEQUENTIALLY. Two concurrent `next build`s into `apps/web/.next` fail with a bogus "Cannot find module for page". `rm -rf apps/web/.next` between the two as well: a build over the OTHER mode's leftover output failed twice on 2026-09-01, once with a prerender "Cannot read properties of undefined (reading 'call')" and once with a missing `next-font-manifest.json`. Neither error names the real cause.
- Never run `next dev` in `apps/web` while anyone is testing: it leaves unminified dev chunks in `.next/static`, and `test/bundleSecrecy.test.ts` greps exactly that directory. The failure is a false positive, but it is indistinguishable from a real leak until you know.
- The e2e suite always boots its own server. `AILX_E2E_REUSE_SERVER=1` reuses whatever is already on the port for a fast inner loop — and then YOU own what is on that port. It is opt-in because a next-server orphaned by a dead agent once held 3210 for a day and the suite silently tested it, green.

## Credential and diagnosis
- `docs/CREDENTIAL.md` — what an AILX credential asserts (a completed sitting,
  never a score), why it is Open Badges 3.0 shaped with hosted verification,
  how it upgrades to a scored claim without reissuing, and why a revoked
  credential still resolves while a revoked share token 404s.

## Sampling and the population statistic
- `docs/SAMPLING.md` — the two-track design that separates the self-selected web
  cohort (item calibration, individual credentials) from a bought probability
  panel (the only source of a published population statistic): what may cross
  between them, the schema-level firewall that stops the two being averaged,
  minimum n and precision, weighting, coverage limits, device effects, the
  non-response bias analysis we publish unprompted, the exact hedging language
  for convenience-sample findings, and the cost of a first release.

## Frontend/backend separation
- `docs/ARCHITECTURE.md` — the decision document for splitting the frontend from
  the exam: why content custody (a private, digest-pinned item bank plus a
  server-rendered redacted item view) comes first, why the runtime split waits
  for the Phase 4 judging workload, why the repo is not split, and the stack,
  data-layer and migration choices that follow.

## Deploying the hosted mode
- `docs/DEPLOY.md` — Vercel (serverless) deploy: required env vars, T1 snapshot
  storage on Vercel Blob, Neon connection pooling, platform body-size limits,
  and why staging should use Clerk rather than assert-only dev auth. The
  default GitHub Pages static export is unaffected by any of it.

## Scale, concurrency and the idle bill
- `docs/LOAD-TEST.md` — what the exam service's Cloud Run is set to today and which
  values are defaults rather than decisions, what one request costs on each path, the
  load-test plan with its pass/fail thresholds fixed in advance, and the price of every
  min-instances option. Cloud Run concurrency is 80 while the pg pool is 3, so an
  instance can serve 3 database requests at once; that gap is the first thing to fix.
  Serving is inside the free tier at every traffic level we can foresee. The bill is idle.

## Frontend standard
- `FRONTEND.md` — module boundaries, security, clean-code, testing and migration rules for `apps/web` and `packages/tracks`. Read it before touching frontend code.

## Frontend environment (`apps/web`)

Short, because this app is a frontend. Everything about the database, the auth mode, the
snapshot store, the reviewer allowlist, the connection pool and the GitHub export now belongs to
the exam service — see the PRIVATE repo's README §3. If you find yourself wanting to set
`DATABASE_URL` here, the thing you want is running `services/api`.

- `AILX_BACKEND=1` — add `page.api.tsx` / `route.api.ts` to `pageExtensions`, i.e. build the
  seven database-reading PAGES and the one Open Graph card route. Unset = the static Pages
  export, which has none of them. It no longer compiles any API route, because there are none.
- `NEXT_PUBLIC_AILX_API_BASE` — the exam service's absolute origin (Cloud Run). Read in exactly
  ONE place, `apps/web/lib/mode.ts` (`apiBase()`, `siteApiRoot()`, `siteHref()`); a test fails
  the build if a second module reads it. Unset, the app has no backend and the pages that need
  one say so honestly. Cross-origin the `ailx_dev_user` cookie is NOT sent — identity rides the
  header from `apps/web/lib/authHeaders.ts`. See docs/ARCHITECTURE.md §10.1.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk's publishable key. Publishable BY DESIGN (it is
  baked into the client bundle) but it still goes in env, not the tree: see `apps/web/.env.example`.
  Read in exactly ONE place, `apps/web/lib/mode.ts` (`isClerkEnabled()`), and by Clerk's own SDK.
  Mounting needs BOTH this key and `AILX_BACKEND=1`, so a hosted deploy without it keeps working on
  the asserted dev identity, and the static export never mounts a provider at all — `next.config.mjs`
  even resolves `@clerk/nextjs` to a stub there, so the Pages bundle carries no auth SDK.
  There is deliberately no `CLERK_SECRET_KEY` here: this app verifies no token. It sends the JWT to
  the exam service, which is the only thing that checks it. See docs/ARCHITECTURE.md §10.2.
- `NEXT_PUBLIC_BASE_PATH` — GitHub Pages subpath prefix.
- `AILX_PUBLIC_ORIGIN` — the origin browsers actually reach, e.g. `https://ailx.example`. Used by
  `generateMetadata` for absolute Open Graph URLs. Must be a bare absolute http(s) origin.
- `AILX_TRUST_PROXY=1` — fall back to `x-forwarded-proto`/`x-forwarded-host` when
  `AILX_PUBLIC_ORIGIN` is unset. Only when a trusted proxy always overwrites those headers;
  otherwise they are attacker-controlled (host-header injection).
- `AILX_E2E_API_BASE` — Playwright only: the exam service the suite drives. No default, and no
  staging (every spec appends rows). `AILX_E2E_BASE_URL` / `AILX_E2E_PORT` pick the frontend
  under test.

## Shared-demo proxy environment (`services/openrouter-proxy`)
- `AILX_ALLOWED_ORIGINS` — optional comma/whitespace separated list of extra allowed CORS
  origins, e.g. a staging or ngrok deployment. Each entry must be a bare absolute http(s)
  origin with no path or trailing slash; the prod and localhost origins stay allowed and
  `*` / `null` are never accepted. Without it, only GitHub Pages and localhost can call the
  shared demo model.

## Core invariants (never violate)
- Any score ever issued is byte-identically recomputable from stored inputs. **A judge's output IS a stored input** — an LLM judge is not reproducible even at temperature 0, so T3/T4 judging is an evidence-COLLECTION step whose result is persisted and content-addressed (`judgmentId`, `packages/core`), and `score()` replays it. Say both halves: **re-scoring is reproducible, re-judging is not.** Never put a model call on the recompute path.
- That invariant is ENFORCED, not asserted, and it was asserted-only until 2026-09-01. Every `track_scored` entry carries `judgmentIds` (the claimed content address of each stored row) and `scoredBy`, and `append()` refuses a score whose evidence is missing, mutated, unordered or duplicated (`packages/session/src/machine.ts`, `assertJudgmentsAttested`); `loadAttemptValidated` re-checks a stored log and truncates a tampered one. Stored rows go into ONE canonical total order and every aggregation over them is order-invariant by construction (`packages/core/src/judgments.ts`), because a store read without `ORDER BY` used to change a T3 score by a rounding step. `replayTrackScore` (`apps/web/lib/registry.ts`) is the auditor's recompute in production code, shown per track on the report. **A score the browser did not issue is marked `scoredBy: "server"` and claims no local replay** — the exam service holds the evidence and the key, and saying so is the narrow truth.
- `score()` is pure — no I/O, clock, or randomness. `runPure` (`packages/core/src/purity.ts`) enforces this in CI by TRAPPING GLOBALS: clock, randomness, network, deferred scheduling, a promise return and a newly created global all throw. It is not a sandbox and does not claim to be — it cannot see a reference captured before the call, a `node:fs` imported at module load, or a `process.env` read. The blind spots are listed in that module and each one has a test asserting the harness stays quiet, so the list cannot rot. Byte-identical replay is verified ON THE PINNED RUNTIME; cross-runtime-version identity is NOT proven (no runtime version is stored in provenance, and unicode case folding moves with ICU).
- Item banks are content-addressed; edits create new items, never mutations.
- The audit digest content-addresses `score()` SOURCE at build time (`instruments/demo-2026.1/snapshot.json` `scorers[]`); regenerate with `pnpm --filter @ailx/content-tools run snapshot:demo-2026.1` (build first — the CLI runs from `dist/`). The digests are tier-independent — they hash `score()` source, which is the same in both repos. **What it covers, plainly:** every file in the track's `score()` import closure BY ITS BYTES, and — since 2026-09-01 — the `@ailx/core` modules that closure actually imports, also by their bytes, recorded under a package-qualified path (`@ailx/core/src/rounding.ts`). So editing the score allocation, the canonical judgment order, the order-invariant mean/median or `round3` moves every affected track's digest with NO version bump. What it still does not cover: a REGISTRY dependency (pinned at `name@range`), core modules no scorer imports (`zip.ts`, `ui.ts`, `purity.ts` are deliberately out), and the toolchain — TypeScript, the runtime and ICU are not in the hash. Bump `packages/core/package.json` when core's public behaviour changes, but the digest no longer DEPENDS on you remembering. See `packages/content-tools/src/scorers.ts`.
- `responses` and `transcripts` are append-only; re-scores are inserts linked by `superseded_by`.

## Code quality and engineering philosophy
- **DRY — flag repetition aggressively.** If you see duplicated logic, types, or constants, consolidate them. Do not leave repetition in place and move on.
- **Well-tested code is non-negotiable.** Prefer too many tests over too few. New or changed code must have tests covering general behavior and edge cases. Do not leave coverage gaps.
- **Right-sized engineering.** Avoid both extremes: under-engineered (fragile, hacky, no error handling) and over-engineered (premature abstraction, unnecessary layers, speculative complexity). Write the minimum structure needed to be correct and maintainable.
- **Handle edge cases thoughtfully.** Err on the side of handling more edge cases, not fewer. Thoughtfulness beats speed — take time to consider what can go wrong.
- **Minimal diff.** Achieve the goal with the fewest new abstractions and files touched.
