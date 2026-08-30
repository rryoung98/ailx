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

## Two kinds of item

`credit.origin` says which:

- `commons` — a file somebody else published under a free licence. It carries
  a Commons title, a source URL and the page phrase that evidences generation.
- `generated` — ours. It carries the model, the provider, the FULL prompt, the
  generation date and `rights_basis`, the quoted provider term that lets us
  republish it. We release these as CC0.

## Growing it by generating

The thinnest family is **sociocultural on the synthetic side**: a picture has
to be culturally specific before it can be culturally wrong, and free-licensed
photorealistic generations are mostly landscape, architecture and food. So we
generate.

```sh
# needs requests + pillow, and a key of our own:
export AILX_GEN_OPENROUTER_KEY=sk-or-...
python3 tools/generate-practice-images.py            # writes .ailx-generated/
python3 tools/generate-practice-images.py --status
# LOOK at each file, full size, then:
python3 tools/generate-practice-images.py --accept SLUG --reason "..."
python3 tools/generate-practice-images.py --reject SLUG --reason "..."
python3 tools/build-practice-corpus.py --offline     # generated rows need no network
```

Without `AILX_GEN_OPENROUTER_KEY` the client falls back to the shared demo
proxy under a hard per-run call cap. That budget exists so a visitor can sit
T4 with no key; it is not the corpus budget.

Three rules are enforced rather than remembered:

1. **Multi-model.** A corpus from one generator teaches that generator's
   fingerprint, not the artefact. Prompts are spread across both provider
   families and across model generations — including OLDER models, whose
   cruder failures are the easy end of the difficulty range — and the corpus
   test fails on fewer than two models, fewer than two providers, or one model
   holding more than half of what we generated.
2. **A person looks at every image.** Generation only produces a `pending`
   attempt; the build refuses anything not accepted. A prompt that asks for an
   artefact does not reliably produce one — models silently repair impossible
   physics — so the accept/reject verdict and its reason go in
   `generated.json` and stay there.
3. **Rights before pixels.** `instruments/tools/openrouter_images.py` will not
   generate from a provider that has no quoted redistribution basis, so an
   unlicensable image cannot reach the repository by accident.

### Writing a prompt that produces a tell

- Name a CONCRETE setting, tradition or object. A generic scene cannot be
  specifically wrong, and "looks uncanny" is not a tell.
- Describe the artefact as a plain fact of the photograph, not as an
  instruction to make a mistake.
- Ban text: `no text, no lettering, no numbers, no signage`. Garbled signage
  answers the card for free and is not the artefact under study.
- Ask for photorealism explicitly. A painterly finish is answerable in a
  second from style alone (see `material.style`).
- No political or celebrity subjects: a candidate would answer from prior
  recognition instead of inspection, and it conflicts with the neutrality
  positioning (`docs/POSITIONING.md`).
- On a sociocultural item the error must be one a knowledgeable person would
  actually catch, never a stereotype, and the tell must teach the real
  convention. A clumsy sociocultural item is worse than none.
