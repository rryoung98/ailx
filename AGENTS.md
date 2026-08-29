# AGENTS.md — AILX (resilience)

Monorepo for AILX, the AI Literacy Examination. Spec: `AILX-Spec-2026.1.md`. Plan: `docs/PLAN.md`. Positioning: `docs/POSITIONING.md`. Progression/streaks loop: `docs/PROGRESSION.md`.

## Layout
- `apps/web/` — Next.js platform (currently static export on GitHub Pages; hosted backend in progress)
- `packages/core/` — TrackPlugin interface, scoring purity harness, content addressing
- `packages/backend/` — hosted-mode persistence: Postgres store (append-only writes over `db/schema.sql`), AuthProvider (Clerk/dev), framework-agnostic API handlers
- `packages/report/` — pure scoring-adjacent derivation: composite, insights, calibration, export tiers, demo judging, track metadata
- `packages/tracks/` — t1-creative-build, t2-discrimination, t3-reasoning, t4-generative
- `packages/session/` — event-sourced session engine
- `instruments/2026.1/` — content-as-data: manifest, rubrics, judge prompts, item banks
- `db/schema.sql` — Postgres schema (append-only responses; scores superseded, never updated)
- `services/` — openrouter-proxy
- `infra/` — GCP infrastructure

## Commands
- `pnpm install` · `pnpm -r test` · `pnpm -r build` (both must pass before any commit)
- `pnpm --filter @ailx/web e2e` — Playwright (FRONTEND.md §6). Deliberately outside `pnpm -r test`: it boots its own server build and needs a disposable Postgres. See `apps/web/e2e/README.md`.

## Credential and diagnosis
- `docs/CREDENTIAL.md` — what an AILX credential asserts (a completed sitting,
  never a score), why it is Open Badges 3.0 shaped with hosted verification,
  how it upgrades to a scored claim without reissuing, and why a revoked
  credential still resolves while a revoked share token 404s.

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
- `AILX_SNAPSHOT_DIR` — T1 snapshot filesystem root (default `<cwd>/.ailx-snapshots`).
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
- The audit digest content-addresses `score()` SOURCE at build time (`instruments/2026.1/snapshot.json` `scorers[]`); regenerate with `pnpm --filter @ailx/content-tools run snapshot:2026.1`.
- `responses` and `transcripts` are append-only; re-scores are inserts linked by `superseded_by`.

## Code quality and engineering philosophy
- **DRY — flag repetition aggressively.** If you see duplicated logic, types, or constants, consolidate them. Do not leave repetition in place and move on.
- **Well-tested code is non-negotiable.** Prefer too many tests over too few. New or changed code must have tests covering general behavior and edge cases. Do not leave coverage gaps.
- **Right-sized engineering.** Avoid both extremes: under-engineered (fragile, hacky, no error handling) and over-engineered (premature abstraction, unnecessary layers, speculative complexity). Write the minimum structure needed to be correct and maintainable.
- **Handle edge cases thoughtfully.** Err on the side of handling more edge cases, not fewer. Thoughtfulness beats speed — take time to consider what can go wrong.
- **Minimal diff.** Achieve the goal with the fewest new abstractions and files touched.
