# Contributing

Branch → PR → green CI → merge → auto-deploy. `main` is protected; push it through a PR.

## Branch and PR

- Branch off `main`, named `w/<topic>`. A Linear id is a fine topic: `w/ten-156`.
- Open the PR against `main`. Nobody pushes `main` directly.
- Keep commits small. Commit titles are not linted — the history is mixed and a
  regex gate would fail real PRs — so write a title a reviewer can read.

## The merge gate

`.github/workflows/ci.yml` runs three jobs, and **their names are the branch
protection contract**: `lint`, `verify`, `e2e`. Renaming one silently ungates the
repository.

| job | what it is |
|---|---|
| `lint` | Biome over the tree. No `needs:` — a lint error should not wait 20 minutes behind a build. Errors fail; the `warn` rules in `biome.jsonc` are carried debt (`docs/DEBT.md`). |
| `verify` | install, `pnpm -r build`, the `AILX_BACKEND=1` server build, `pnpm test:coverage`. |
| `e2e` | Playwright against a running exam service. `needs: verify`. |

**A new gate is a SIBLING of `e2e` with `needs: verify`, never a chain after
Playwright.** The two are independent and must fail independently. Chaining a
third job behind `e2e` hides it whenever the browser suite is red or skipped.

`codeql` and Dependabot run outside the merge gate.

On merge, `pages` runs only after `ci` succeeds on that commit: it rebuilds the
static export, stamps `/version.json`, deploys to GitHub Pages, and tags the
commit `build-<UTC date>-<short sha>`. Nothing is published to a registry.

## `pnpm -r build` IS the typecheck

There is deliberately no `type-check` script. Every package's `build` is
`tsc -p tsconfig.json`, and `next build` typechecks `apps/web`. A standalone
`tsc --noEmit` pass would compile the same sources twice for the same
diagnostics. The comment that says so lives on the build step in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml); do not add the script.

## Before you push

```sh
pnpm install
AILX_TEST_FORKS=2 pnpm test    # one vitest for the whole monorepo
pnpm -r build                  # the typecheck
```

Run the static build and the `AILX_BACKEND=1` build **sequentially**, with
`rm -rf apps/web/.next` between them. Two concurrent `next build`s into the same
`.next` fail with errors that name nothing real.

### Local hooks

`lefthook.yml` installs two hooks with `pnpm exec lefthook install`:

- **pre-commit** — Biome on the staged files. Fast enough to keep.
- **pre-push** — `pnpm test`. Skip it on a draft with `LEFTHOOK=0 git push`.

`pnpm -r build` is not a hook. It is CI's `verify` job, and a twenty-minute hook
is a hook people learn to skip.

## Shared packages flow one way

`core`, `contract`, `report` and `session` are **edited here** and synced into
the private `ailx-backend` repository, which vendors a copy and compares it byte
for byte on every PR (`pnpm sync:shared:check` there). Never fix one of these
packages in the backend repo and copy it back.

## This tree is a frontend

The exam service — HTTP handlers, the append-only store, auth, and the
operational item bank — lives in the private `ailx-backend` repository. So a PR
here may not add:

- an `app/api/**` route (there is exactly one route handler, `app/s/[token]/card.png`, allowed by name);
- a `pg`, `node-pg-migrate` or `@clerk/backend` dependency, a `db/` directory or a server request adapter;
- any operational bank content: keyed items, judge prompts, rubric marking detail, T1/T3/T4 `form.json`.

Two tests enforce it, and they are not advisory:

- `packages/core/test/frontendOnly.test.ts` — the dependency, route and import rules above, and it also fails if something a browser legitimately needs goes missing.
- `packages/content-tools/test/public-tree.test.ts` — the content tree. `instruments/demo-2026.1` is the only instrument here, and it must stay redacted.

`apps/web/test/bundleSecrecy.test.ts` guards `apps/web/public/**`: every file
there must be named by a committed manifest or by a frozen list in that test.

## Environment

`apps/web/.env.example` lists what the frontend reads. Secrets for the exam
service, the bank and Clerk belong in the private repo — never in this tree.
