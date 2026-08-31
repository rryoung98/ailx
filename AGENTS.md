# AGENTS.md — AILX (resilience)

Monorepo for AILX, the AI Literacy Examination. Spec: `AILX-Spec-2026.1.md`. Plan: `docs/PLAN.md`. Positioning: `docs/POSITIONING.md`. Progression/streaks loop: `docs/PROGRESSION.md`.

## Layout
- `apps/web/` — Next.js platform (currently static export on GitHub Pages; hosted backend in progress)
- `packages/core/` — TrackPlugin interface, scoring purity harness, content addressing
- `packages/backend/` — hosted-mode persistence: Postgres store (append-only writes over `db/schema.sql`), AuthProvider (Clerk/dev), framework-agnostic API handlers
- `packages/report/` — pure scoring-adjacent derivation: composite, insights, calibration, export tiers, demo judging, track metadata
- `packages/tracks/` — t1-creative-build, t2-discrimination, t3-reasoning, t4-generative
- `packages/session/` — event-sourced session engine
- `instruments/demo-2026.1/` — the ONLY instrument in this repo. PUBLIC released-practice tier for the static demo: 20 T2 items whose keys/rationales are published on purpose, no score of record. Self-contained and REDACTED — `manifest.yaml` sets `redacted: true`, and the content-tools loader refuses the package if a rubric `description`, a `band_anchors` block or a `prompts/` directory ever appears. Regenerate with `pnpm --filter @ailx/content-tools run snapshot:demo-2026.1`
- The OPERATIONAL tier (`instruments/2026.1`: 84 keyed T2 items, T1/T3/T4 judge prompts, rubric marking detail, the T1/T3/T4 `form.json` files) lives in the PRIVATE backend repo and must never be added here. `packages/content-tools/test/public-tree.test.ts` fails the build if it comes back
- `instruments/characters/2026.1/` — the sixteen player-type characters (art direction, prompts, vetting ledger); assets ship in `apps/web/public/characters/`
- `db/schema.sql` — Postgres schema (append-only responses; scores superseded, never updated)
- `services/` — openrouter-proxy
- `infra/` — GCP infrastructure

## Commands
- `pnpm install` · `pnpm test` · `pnpm -r build` (both must pass before any commit)
- `pnpm test` is ONE vitest for the whole monorepo (`vitest-workspace.ts`), with one worker pool capped at 4 forks — the ceiling is memory, not CPU. Raise it with `AILX_TEST_FORKS=8 pnpm test` on a big machine. `pnpm -r test` still works and still runs the same tests, but it starts a vitest per package, so it costs more RAM and more time.
- `vitest run` inside a package is the way to debug one package.
- `pnpm test:reap` — kill vitest workers orphaned by an interrupted run (reparented to pid 1, each still holding its heap). The capped pool and the per-file PGlite close make this rare rather than routine.
- `pnpm --filter @ailx/web e2e` — Playwright (FRONTEND.md §6). Deliberately outside `pnpm test`: it boots its own server build and needs a disposable Postgres. See `apps/web/e2e/README.md`.

## Credential and diagnosis
- `docs/CREDENTIAL.md` — what an AILX credential asserts (a completed sitting,
  never a score), why it is Open Badges 3.0 shaped with hosted verification,
  how it upgrades to a scored claim without reissuing, and why a revoked
  credential still resolves while a revoked share token 404s.

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

## Frontend standard
- `FRONTEND.md` — module boundaries, security, clean-code, testing and migration rules for `apps/web` and `packages/tracks`. Read it before touching frontend code.

## Server-mode environment (`apps/web`, API routes only)
- `AILX_BACKEND=1` — compile the API routes (unset = static Pages export).
- `AILX_AUTH` — auth adapter: `dev` (no keys) or `clerk`. **Required — there is
  no default.** An unset/unknown value refuses to start instead of falling back
  to `dev`: `DevAuthProvider` identity is asserted (`x-ailx-dev-user: <id>`),
  never proven, so a forgotten variable would let anyone impersonate any
  participant. Use `clerk` (with `CLERK_SECRET_KEY`) anywhere real participants
  can reach.
  Under `dev`, identity also travels as the `ailx_dev_user` COOKIE (written by
  the browser next to `localStorage["ailx:dev-user"]`), because a header cannot
  survive a navigation and server-rendered pages like `/progress` would
  otherwise see every visitor as anonymous. The header still wins. It is a
  convenience, not a session — see `docs/DEPLOY.md` §4.1.
- `AILX_ALLOW_INSECURE_DEV_AUTH=1` — the ONLY way to run `AILX_AUTH=dev` under
  `NODE_ENV=production` (the Playwright suite boots a production build against a
  disposable database). Never set it on a deployment that holds real data.
- Request bodies are capped before the handler runs: raw uploads at
  `T1_LIMITS.maxTotalBytes` (the T1 snapshot cap — one number, not two), JSON at
  1 MB, both rejected with 413 mid-stream. Callers are authenticated first, so
  an anonymous client can never make the server buffer.
- `AILX_REVIEWERS` — comma/whitespace list of AuthProvider refs (`clerk:<sub>`,
  `dev:<id>`) allowed to approve or refuse a site-carrying gallery submission
  (`/review`, `/api/gallery/review`). Fails closed: unset means nobody, and a
  `*` entry is dropped, never read as "everyone". There is no staff/roles
  table on purpose — see `docs/SHARING.md` §7.2.
- `DATABASE_URL` — Postgres for the append-only store.
- `AILX_SNAPSHOT_STORE` — where T1 candidate sites live: `fs` (default, local
  disk) or `blob` (Vercel Blob, private objects). Serverless MUST use `blob`:
  its filesystem is per-invocation, so an `fs` upload is invisible to the
  request that serves it. Selection lives only in `apps/web/lib/server/site.ts`.
- `BLOB_READ_WRITE_TOKEN` — required by `AILX_SNAPSHOT_STORE=blob` (Vercel
  injects it when a Blob store is linked). `AILX_SNAPSHOT_BLOB_PREFIX`
  (default `t1`) namespaces one bucket across deployments.
- `AILX_SNAPSHOT_DIR` — T1 snapshot filesystem root for `fs` (default `<cwd>/.ailx-snapshots`).
- `AILX_GITHUB_CLIENT_ID` — GitHub OAuth **app client id** for the T1 artifact export
  ("Put it on GitHub"). Device flow, so there is NO client secret to hold and no redirect
  URI to register; the id is public by design, as it is for a CLI. The one scope requested
  is `public_repo` — enough to create a public repository and push to it, and nothing at
  all over private repositories. Unset (the default) the GitHub and Vercel rungs answer
  501 and the export panel offers Download only. See `docs/FUTURE-TRACKS.md`
  "The offboarding ramp".
- `NEXT_PUBLIC_AILX_API_BASE` — the exam service's absolute origin (Cloud Run). Set it and
  the BROWSER calls that service (`<origin>/v1/...`) instead of this app's own `/api`
  routes; unset, nothing changes and the static export still needs no server. Read in
  exactly ONE place, `apps/web/lib/mode.ts` (`apiBase()`, `siteApiRoot()`, `siteHref()`),
  and a test fails the build if a second module reads it. Cross-origin the `ailx_dev_user`
  cookie is not sent — identity rides the header from `apps/web/lib/authHeaders.ts`. See
  docs/ARCHITECTURE.md §10.1.
- `AILX_PG_POOL_MAX` — pg clients per instance (default 3). Serverless keeps one
  pool per warm instance, so point `DATABASE_URL` at a POOLED endpoint (Neon's
  `-pooler` host) and keep this small.
- `AILX_PUBLIC_ORIGIN` — the origin browsers actually reach, e.g. `https://ailx.example`.
  Required behind any proxy/CDN: it is baked into the served-site CSP allowlist and the
  bare-digest 308 redirect. Must be an absolute http(s) origin with no path/query/fragment.
- `AILX_TRUST_PROXY=1` — fall back to `x-forwarded-proto`/`x-forwarded-host` when
  `AILX_PUBLIC_ORIGIN` is unset. Only set this when a trusted proxy always overwrites
  those headers; otherwise they are attacker-controlled (host-header injection, CSP widening).

## Shared-demo proxy environment (`services/openrouter-proxy`)
- `AILX_ALLOWED_ORIGINS` — optional comma/whitespace separated list of extra allowed CORS
  origins, e.g. a staging or ngrok deployment. Each entry must be a bare absolute http(s)
  origin with no path or trailing slash; the prod and localhost origins stay allowed and
  `*` / `null` are never accepted. Without it, only GitHub Pages and localhost can call the
  shared demo model.

## Core invariants (never violate)
- Any score ever issued is byte-identically recomputable from stored inputs.
- `score()` is pure — no I/O, clock, or randomness (CI-enforced sandbox).
- Item banks are content-addressed; edits create new items, never mutations.
- The audit digest content-addresses `score()` SOURCE at build time (`instruments/demo-2026.1/snapshot.json` `scorers[]`); regenerate with `pnpm --filter @ailx/content-tools run snapshot:demo-2026.1`. The digests are tier-independent — they hash `score()` source, which is the same in both repos.
- `responses` and `transcripts` are append-only; re-scores are inserts linked by `superseded_by`.

## Code quality and engineering philosophy
- **DRY — flag repetition aggressively.** If you see duplicated logic, types, or constants, consolidate them. Do not leave repetition in place and move on.
- **Well-tested code is non-negotiable.** Prefer too many tests over too few. New or changed code must have tests covering general behavior and edge cases. Do not leave coverage gaps.
- **Right-sized engineering.** Avoid both extremes: under-engineered (fragile, hacky, no error handling) and over-engineered (premature abstraction, unnecessary layers, speculative complexity). Write the minimum structure needed to be correct and maintainable.
- **Handle edge cases thoughtfully.** Err on the side of handling more edge cases, not fewer. Thoughtfulness beats speed — take time to consider what can go wrong.
- **Minimal diff.** Achieve the goal with the fewest new abstractions and files touched.
