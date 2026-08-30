# T2 item bank

`bank.jsonl` is a JSON-lines file of content-addressed items
(`id = sha256(canonical_json(item minus id))`; keep it canonical with
`hash-bank --write`, then regenerate `../../snapshot.json` with `build-snapshot`).

## Material kinds

(The mock hand-drawn `svg` vignettes were retired on 2026-08-21 — see
`docs/CONTENT-AUDIT.md`; the 44 real Commons media items are the image bank.)

| kind | fields | notes |
|---|---|---|
| `text` | `text` | inline passage |
| `scenario` / `email` / `chat` | (varies) | inline structured text |
| `image` | `src`, `alt` | **NEW (2026.1 real-media deck)** — see below |

### `kind: "image"` (real-vs-AI photo deck)

- `src` is a **relative path** under `apps/web/public/`, e.g.
  `t2-media/a7897c69b204.jpg`. The filename is the first 12 hex chars of the
  sha256 of the encoded JPEG bytes. The web adapter must resolve it as
  `/<src>` (Next.js static asset) — it is NOT a data URI and NOT an absolute
  URL. Adapter wiring happens outside this track package.
- `alt` is a neutral description that must not leak the answer.
- Items of this kind use `type: "image-provenance"`, options
  `real` ("Real photograph") / `ai` ("AI-generated image"), and stem
  "Is this a photograph or an AI-generated image?".
- Every image is sourced from Wikimedia Commons (both sides), license
  CC0/CC-BY/CC-BY-SA/PD only; `provenance` carries `source_url`,
  `commons_title`, `author`, `license`, `retrieved`. Attribution for all
  images lives in `docs/CREDITS.md` (required by CC-BY/CC-BY-SA).
- Reproduction pipeline: `tools/fetch-commons-media.py` +
  `tools/curated-titles.txt`.
- Asset budget enforced by test: every referenced `src` must exist in
  `apps/web/public/t2-media/` and be <= 200 KB
  (`packages/content-tools/test/media-assets.test.ts`).

## Provenance legitimacy & link checking

- `key:"ai"` text passages are genuinely model-generated via OpenRouter
  (`tools/gen-ai-passages.mjs`; model/date/prompt recorded in item
  provenance; the API key is read from `OPENROUTER_API_KEY` at generation
  time only and never committed).
- `key:"human"` text passages are genuine pre-2015 human text (Project
  Gutenberg / pre-2015 Wikipedia revisions; `source_url` in provenance).
- message-hostility items cite a documented real phishing `pattern_family`;
  provenance-reasoning items cite the real `mechanism` (C2PA spec, RFC 6962,
  the 2025 Nikon C2PA certificate revocation).
- Every `source_url`/`references` URL is live-checked with
  `node packages/content-tools/dist/cli/check-links.js items/bank.jsonl --write`,
  which writes `items/link-check.json`. CI validates that committed manifest
  (coverage + bank sha256 freshness + all 2xx/3xx) without network access —
  rerun the live check whenever the bank changes.

## Partition: 104 authored items = 84 operational + 20 released (2026-08-30)

This bank held all 104 authored T2 items, and `apps/web/lib/instrument.ts`
statically imported `../../snapshot.json`, so every `key`, `rationale` and
`provenance` shipped to the browser (`docs/ARCHITECTURE.md` §0). The corpus is
now split in two:

| | items | package | keys public? |
|---|---|---|---|
| operational | **84** | `instruments/2026.1` (this file) | no — moves to private custody, §10 step 2 |
| released practice | **20** | `instruments/demo-2026.1` | **yes, on purpose** (spec §09 released tier) |

The two sets are disjoint; the union is exactly the original 104 items, byte
for byte. No item was edited — items are content-addressed, so a partition is
a move, never a mutation, and every id is unchanged.

### Counts (released / operational)

| locale | image-provenance | text-authenticity | message-hostility | provenance-reasoning |
|---|---|---|---|---|
| en | 4 / 52 | 2 / 4 | 2 / 4 | 2 / 4 |
| ja | 2 / 4 | 1 / 2 | 1 / 2 | 1 / 2 |
| ko | 2 / 4 | 1 / 2 | 1 / 2 | 1 / 2 |

### Why exactly these counts

`packages/tracks/t2-discrimination/src/deck.ts` deals a 6-item deck: one
difficulty-matched media pair (1 AI + 1 real), one text pair (1 signal + 1
benign, drawn from text-authenticity **and** message-hostility together), and
2 provenance items. The released tier therefore needs at least that much per
locale, and the operational remainder must keep dealing a full deck.

Measured with `sampleT2DeckIds` over the fixed default deck and 200 seeded
decks:

| tier | en | ja | ko |
|---|---|---|---|
| operational | 6 | 6 | 6 |
| released practice | 6 | **5** | **5** |

The ja/ko released deck is 5, not 6, and that is forced: each locale has only
3 provenance-reasoning items in total. Giving both tiers the 2 the deck wants
needs 4. The operational tier keeps 2 (a full deck); the released tier keeps
1 and deals a 5-item practice deck. Authoring one more ja and one more ko
provenance item is the fix, and it is content work, not a code change.

### Selection rule (reproducible)

Deterministic and first-in-file-order within each stratum, so anyone can
re-derive the same 20 items:

1. Stratify by `(locale, type, key)` keeping bank file order.
2. **image-provenance** — take the first N `key:"ai"` items; for each, take the
   real partner from the remaining `key:"real"` pool with the smallest
   difficulty distance (ties broken by file order). en pairs matched exactly
   (hard/hard, medium/medium); ja and ko matched easy/medium, which is the
   closest available because every ja/ko `real` image is `medium`.
3. **text-authenticity / message-hostility** — en takes the first item of each
   key (1 AI + 1 human, 1 hostile + 1 legitimate). ja and ko take the first
   text-authenticity item, then the first message-hostility item of the
   OPPOSITE class, so the locale's text pair is still 1 signal + 1 benign.
4. **provenance-reasoning** — first 2 (en), first 1 (ja, ko), in file order.

### Cross-tier invariants

Three properties are now properties of the UNION, not of this file, and the
tests say so:

- every shipped `apps/web/public/t2-media/*.jpg` is referenced, and each
  locale references each asset once (`test/media-assets.test.ts`);
- a ja/ko item's `provenance.source_item` resolves — its en ancestor may sit
  in the other tier (`test/instrument-2026.1.test.ts`);
- content legitimacy (real Commons media, model-generated AI passages,
  public-domain human passages, cited pattern families) holds for all 104
  items (`test/content-legitimacy.test.ts`). Publishing a key does not lower
  the sourcing bar.

One per-locale expectation was relaxed on evidence: ja/ko now hold 2 AI + 2
real images each instead of 3 + 3, because one matched pair per locale moved
to the released tier. 2 + 2 is still class-balanced and still deals a 6-item
deck.

### Rebuild after any bank edit

```
pnpm --filter @ailx/content-tools build
pnpm --filter @ailx/content-tools run snapshot:2026.1
pnpm --filter @ailx/content-tools run snapshot:demo-2026.1
```

`items/link-check.json` was re-partitioned alongside the bank (each tier keeps
the recorded live results for its own items, same `checked_at`, same
statuses). Re-run the live check with
`node packages/content-tools/dist/cli/check-links.js items/bank.jsonl --write`
in each tier whenever item URLs change.
