# AGENTS.md — `apps/web`

The Next.js frontend. Read the root [`AGENTS.md`](../../AGENTS.md) first: the
repository split, the commands and the core invariants are there, and they still
apply. Read [`FRONTEND.md`](../../FRONTEND.md) before touching this code.

## Two build modes

This app builds twice, and drift between the two is invisible unless both run.

- Unset — the static export for GitHub Pages. No API surface at all. Output in `apps/web/out`.
- `AILX_BACKEND=1` — adds `page.api.tsx` / `route.api.ts` to `pageExtensions`, i.e. the seven database-reading PAGES and the one Open Graph card route. Client chunks in `apps/web/.next/static`.

- Run the static build and `AILX_BACKEND=1 pnpm --filter @ailx/web build` SEQUENTIALLY. Two concurrent `next build`s into `apps/web/.next` fail with a bogus "Cannot find module for page". Also run `rm -rf apps/web/.next` between the builds. A build over the OTHER mode's leftover output failed twice on 2026-09-01. One failure reported a prerender "Cannot read properties of undefined (reading 'call')". The other reported a missing `next-font-manifest.json`. Neither error names the real cause.
- A green `next build` is NOT a green deploy. Vercel traces server files AFTER the build prints "Done", and that step is where every Production deployment failed until 2026-09-03 (docs/DEPLOY.md §6.1). Prove a deploy locally with `cd apps/web && rm -rf .next .vercel/output && AILX_BACKEND=1 npx vercel build --prod`. `.github/workflows/deploy-status.yml` fails a run when Vercel reports a failed Production deployment, so a dead staging site is visible without anyone looking.

## `next dev`

Never run `next dev` in `apps/web` while anyone is testing. It leaves unminified dev chunks in `.next/static`, and `test/bundleSecrecy.test.ts` greps that exact directory. The failure is a false positive, but it is indistinguishable from a real leak until you know.

## Bundle secrecy

`test/bundleSecrecy.test.ts` greps the BUILT client assets of both modes for
operational answer-key material, and it guards `apps/web/public/**`: every file
there must be named by a committed manifest (the released-practice snapshot, the
practice corpus, the character manifest) or by one of two frozen lists in that
test. An asset cannot arrive unremarked. It scanned only build output until
TEN-117, which is how 50 undealt `t2-media` files came to ship.

The sister gate is `test/bundleBudget.test.ts` — total client JS, the shared
bytes, and eight named pages, budgeted in BOTH modes. It skips the mode it
cannot see, so it is free in a run with no build output. Re-measure by running
either build and reading the failure, which prints measured bytes next to the
budget. See [`docs/DEPS.md`](../../docs/DEPS.md).

## Playwright

`pnpm --filter @ailx/web e2e` — Playwright (FRONTEND.md §6). This command is deliberately outside `pnpm test`. It boots the frontend but needs a RUNNING EXAM SERVICE. Set `AILX_E2E_API_BASE` to a throw-away `services/api` from the private repo (never staging — every spec appends rows). It has no default, on purpose. Guessing localhost makes a suite that seeds nothing look like it passed. Only the seeding specs skip without it; the measurement specs still run. See `apps/web/e2e/README.md`.

The e2e suite always boots its own server. `AILX_E2E_REUSE_SERVER=1` reuses whatever is already on the port for a fast inner loop — and then YOU own what is on that port. It is opt-in because a next-server orphaned by a dead agent once held 3210 for a day and the suite silently tested it, green.

## Frontend environment (`apps/web`)

This app is a frontend. The exam service owns the database, the auth mode, the
snapshot store, the reviewer allowlist, the connection pool and the GitHub export.
See the PRIVATE repo's README §3. If you want to set `DATABASE_URL` here, run
`services/api` instead.

- `AILX_BACKEND=1` — add `page.api.tsx` / `route.api.ts` to `pageExtensions`, i.e. build the
  seven database-reading PAGES and the one Open Graph card route. Unset = the static Pages
  export, which has none of them. It no longer compiles any API route, because there are none.
- `NEXT_PUBLIC_AILX_API_BASE` — the exam service's absolute origin (Cloud Run). Read in exactly
  ONE place, `apps/web/lib/mode.ts` (`apiBase()`, `siteApiRoot()`, `siteHref()`); a test fails
  the build if a second module reads it. Unset, the app has no backend and the pages that need
  one say so honestly. Cross-origin the `ailx_dev_user` cookie is NOT sent — identity rides the
  header from `apps/web/lib/data/authHeaders.ts`. See docs/ARCHITECTURE.md §10.1.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk's publishable key. Publishable BY DESIGN (it is
  baked into the client bundle) but it still goes in env, not the tree: see `apps/web/.env.example`.
  Read in exactly ONE place, `apps/web/lib/mode.ts` (`isClerkEnabled()`), and by Clerk's own SDK.
  Mounting needs BOTH this key and `AILX_BACKEND=1`, so a hosted deploy without it keeps working on
  the asserted dev identity — every page that only READS an identity does — and the static export
  never mounts a provider at all: `next.config.mjs` even resolves `@clerk/nextjs` to a stub there,
  so the Pages bundle carries no auth SDK. That sentence used to stop one clause too early. Nothing
  removes the ROUTES, so `/sign-in` and `/sign-up` compile whenever `AILX_BACKEND=1`, and they
  render Clerk components that call `useSession` and throw without a provider: a keyless deploy
  worked everywhere except the two screens that exist to serve the missing thing (TEN-155). So both
  routes now 404 unless `isClerkEnabled()`, the nav link is gated on the same predicate, and
  `test/clerkMount.test.tsx` pins the pair — a deploy that forgets the key must degrade, never
  crash.
  There is deliberately no `CLERK_SECRET_KEY` here: this app verifies no token. It sends the JWT to
  the exam service, which is the only thing that checks it. See docs/ARCHITECTURE.md §10.2.
- `NEXT_PUBLIC_BASE_PATH` — GitHub Pages subpath prefix.
- `AILX_PUBLIC_ORIGIN` — the origin browsers actually reach, e.g. `https://ailx.example`. Used by
  `generateMetadata` for absolute Open Graph URLs. Must be a bare absolute http(s) origin.
- `AILX_TRUST_PROXY=1` — fall back to `x-forwarded-proto`/`x-forwarded-host` when
  `AILX_PUBLIC_ORIGIN` is unset. Only when a trusted proxy always overwrites those headers;
  otherwise they are attacker-controlled (host-header injection).
- `AILX_SERVER_READ_TIMEOUT_MS` — deadline for the three SERVER reads of the exam service
  (`/s/<token>` and `/verify/<code>` metadata, and the share card route). Default 4000, which is
  inside the 10 s Hobby / 15 s Pro function limit; a value that is not a positive number is
  ignored. Unset is the normal case — it exists so a deployment with a different function limit
  can move the deadline instead of returning the platform's 504 (TEN-213).
- `AILX_E2E_API_BASE` — Playwright only: the exam service the suite drives. No default, and no
  staging (every spec appends rows). `AILX_E2E_BASE_URL` / `AILX_E2E_PORT` pick the frontend
  under test.
