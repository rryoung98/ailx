# E2E suite

Playwright, per FRONTEND.md §6. It is deliberately **not** part of `pnpm test`:
it needs a real server and a database, and the unit run must stay fast and
dependency-free.

```bash
pnpm --filter @ailx/web e2e            # boots its own production server build
pnpm --filter @ailx/web e2e --ui       # same, with the Playwright UI
```

## What it needs

A throwaway Postgres. Never staging, never a shared database — the specs write
append-only rows under a unique dev user per test.

```bash
docker run -d --name ailx-e2e-pg -p 55432:5432 \
  -e POSTGRES_USER=ailx -e POSTGRES_PASSWORD=ailx -e POSTGRES_DB=ailx_e2e postgres:16
psql postgres://ailx:ailx@localhost:55432/ailx_e2e -f ../../db/schema.sql
```

`DATABASE_URL` defaults to `postgres://ailx:ailx@localhost:55432/ailx_e2e`
(local, disposable, not a credential). Override it — never commit another one.

Playwright then runs `next build && next start` itself with `AILX_BACKEND=1`,
`AILX_AUTH=dev` (plus `AILX_ALLOW_INSECURE_DEV_AUTH=1`, because `next start`
sets `NODE_ENV=production` and assert-only dev auth is refused there unless a
throw-away deployment opts in), an `AILX_PUBLIC_ORIGIN` equal to the origin it
will actually browse, and a fresh `AILX_SNAPSHOT_DIR`. Testing the production build is what
makes the redirect and CSP behaviour reproducible.

`next build` writes to `apps/web/.next`, so do not run `next dev` (or another
build) in `apps/web` while the suite is running — they would fight over the
same directory.

To smoke a deployed environment instead, set `AILX_E2E_BASE_URL=https://…`;
no server is booted. Note that a tunnel with an interstitial (ngrok's free
browser warning) will fail the T1 site spec for reasons that are not ours.

## Conventions

- **Terminal states only.** Every navigation is proven with `toHaveURL` plus a
  visible element. Status codes and headers are additional diagnostics, never
  the sole proof (§6.4) — a redirect *cycle* satisfies every per-hop assertion.
- **Seeded decks.** T2 decks are derived per attempt, so no spec names an item,
  an option or an answer: only structure (`Item 2 / 6`) and behaviour.
- **Pinned clock.** `seedRun()` installs `page.clock` at `FIXED_TIME` and then
  resumes it (a fully frozen clock never finishes hydrating). Specs move time
  with `clock.fastForward`, never `waitForTimeout`.
- **Isolation.** One attempt and one dev user per test, both created in
  fixtures; state is seeded through `localStorage` exactly as the app writes it.
- **Fixtures, not helpers-in-tests.** Shared locators and the focus invariant
  live in `fixtures.ts` so no spec re-implements them.
