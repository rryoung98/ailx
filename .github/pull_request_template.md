## What and why

<!-- One paragraph: the behaviour change and the reason. Link the spec section or issue. -->

## How it was verified

<!-- Commands run and what you saw. -->

- [ ] `pnpm -r test` and `pnpm -r build` pass locally
- [ ] Server mode still builds if API routes changed (`AILX_BACKEND=1 pnpm --filter @ailx/web build`)
- [ ] New/changed behaviour has tests at the cheapest level that can observe it (`FRONTEND.md` §6.2)

## Invariants (`AGENTS.md`)

- [ ] Any score issued stays byte-identically recomputable; `score()` stays pure
- [ ] Item banks / instrument content are content-addressed — edits create new items
- [ ] `responses` and `transcripts` stay append-only
