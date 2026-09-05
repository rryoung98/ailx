# AGENTS.md — Foray (resilience)

This file is the index. It keeps the layout, the repository split, the
commands and the core invariants; the detail lives with the directory that owns
it, and root LINKS rather than duplicates.

| file | what is in it |
|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | branch and PR flow, the three gate job names, why there is no `type-check` script, local hooks |
| [`apps/web/AGENTS.md`](apps/web/AGENTS.md) | the two build modes, `AILX_BACKEND=1`, never `next dev` during tests, bundle secrecy, Playwright and `AILX_E2E_API_BASE` |
| [`packages/core/AGENTS.md`](packages/core/AGENTS.md) | `score()` purity, `runPure` and its blind spots, content addressing |
| [`packages/contract/AGENTS.md`](packages/contract/AGENTS.md) | frozen URL spellings, `BROWSER_REQUEST_HEADERS` and CORS, no `node:` |
| [`packages/content-tools/AGENTS.md`](packages/content-tools/AGENTS.md) | the demo snapshot, the public-tree test, the regenerate command, the audit digest |
| [`services/openrouter-proxy/AGENTS.md`](services/openrouter-proxy/AGENTS.md) | why the demo proxy stays in the public repo, `AILX_ALLOWED_ORIGINS` |
| [`FRONTEND.md`](FRONTEND.md) | module boundaries, security, clean-code, testing and migration rules |

This monorepo contains Foray, the AI Literacy Examination. The spec is `Foray-Spec-2026.1.md`. The plan is `docs/PLAN.md`. Positioning is in `docs/POSITIONING.md`. The progression/streaks loop is in `docs/PROGRESSION.md`.

## Layout

**This repository is a FRONTEND.** The PRIVATE `rryoung98/ailx-backend` repository is the only
home of the exam service. That service includes the HTTP handlers, the append-only store,
the auth providers and the OPERATIONAL item bank. It once lived here too. That caused two
problems. The bank was readable in a public JS chunk. The handler copies also drifted until a
browser called a route the deployed service did not have. Do not bring either back. See "The repository split".

- `apps/web/` — Next.js frontend. Static export on GitHub Pages, and a hosted build (`AILX_BACKEND=1`) that adds the seven database-reading PAGES. It has NO API routes: it calls the exam service through `lib/mode.ts`
- `packages/core/` — TrackPlugin interface, scoring purity harness, content addressing, the T1 ZIP writer
- `packages/contract/` — the browser-facing API CONTRACT: wire types, frozen URL spellings, query parsers, the dev-identity predicate, and `BROWSER_REQUEST_HEADERS` — the one list of request headers the browser sends, which is what the exam service must allow in a CORS preflight. Pure — no `node:`, no env, no I/O
- `packages/report/` — pure scoring-adjacent derivation: composite, insights, calibration, export tiers, demo judging, track metadata
- `packages/tracks/` — t1-creative-build, t2-discrimination, t3-reasoning, t4-generative
- `packages/session/` — event-sourced session engine
- `instruments/demo-2026.1/` — the ONLY instrument in this repo. PUBLIC released-practice tier for the static demo: 20 T2 items whose keys/rationales are published on purpose, no score of record. Self-contained and REDACTED — `manifest.yaml` sets `redacted: true`, and the content-tools loader refuses the package if a rubric `description`, a `band_anchors` block or a `prompts/` directory ever appears. Regenerate with `pnpm --filter @ailx/content-tools run snapshot:demo-2026.1`
- The OPERATIONAL tier (`instruments/2026.1`: 84 keyed T2 items, T1/T3/T4 judge prompts, rubric marking detail, the T1/T3/T4 `form.json` files) lives in the PRIVATE backend repo and must never be added here. `packages/content-tools/test/public-tree.test.ts` fails the build if it comes back
- `instruments/characters/2026.1/` — the sixteen player-type characters (art direction, prompts, vetting ledger); assets ship in `apps/web/public/characters/`
- `services/` — openrouter-proxy (the shared demo MODEL proxy; it holds no exam content and answers no exam route). It stays here even though TEN-62 moved the proxy into the exam service, because the GitHub Pages export has no service and no identity to offer. See [`services/openrouter-proxy/AGENTS.md`](services/openrouter-proxy/AGENTS.md)
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
  a second route handler. It also fails if anything a browser legitimately needs goes
  missing. `packages/content-tools/test/public-tree.test.ts` guards the content tree, and
  `apps/web/test/bundleSecrecy.test.ts` guards `apps/web/public/**` — every file there must be
  named by a committed manifest (the released-practice snapshot, the practice corpus, the
  character manifest) or by one of two frozen lists in that test, so an asset cannot arrive
  unremarked. It scanned only build output until TEN-117, which is how 50 undealt `t2-media`
  files came to ship. Moving that pool to the exam service empties the frozen list; growing it
  fails the build.
- There: `pnpm sync:shared:check` compares the vendored copies byte for byte against THIS repo
  on every PR. **This repo is the source of truth**, so fix a shared package HERE and sync it
  there — never the other way round.

There is exactly ONE route handler in this repo, `app/s/[token]/card.png`. It creates the
frontend's Open Graph image by rasterizing an already-public share payload. It holds no key.
It touches no store and decides no policy. The guard allows it BY NAME, so adding a second
handler requires a decision in front of a reviewer.

## Commands

Process — branch naming, the three gate job names, why there is no `type-check`
script, and the local hooks — is in [`CONTRIBUTING.md`](./CONTRIBUTING.md). The
commands and the invariants stay here.

- `pnpm install` · `pnpm test` · `pnpm -r build` (both must pass before any commit)
- `lefthook.yml` runs Biome on staged files pre-commit and `pnpm test` pre-push, once you have run `pnpm exec lefthook install`. `LEFTHOOK=0 git push` skips the test hook on a draft.
- `pnpm lint` — Biome. An error fails the run and the CI `lint` job; a warning is carried debt, and every carried rule has a reason in `docs/DEBT.md`.
- `pnpm test` runs ONE vitest for the whole monorepo (`vitest-workspace.ts`). Its worker pool is capped at 4 forks because memory, not CPU, sets the ceiling. Raise it with `AILX_TEST_FORKS=8 pnpm test` on a big machine. `pnpm -r test` still works and runs the same tests. It starts a vitest per package, so it costs more RAM and more time.
- Run `vitest run` inside a package to debug that package.
- `pnpm test:reap` — kill vitest workers orphaned by an interrupted run (reparented to pid 1, each still holding its heap). The capped pool and the per-file PGlite close make this rare rather than routine.
- The two build modes, `next dev`, bundle secrecy and Playwright are in [`apps/web/AGENTS.md`](apps/web/AGENTS.md).

## Credential and diagnosis
- `docs/CREDENTIAL.md` — what a Foray credential asserts (a completed sitting,
  never a score), why it is Open Badges 3.0 shaped with hosted verification,
  how it upgrades to a scored claim without reissuing, and why a revoked
  credential still resolves while a revoked share token 404s.

## The rename to Foray
- `docs/RENAME.md` — the sequenced plan for renaming AILX to Foray: the
  occurrence counts in all three repos, what is irreversible and therefore
  first in the order, why the credential issuer is the hardest part (the
  issuer IS the origin, so the old origin must answer forever on two routes),
  why no stored row is rewritten, and what breaks if the rename stops
  half-way. Nothing is renamed. Parent issue TEN-134.

## Comparative judgement (T1)
- `docs/COMPARATIVE-JUDGEMENT.md` — what T1's pairwise judging costs at N = 100 to 10,000,
  which quantity is flat in N and which is not, who judges and what that costs in bias, and
  why the reported reliability is a split-panel correlation rather than SSR. Both source
  citations are quoted from documents fetched in-session. Re-run the cost model with
  `node docs/cj-cost.mjs`.

## Sampling and the population statistic
- `docs/SAMPLING.md` — the two-track design that separates the self-selected web
  cohort (item calibration, individual credentials) from a bought probability
  panel (the only source of a published population statistic): what may cross
  between them, the schema-level firewall that stops the two being averaged,
  minimum n and precision, weighting, coverage limits, device effects, the
  non-response bias analysis we publish unprompted, the exact hedging language
  for convenience-sample findings, and the cost of a first release.
- `docs/PANEL-MARKETS.md` — the vendor evidence behind the country plan: no
  probability online panel is sold in Japan or Korea, what each country does
  sell instead, the published response rates and rate cards with their sources,
  why the 2× per-complete premium we assumed has no source, and the decision
  that follows — the exam is trilingual, the first population statistic covers
  the US and the UK, and Japan and Korea field on a named funding condition.
- `docs/TREND-FORM.md` — the frozen anchor form that makes a trend statement
  possible on an annually re-versioned instrument: what is in the anchor and
  what is excluded, its exposure budget and leak detection, how long it is held
  and how a replacement links to it, the equating method and its assumptions,
  and the list of things a change in the number may and may not be attributed
  to. The manifest field that marks a form as an anchor is validated in
  `packages/content-tools`.

## Funnel and KPIs
- `docs/KPI.md` — the eight funnel steps, the exact event that marks each,
  how D1/D7 return is derived from `firstSeenDay`/`dayIndex` (never in the
  browser), what the numbers cannot tell us, and what would count as no
  traction. The schema is `packages/contract/src/funnel.ts`, the emitter is
  `apps/web/lib/data/funnel.ts`, and it is SILENT with no backend. The exam
  surface emits ONE funnel step of its own, `sitting_started`, and nothing
  inside a sitting is instrumented; the session's own `visit_started` still
  rides along when the sitting is the first thing a browser does.

## Analytics and session replay
- `docs/ADR-analytics.md` — GA4 and (deferred) self-hosted OpenReplay: measured
  bundle cost in both build modes, why no tracker may go in the static GitHub
  Pages export, which surfaces a recorder may run on at all (never inside a
  sitting and never on the report — the screen carries operational item content
  and the candidate's own answers), the consent rules including that refusing
  analytics may not change anything about a sitting, and the concrete mechanism
  that keeps a share token out of a third party's URL log. Nothing is installed.

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
  instance can serve 3 database requests at once; §8 costs the two ways out and
  records the pair this branch carries. Serving is inside the free tier at every
  traffic level we can foresee. The bill is idle.
  `packages/core/test/serviceSizing.test.ts` reads §8.3's table and fails when
  concurrency exceeds the pool. It checks what this repo decided, not what is
  deployed: the Terraform half of the check is in the private repo and §8.4
  quotes it.
- `docs/ADR-redis.md` — should we add Redis? **Not yet**, and the founder's stated
  reason does not survive the code: `@clerk/backend` already caches JWKS in-process
  (5-minute TTL, 0 network calls on a warm process), so a JWT verification is 77 µs of
  local CPU and a Redis hop would be an order of magnitude SLOWER. Carries the first
  timings ever taken against the deployed service (`/livez` 28 ms, `/readyz` 64 ms,
  `/v1/gallery` 116 ms, `/v1/aggregates` 145 ms median, 1213 ms cold), the finding that
  gallery and aggregates carry no `Cache-Control` or `ETag` at all, and five flip
  conditions (F1-F5) that would change the answer. The strongest case FOR Redis is that
  the rate limiter runs BEFORE the pool is leased, so the Postgres alternative would take
  a connection to REJECT a request. Collapse `ensureParticipant` into one statement first.

## Dependency weight
- `docs/DEPS.md` — what is installed and who pulls it in, which duplicate
  versions are free and which are pinned by a real peer constraint, what knip
  reported and what was rejected as a false positive, and what each build mode
  actually ships to a browser. The gate is
  `apps/web/test/bundleBudget.test.ts`: total client JS, the bytes shared by
  every page, and eight named pages each have a budget, in BOTH build modes:
  the measured number plus 5% for a page, plus 2% for the total, which is
  tighter because it is the only one that sees a chunk loaded after hydration.
  It skips the mode it cannot see, so it is free in a run with no build output;
  CI builds both modes before the tests, so both halves run on every PR.
  Re-measure by running either build and reading the failure, which always
  prints measured bytes next to the budget.

## Frontend standard
- `FRONTEND.md` — module boundaries, security, clean-code, testing and migration rules for `apps/web` and `packages/tracks`. Read it before touching frontend code.

## Frontend environment (`apps/web`)

Every variable this app reads, what happens when each is unset, and the two
build modes: [`apps/web/AGENTS.md`](apps/web/AGENTS.md). The app is a frontend —
the exam service owns the database, the auth mode, the snapshot store, the
reviewer allowlist, the connection pool and the GitHub export. There is
deliberately no `CLERK_SECRET_KEY` and no `DATABASE_URL` here.

Workspace-level variables and where the rest live: [`.env.example`](.env.example).

## The model gateway, and why the browser holds no key

A candidate's OpenRouter key lives on the EXAM SERVICE, sealed AES-256-GCM
against their identity, and the service does the OAuth PKCE exchange (TEN-62;
`packages/model-proxy` in the private repo). The browser redirects, comes back
with a code it hands straight over, and is told a 12-hex FINGERPRINT. It never
receives a provider credential and cannot build an `Authorization` header for
one: `ailx:openrouter-key` is gone, and no request builder in
`packages/tracks/*` takes a key parameter.

- The six routes are in the frozen manifest (`packages/contract/src/routes.ts`,
  `MODEL_ROOT`). `apps/web/lib/data/modelGateway.ts` is the only client, and
  `apiBase()` in `lib/mode.ts` is still the only reader of
  `NEXT_PUBLIC_AILX_API_BASE`.
- A "connection" is now an ENDPOINT in one browser slot (`ailx:llm-base-url`),
  never a key: the service's gateway hosted, the capped demo proxy or a local
  server statically. The run-start panel owns that slot; the runners read it
  and get identity from the host's `modelFetch` (`TrackUIProps`).
- **Do not put the copy back.** "Your key stays in this browser" was true and
  is not. The replacement is stronger and is said plainly: the browser never
  receives the key, the service holds it sealed against your account, and
  disconnecting deletes it.

### The shared demo has no anonymous path

All six `/v1/model/*` routes need an identity, so the GitHub Pages export —
no service, no identity — keeps `services/openrouter-proxy`. Why, and its
`AILX_ALLOWED_ORIGINS`: [`services/openrouter-proxy/AGENTS.md`](services/openrouter-proxy/AGENTS.md).

## Core invariants (never violate)
- Any score ever issued is byte-identically recomputable from stored inputs. **A judge's output IS a stored input** — an LLM judge is not reproducible even at temperature 0, so T3/T4 judging is an evidence-COLLECTION step whose result is persisted and content-addressed (`judgmentId`, `packages/core`), and `score()` replays it. Say both halves: **re-scoring is reproducible, re-judging is not.** Never put a model call on the recompute path.
- That invariant is ENFORCED, not asserted, and it was asserted-only until 2026-09-01. Every `track_scored` entry carries `judgmentIds` (the claimed content address of each stored row) and `scoredBy`, and `append()` refuses a score whose evidence is missing, mutated, unordered or duplicated (`packages/session/src/machine.ts`, `assertJudgmentsAttested`); `loadAttemptValidated` re-checks a stored log and truncates a tampered one. Stored rows go into ONE canonical total order and every aggregation over them is order-invariant by construction (`packages/core/src/judgments.ts`), because a store read without `ORDER BY` used to change a T3 score by a rounding step. `replayTrackScore` (`apps/web/lib/instrument/registry.ts`) is the auditor's recompute in production code, shown per track on the report. **A score the browser did not issue is marked `scoredBy: "server"` and claims no local replay** — the exam service holds the evidence and the key, and saying so is the narrow truth.
- `score()` is pure — no I/O, clock, or randomness. `runPure` (`packages/core/src/purity.ts`) enforces it in CI by trapping globals, and it is a trap, not a sandbox: the blind spots and the pinned-runtime caveat are in [`packages/core/AGENTS.md`](packages/core/AGENTS.md).
- Item banks are content-addressed. Edits create new items, never mutations.
- The audit digest content-addresses `score()` SOURCE at build time (`instruments/demo-2026.1/snapshot.json` `scorers[]`). What it covers, what it does not, and the regenerate command: [`packages/content-tools/AGENTS.md`](packages/content-tools/AGENTS.md).
- `responses` and `transcripts` are append-only; re-scores are inserts linked by `superseded_by`.

## Code quality and engineering philosophy
- **DRY — flag repetition aggressively.** Consolidate duplicated logic, types, or constants. Do not leave repetition in place and move on.
- **Well-tested code is non-negotiable.** Prefer too many tests over too few. New or changed code must have tests covering general behavior and edge cases. Do not leave coverage gaps.
- **Right-sized engineering.** Avoid under-engineered code (fragile, hacky, no error handling) and over-engineered code (premature abstraction, unnecessary layers, speculative complexity). Write the minimum structure needed for correctness and maintenance.
- **Handle edge cases thoughtfully.** Err on the side of handling more edge cases, not fewer. Thoughtfulness beats speed — take time to consider what can go wrong.
- **Minimal diff.** Achieve the goal with the fewest new abstractions and files touched.
