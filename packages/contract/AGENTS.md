# AGENTS.md — `packages/contract`

The browser-facing API CONTRACT: wire types, frozen URL spellings, query
parsers, the dev-identity predicate, and `BROWSER_REQUEST_HEADERS`. Root
[`AGENTS.md`](../../AGENTS.md) has the repository split.

This package is the source of truth. The private `ailx-backend` repository
vendors a byte-identical copy and checks it on every PR. Fix it HERE, never
there.

## Pure

No `node:` imports, no env reads, no I/O. This module is compiled into a browser
bundle and into the exam service. Anything that only works in one of the two
does not belong here.

## The URLs are frozen

`src/routes.ts` is the one spelling of every route the browser calls, including
the six `/v1/model/*` gateway routes under `MODEL_ROOT`. A route is renamed in
one place or not at all. A deployed service and a deployed browser are never
the same age, so a spelling that drifts is a 404 in production and a green test
suite in both repos.

## `BROWSER_REQUEST_HEADERS`

One list of the request headers the browser sends. It is what the exam service
must allow in a CORS preflight. Adding a header to a fetch without adding it
here produces a preflight failure that looks like an outage and reads like a
CORS misconfiguration. Add it here first.
