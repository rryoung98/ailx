# Practice corpus — 2026.1

The **unscored** training corpus for `/practice` (spec §13 "Mastery").
It is deliberately NOT under `instruments/2026.1/`: that tree is the secure
instrument, and this content is the opposite of secure — it is meant to be
seen, repeated and explained.

## What an item is

One freely-licensed image, plus four things:

| Field | Why it exists |
|---|---|
| `key` | `synthetic` or `authentic` — T2's own call, "photograph or AI-generated image?" |
| `family` | `physics` / `function` / `social` — the durable artefact families. For a synthetic item it is the family of the artefact present; for a photograph it is the family a viewer is most likely to accuse it of wrongly. |
| `difficulty` | `easy` / `medium` / `hard` — how hard the tell is to SEE, not how rare it is. |
| `tell` | One line, shown the moment the call is made. The intervention lives here. |

Every item also carries `credit`: licence, author, Commons title, source URL,
retrieval date, and what was changed from the original. CC-BY and CC-BY-SA
require attribution wherever the work is shown, so the drill renders it under
the picture and `packages/report/test/practiceCorpus.test.ts` refuses an item
that has lost it.

`alt` is a neutral scene description. It must let a screen-reader user play
the card without handing them the answer, so it may not name the class, the
generator, or the artefact — asserted by test. It must also DESCRIBE THE
PICTURE THAT IS SHOWN: a screen-reader candidate answers from the alt, so an
alt that names the wrong machine or the wrong species is a wrong question, not
a typo.

An item may also carry `style` (`painterly` or `render`) when the picture is
not photorealistic. Such an item is answerable from its finish in a second,
which teaches "painterly = generated"; flagging it keeps the weakness in the
data instead of in nobody's head.

## No free answers

Nothing a script can compute WITHOUT looking at the picture may predict the
answer. Aspect ratio was the first offender — generators default to 1:1,
cameras do not — so `crop` is now used to reframe as well as to remove
watermarks (`crop_reason` says which, and the reason is written into the
item's `derivative` credit), and every asset is encoded towards ONE common
size because photographs compress large and generations compress small.
`packages/report/test/practiceCorpus.test.ts` fails if aspect, orientation,
dimensions, pixel count, file-size band or colour components beats chance.
Adding items means re-running that test, not remembering this paragraph.

## Files

- `curation.json` — hand-written input. This is the file to edit.
- `corpus.json` — the built manifest. Source of truth for the app.
- `tools/build-practice-corpus.py` — the pipeline.
- Assets land in `apps/web/public/practice-media/`, named by content address
  (so a re-crop or a re-encode CHANGES the filename — delete the orphan and
  update `docs/CREDITS.md`).
- `packages/report/src/practiceCorpus.ts` is GENERATED; do not edit it.

## Rebuilding

```sh
python3 instruments/practice/2026.1/tools/build-practice-corpus.py
# then, because the corpus version changed:
#   bump `version` in curation.json, and update docs/CREDITS.md
```

Add `--offline` to re-emit the TypeScript from `corpus.json` without network.

## What the pipeline refuses

It exits non-zero rather than guessing:

- a Commons title already used by the scored T2 bank;
- an asset whose encoded bytes match a shipped scored asset;
- a licence outside CC0 / CC-BY / CC-BY-SA / public domain;
- an item curated `synthetic` whose Commons page claims no generator;
- an item curated `authentic` whose Commons page mentions one.

The last two matter more than they look. Commons AI categories contain AI
*restorations* of real photographs and real photographs of AI-themed events;
both were found and rejected while this corpus was built. Category membership
is not ground truth, so the claim is read from the file page and the matching
phrase is recorded in the item as `generator_evidence`.

## Growing it

There is no image generation in this repository — `services/openrouter-proxy`
is text-only and T4's image model is a deterministic SVG simulator. Every
synthetic item here is a *found* generation published by somebody else under a
free licence. To go deeper, either curate more Commons titles, or generate
images with a real model under terms that permit redistribution and record the
model, prompt and date in the credit.

The thinnest family is **sociocultural on the synthetic side**: a generated
picture has to be culturally specific before it can be culturally wrong, and
the free-licensed photorealistic generations available are mostly landscape,
architecture and food.
