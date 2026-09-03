# E2E suite

Playwright, per FRONTEND.md §6. It is deliberately **not** part of `pnpm test`:
it needs a real server (and, for the specs that seed, the exam service), and
the unit run must stay fast and dependency-free.

```bash
pnpm --filter @ailx/web e2e            # boots its own production server build
pnpm --filter @ailx/web e2e --ui       # same, with the Playwright UI
```

## What it needs

**A running exam service.** This app is a FRONTEND: it has no API routes of its
own (docs/ARCHITECTURE.md §10.1), so a spec cannot seed a run by posting to the
origin under test. Seeding goes to `services/api`, which lives in the PRIVATE
`ailx-backend` repository, over a disposable Postgres of its own.

```bash
# In the private repo: boot services/api against a THROWAWAY database.
# Never staging, never a shared database — the specs write append-only rows.
AILX_E2E_API_BASE=http://127.0.0.1:8080 pnpm --filter @ailx/web e2e
```

`AILX_E2E_API_BASE` has **no default**, and that is deliberate: guessing
`localhost` would produce a suite that seeds nothing and passes locally, and
guessing the staging origin would write rows into a database people demo from.
`e2e/service.ts` is the one module that reads it.

**Without a service the suite still runs, and still bites.** The skip is
GRANULAR, never a whole-suite bail: only the describes that SEED skip
themselves, each with a stated reason. Everything that just loads a page and
measures it keeps running — `visual-contracts.spec.ts` in full, and the landing
contracts in `visual.spec.ts`. A layer that only runs where a private service
happens to be up is a layer that stops running (FRONTEND.md §6.7.3). Current
service-free result: **26 passed, 21 skipped**.

Playwright then runs `next build && next start` itself with `AILX_BACKEND=1`
(which for a frontend means only "compile the `page.api.tsx` pages") and
`NEXT_PUBLIC_AILX_API_BASE` pointed at the service when there is one. Testing
the production build is what makes the redirect and CSP behaviour reproducible.

Server reuse is **opt-in**: `AILX_E2E_REUSE_SERVER=1`. Without it the suite
always builds and boots its own server. A stale `next start` left on port 3210
by an earlier run WILL otherwise answer for a binary nobody built — that
happened, and the suite reported a 216px header and a landing page with no
drill on it. If you opt in, you own what is on the port.

`next build` writes to `apps/web/.next`, so do not run `next dev` (or another
build) in `apps/web` while the suite is running — they would fight over the
same directory, and a half-written `.next` fails with `Cannot find module
'./NNNN.js'` rather than anything that names the cause. A `next dev` server in
that tree also leaves DEV chunks in `.next/static`, which makes
`test/bundleSecrecy.test.ts` count 24 `"key":"ai"` against a budget of 12 and
fail for reasons that have nothing to do with secrecy (see AGENTS.md
"Commands"). `AILX_E2E_PORT` moves the server off 3210; to run two suites in
one checkout, use a `git worktree`, which gets its own `.next`.

To smoke a deployed environment instead, set `AILX_E2E_BASE_URL=https://…`;
no server is booted. Note that a tunnel with an interstitial (ngrok's free
browser warning) will fail the T1 site spec for reasons that are not ours.

## The preflight, first

`preflight.spec.ts` asks the service ONE question before anything else needs
an answer: does it allow, cross-origin, every header this browser sends
(`BROWSER_REQUEST_HEADERS` in `@ailx/contract`)?

It exists because a refused header is invisible from either side. The browser
does not strip it — it never sends the request — so the app reports "Failed to
fetch" and a spec reports a locator that timed out. On 2026-09-03 the browser
began sending a W3C `traceparent` on every service call while the service
still allowed four hard-coded names; the hosted app could not load a deck,
sync a run or publish a T1 site, and this suite spent fifteen minutes failing
seventeen specs at seventeen different locators. The one round trip here names
it in a line.

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
- **Fixtures, not helpers-in-tests.** Shared locators, the focus invariant and
  the runner fault injector live in `fixtures.ts` so no spec re-implements them
  — and so an injector cannot rot in one copy while the other still works.
- **Visual contracts, not eyeballs.** Geometry lives in `visual.ts` and is
  applied in `visual.spec.ts` (FRONTEND.md §6.7). Never re-measure a box inside
  a spec.
- **Settle the harness scroll first.** Playwright scrolls an element into view
  as part of its actionability checks, so a click can move the page for reasons
  that are not the app's. `settleOn()` before any stability assertion.

## The visual layer

```
visual.ts                 the contracts (on screen, centred, covered, tappable,
                          stable, unclipped) — the assertions jsdom cannot host
visual-contracts.spec.ts  MUTATION TESTS for the contracts themselves: each one
                          is proven to FAIL on a deliberately broken layout.
                          Needs no server, no database, no deck.
visual.spec.ts            the contracts applied to the surfaces where this class
                          of bug has actually bitten
visual-baselines.spec.ts  four screenshot baselines (element shots, deterministic
                          copy only): the pause overlay, the time-up notice, the
                          runner crash notice, the shared player-type card. Per
                          platform; the committed ones are darwin
```

Update baselines with `pnpm --filter @ailx/web e2e --update-snapshots`, and read
the diff before committing it — an unread baseline is a rubber stamp.
