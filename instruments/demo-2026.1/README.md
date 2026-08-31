# instruments/demo-2026.1 — the public released-practice tier

**GENERATED / DERIVED. Do not hand-edit `tracks/t2-discrimination/items/` or
`snapshot.json`.**

This is the released tier of spec §09: twenty T2 items whose `key`,
`rationale` and `provenance` are published **on purpose**. It exists for one
reason — `docs/ARCHITECTURE.md` §2.2 and §10 step 1: the static GitHub Pages
build must run a real T2 deck without the operational bank in its module
graph. This package **issues no score of record**.

It is now the ONLY instrument in this repository. `instruments/2026.1` — the
operational tier, its 84 keyed items, its judge prompts and its rubric marking
detail — lives in the private backend repo and nowhere else. The 104 authored
items are still disjoint: 20 released here + 84 operational there.

## Self-contained, and redacted by construction

Every file in this tree is its own bytes. The four track directories used to
be symlinks into `../2026.1`, which is why deleting that tree could not be a
`rm -rf`: dereferencing the links would have copied the judge prompts and the
rubric `description`/`band_anchors` marking detail into the public tree, which
is exactly the leak commit 78e3cef closed.

So the copies are REDACTED, and `manifest.yaml` says so with `redacted: true`.
That flag is enforced by `@ailx/content-tools`' loader, not by discipline:

| A redacted package | Result |
|---|---|
| criterion carries a `description` | load FAILS |
| rubric carries `band_anchors` | load FAILS |
| a track carries a `prompts/` directory | load FAILS |
| a judged criterion has no prompt | allowed (that is the point) |

What each `rubric.yaml` still carries is the PUBLISHED allocation of spec §14:
criterion `id`, `name`, `points`, `scored_by`, `judged`, and `total_points`.
Each `track.yaml` is a verbatim copy — it was already public, byte for byte, in
the snapshot the browser has always downloaded.

`packages/content-tools/test/public-tree.test.ts` re-asserts all of this over
the whole `instruments/` directory, so an operational tier, a judge prompt or a
rubric `description` cannot come back under any name.

## Why the `rubricVersion` values moved

`rubricVersion` is `hash(rubric.yaml + prompts)`. While the rubrics were
symlinks the two tiers hashed the same bytes, so the demo snapshot carried the
OPERATIONAL rubric versions. The redacted rubric is a different document, so it
has a different content address:

| track | was (operational bytes) | now (redacted bytes) |
|---|---|---|
| t1-creative-build | `572c74c9…` | `2c7ee7e8…` |
| t2-discrimination | `4bb83e18…` | `320dcfce…` |
| t3-reasoning | `c223b246…` | `b0d406af…` |
| t4-generative | `0b6fe323…` | `b417ebdd…` |

This was checked before it was done, because `rubricVersion` is an audit fact
that ships to the browser:

- **Nothing pins the old values.** Neither repository contains any of the four
  digests as a literal, a fixture, a migration or a golden file; both were
  grepped. Every consumer reads the value out of the snapshot it loaded.
- **This tier issues no score of record,** so no stored `scores` row can be
  invalidated by the move. The scores that ARE of record are cut against the
  operational instrument in the private repo, whose rubric.yaml and prompts are
  untouched — its four `rubricVersion` values are still `572c74c9…` and friends.
- **The alternative was worse.** Keeping the numbers would have meant either
  keeping the mark scheme in the public tree, or declaring `rubric_version:` as
  a literal in the YAML. The second is not a content address at all; it would
  let the document change while the digest stayed still, which is the exact
  failure content addressing exists to prevent.
- **The digest that must not move did not move.** `bank.sha256` and all four
  `scorers[]` audit digests are byte-identical, because no item and no
  `score()` source changed.

One consequence, stated rather than hidden: the private repo's own
`instruments/demo-2026.1` is a full (unredacted) copy, so the same instrument
id carries the operational `rubricVersion` there and the redacted one here.
The private copy is the one that can score; this one is the one a browser gets.

## Snapshot shape contract

`snapshot.json` is what `apps/web/lib/instrument.ts` imports. It is the same
`format`, the same four `instrument.tracks[]` entries with the same `config`
blocks (including t2 `blocks[].exposure_seconds`), and the same `scorers[]`
audit digests (built with `--scorers ../tracks`). Built with `--public`, so it
additionally strips every item's `provenance` — belt and braces now that the
sources on disk carry no marking material either.

## Rebuild

```
pnpm --filter @ailx/content-tools build
pnpm --filter @ailx/content-tools run snapshot:demo-2026.1
```

There is no `snapshot:2026.1` script any more; it built a directory that is not
in this repository. The operational snapshot is rebuilt in the backend repo.

The partition rule that produced these twenty items (and the exact counts) is
recorded with the operational bank, in the private repo's
`instruments/2026.1/tracks/t2-discrimination/items/README.md` §Partition.
