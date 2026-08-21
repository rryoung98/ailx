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
