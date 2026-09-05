# AGENTS.md — `packages/core`

The TrackPlugin interface, the scoring purity harness, content addressing and
the T1 ZIP writer. Root [`AGENTS.md`](../../AGENTS.md) lists the core
invariants; this file is how two of them are enforced here.

This package is the source of truth. The private `ailx-backend` repository
vendors a byte-identical copy and checks it on every PR. Fix it HERE.

## `score()` is pure

`score()` is pure — no I/O, clock, or randomness. `runPure` (`packages/core/src/purity.ts`) enforces this in CI by TRAPPING GLOBALS: clock, randomness, network, deferred scheduling, a promise return and a newly created global all throw. It is not a sandbox and does not claim to be — it cannot see a reference captured before the call, a `node:fs` imported at module load, or a `process.env` read. The blind spots are listed in that module and each one has a test asserting the harness stays quiet, so the list cannot rot. Byte-identical replay is verified ON THE PINNED RUNTIME; cross-runtime-version identity is NOT proven (no runtime version is stored in provenance, and unicode case folding moves with ICU).

Read the blind-spot list in `src/purity.ts` before trusting a green run. `runPure`
is a trap on globals, not a sandbox: a reference captured before the call, a
`node:fs` imported at module load and a `process.env` read all get past it.

## Content addressing

Item banks are content-addressed. An edit creates a new item; nothing is
mutated in place.

A judge's output is a stored input, so it is content-addressed too
(`judgmentId`). Stored rows go into ONE canonical total order and every
aggregation over them is order-invariant by construction (`src/judgments.ts`),
because a store read without `ORDER BY` used to change a T3 score by a rounding
step. Never put a model call on the recompute path.

## The frontend-only gate lives here

`test/frontendOnly.test.ts` is what stops this public repo growing a backend:
an `@ailx/backend` import, a `pg` / `node-pg-migrate` / `@clerk/backend`
dependency, an `app/api/**` route, a server request adapter, a `db/` directory
or a second route handler. It also fails if something a browser legitimately
needs goes missing. Do not weaken it to land a change; the change is the
problem.

Bump `package.json` when core's public behaviour changes. The audit digest no
longer depends on you remembering — see
[`packages/content-tools/AGENTS.md`](../content-tools/AGENTS.md).
