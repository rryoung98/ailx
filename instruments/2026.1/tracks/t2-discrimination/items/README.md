# T2 item bank

`bank.jsonl` is a JSON-lines file of content-addressed items
(`id = sha256(canonical_json(item minus id))`; keep it canonical with
`hash-bank --write`, then regenerate `../../snapshot.json` with `build-snapshot`).

## Material kinds

| kind | fields | notes |
|---|---|---|
| `text` | `text` | inline passage |
| `svg` | `data_uri`, `description` | inline synthetic vignette |
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
