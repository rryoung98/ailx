# instruments/demo-2026.1 — the public released-practice tier

**GENERATED / DERIVED. Do not hand-edit `tracks/t2-discrimination/items/`.**

This is the released tier of spec §09: twenty T2 items whose `key`,
`rationale` and `provenance` are published **on purpose**. It exists for one
reason — `docs/ARCHITECTURE.md` §2.2 and §10 step 1: the static GitHub Pages
build must run a real T2 deck without the operational bank in its module
graph. This package **issues no score of record**.

The operational instrument stays in `../2026.1`. The two banks are disjoint:
104 authored items = 20 released here + 84 operational there.

## What is a real file and what is a symlink (DRY)

Only two things in this tree are their own bytes:

| Path | Why |
|---|---|
| `manifest.yaml` | different `id`/`version`/`notice` — the honest label |
| `tracks/t2-discrimination/items/` | the released bank, `bank.sha256`, `link-check.json` |

Everything else — `tracks/t1-creative-build`, `tracks/t3-reasoning`,
`tracks/t4-generative` (whole directories) and `tracks/t2-discrimination/{track.yaml,rubric.yaml}`
— is a **relative symlink into `../2026.1`**. Rubric and judge-prompt bytes
are therefore shared, not copied, so `rubricVersion` is byte-identical in both
snapshots by construction rather than by discipline. `@ailx/content-tools`'
loader reads through symlinks; nothing else in the build resolves them
(`snapshot.json` is a real generated file).

## Snapshot shape contract

`snapshot.json` here is a **drop-in replacement** for
`../2026.1/snapshot.json` as consumed by `apps/web/lib/instrument.ts`: same
`format`, same four `instrument.tracks[]` entries with the same `config`
blocks (including t2 `blocks[].exposure_seconds`), the same `rubricVersion`
per track, and the same `scorers[]` audit digests (built with
`--scorers ../tracks`). Only the t2 `bank` (and `manifest`) differ.

## Rebuild

```
pnpm --filter @ailx/content-tools build
pnpm --filter @ailx/content-tools run snapshot:demo-2026.1
```

To re-derive the partition itself, see
`../2026.1/tracks/t2-discrimination/items/README.md` §Partition — it records
the selection rule and the exact counts.
