# T2 bank content audit — 2026-08-21

Scope: every item in
`instruments/2026.1/tracks/t2-discrimination/items/bank.jsonl`
(66 items). Verdicts: **legitimate** (grounded in real, cited material) and
**legitimate-authored** (authored content explicitly modeled on a documented
real-world pattern or mechanism, cited in provenance).

Method:
- Live HTTP check of every `provenance.source_url` and `provenance.references`
  URL — all 55 unique URLs returned 200 (manifest:
  `items/link-check.json`, gated by `packages/content-tools/test/link-manifest.test.ts`).
- Wikimedia Commons category cross-check for all 44 media items: each item's
  recorded key agrees with the Commons categorisation of its file, in every
  case; no file pages are missing.
- The model-written text passages were regenerated for real via OpenRouter
  (`openai/gpt-4o-mini`, prompts committed in item provenance and
  `tools/generated-ai-passages.json`).
- The human-written text passages were replaced with genuine pre-2015
  human text (Project Gutenberg / pre-2015 Wikipedia revisions, source URLs
  in provenance).

## Media items (44) — image-provenance

All 44 verified against Wikimedia Commons (source pages resolve; AI/real
labeling matches Commons categorization; attribution in `docs/CREDITS.md`).
Verdict for all 44: **legitimate**.

Caveat (flagged, not fixed here): three Commons files each back two bank
items via different re-encodes — an artifact of merging two curation
branches. Near-duplicate stimuli slightly reduce effective deck size;
recommend deduplication in the next bank revision.

## Non-media items (22)

This section carried a row per item — the content-addressed id prefix beside
that item's key and the evidence for it. The per-item ledger has been removed
(TEN-113): it belongs with the bank, which is private, and an audit report is
not the place to publish a key. What an audit report owes a reader is the
method, the coverage and the verdict, and all three are below. The full ledger
is regenerable from the bank by whoever holds it.

| Type | Items | Verdict | Basis |
|---|---|---|---|
| text-authenticity | 8 | **legitimate** | each passage is either genuinely model-generated via OpenRouter (`openai/gpt-4o-mini`, 2026-08-21, prompt in provenance) or genuine pre-2015 human text with a source URL in provenance |
| message-hostility | 8 | **legitimate-authored** | each authored on a documented real-world pattern (phishing, business email compromise, smishing), with references in provenance |
| provenance-reasoning | 6 | **legitimate-authored** | each cites a real mechanism (C2PA Specification 2.1, or a documented certificate-revocation case), recorded in `provenance.mechanism` |

Coverage: 22 of 22 non-media items audited, 18 en / 2 ja / 2 ko. No item was
rated anything other than the two verdicts above.

## ja/ko translation status

All ja/ko items whose stem/rationale were machine-translated now carry
`translation_provenance: "machine-unreviewed"` plus a `translation_note`
stating no native-speaker review has occurred (gated by
`packages/content-tools/test/content-legitimacy.test.ts`).

## Landing teaser (removed, 2026-09-04)

`apps/web/lib/instrument/demoItems.ts` pinned three real snapshot items by
content-addressed id for the landing teaser. The teaser component was
reachable from no route, so it, the derivation and `test/teaser.test.ts`
were deleted. No released item is published on the landing page any more.
