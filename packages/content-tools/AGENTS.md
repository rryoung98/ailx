# AGENTS.md — `packages/content-tools`

The instrument loader, the snapshot CLI and the two tests that keep the public
content tree public. Root [`AGENTS.md`](../../AGENTS.md) has the repository
split and the invariants.

## The demo snapshot

`instruments/demo-2026.1` is the ONLY instrument in this repo: the PUBLIC
released-practice tier for the static demo — 20 T2 items whose keys and
rationales are published on purpose, no score of record. It is self-contained
and REDACTED. `manifest.yaml` sets `redacted: true`, and the loader refuses the
package if a rubric `description`, a `band_anchors` block or a `prompts/`
directory ever appears.

Regenerate it with:

```sh
pnpm --filter @ailx/content-tools build    # the CLI runs from dist/
pnpm --filter @ailx/content-tools run snapshot:demo-2026.1
```

Build first. The CLI runs from `dist/`, so a stale `dist` silently snapshots
old code.

## The public-tree test

The OPERATIONAL tier (`instruments/2026.1`: 84 keyed T2 items, T1/T3/T4 judge prompts, rubric marking detail, the T1/T3/T4 `form.json` files) lives in the PRIVATE backend repo and must never be added here. `packages/content-tools/test/public-tree.test.ts` fails the build if it comes back

`test/public-tree.test.ts` is not advisory and is not a lint. It is the gate
that makes a public frontend repo safe to publish. If it fails because content
arrived, remove the content; do not widen the test.

## The audit digest

The audit digest content-addresses `score()` SOURCE at build time (`instruments/demo-2026.1/snapshot.json` `scorers[]`); regenerate with `pnpm --filter @ailx/content-tools run snapshot:demo-2026.1` (build first — the CLI runs from `dist/`). The digests are tier-independent — they hash `score()` source, which is the same in both repos. **What it covers, plainly:** every file in the track's `score()` import closure BY ITS BYTES, and — since 2026-09-01 — the `@ailx/core` modules that closure actually imports, also by their bytes, recorded under a package-qualified path (`@ailx/core/src/rounding.ts`). So editing the score allocation, the canonical judgment order, the order-invariant mean/median or `round3` moves every affected track's digest with NO version bump. What it still does not cover: a REGISTRY dependency (pinned at `name@range`), core modules no scorer imports (`zip.ts`, `ui.ts`, `purity.ts` are deliberately out), and the toolchain — TypeScript, the runtime and ICU are not in the hash. Bump `packages/core/package.json` when core's public behaviour changes, but the digest no longer DEPENDS on you remembering. See `packages/content-tools/src/scorers.ts`.
