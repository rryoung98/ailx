# Batch D — FROZEN acceptance criteria (written before implementation; a worker may NOT edit this file)

## TEN-225 — [P1] The 'scanned at least one build output' sentinel in bundleSecrecy can never fail, so both bundle scans can silently degrade

The sentinel counts only modes with `expectItemIds: true`, a missing build output fails in CI rather than skipping, and a test asserts the sentinel fails when neither build directory exists.

## TEN-226 — [P1] The database dependency ban is a six-name list that omits the documented Neon driver

The ban is a rule about capability, not a name list: any dependency matching a known SQL or driver set, plus a per-app `db/` check, and a test that adds `@neondatabase/serverless` to `apps/web/package.json` in a fixture and asserts the gate fails.

## TEN-227 — [P1] @clerk/backend is banned by declared name but reachable through @clerk/nextjs/server

The gate greps sources for `@clerk/nextjs/server` and any `@clerk/backend` import path, not just the manifest, with a fixture asserting the failure.

## TEN-228 — [P1] 'use server' is banned in prose only, so a server action in a hosted page would be an unguarded public endpoint

The gate greps every source file under `apps/*/app/**` for a `'use server'` directive and fails, with a fixture proving the failure.

## TEN-236 — [P2] The public-tree gate constrains file names, so a keyed bank under a new instruments directory passes every assertion

The content gate carries an inventory: every file under `instruments/**` is named by a committed manifest or by a frozen list, with a fixture proving an unmanifested `bank.jsonl` fails.

## TEN-180 — [P0] Development identities are counted as registered users and their sittings as sittings

One predicate in one place, applied to every participant-derived query: exclude asserted identities from the counted figures, or count them and render "of them development" beside each. A test that seeds one `dev:` and one `clerk:` participant asserts the headline count is one, not two.
