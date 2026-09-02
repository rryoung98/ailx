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
- Wikimedia Commons category cross-check for all 44 media items: every
  `key:"ai"` file sits in an AI-generated media category on Commons; every
  `key:"real"` file does not; no file pages are missing.
- The four `key:"ai"` text passages were regenerated for real via OpenRouter
  (`openai/gpt-4o-mini`, prompts committed in item provenance and
  `tools/generated-ai-passages.json`).
- The four `key:"human"` text passages were replaced with genuine pre-2015
  human text (Project Gutenberg / pre-2015 Wikipedia revisions, source URLs
  in provenance).

## Media items (44) — image-provenance

All 44 verified against Wikimedia Commons (source pages resolve; AI/real
labeling matches Commons categorization; attribution in `docs/CREDITS.md`).
Verdict for all 44: **legitimate**.

Caveat (flagged, not fixed here): three Commons files each back two bank
items via different re-encodes (`Cabine balneari.jpg`, `Green apple
gen.png`, `Cute Hedgehog.jpg`) — an artifact of merging two curation
branches. Near-duplicate stimuli slightly reduce effective deck size;
recommend deduplication in the next bank revision.

## Non-media items (22)

| id (prefix) | type | locale | key | verdict | basis |
|---|---|---|---|---|---|
| 08a88a7beba1 | text-authenticity | en | ai | **legitimate** | genuinely model-generated via OpenRouter (openai/gpt-4o-mini, 2026-08-21); prompt in provenance |
| a78afdff4d93 | text-authenticity | en | human | **legitimate** | genuine human text: Three Men in a Boat (1889), chapter 1 (Public domain) |
| e3316851a3c2 | text-authenticity | en | ai | **legitimate** | genuinely model-generated via OpenRouter (openai/gpt-4o-mini, 2026-08-21); prompt in provenance |
| d121c14a7c45 | text-authenticity | en | human | **legitimate** | genuine human text: 'Kettle', English Wikipedia, revision 633946319 (2014-11-15) (CC BY-SA 3.0) |
| 08c6fc6951b3 | text-authenticity | en | ai | **legitimate** | genuinely model-generated via OpenRouter (openai/gpt-4o-mini, 2026-08-21); prompt in provenance |
| 0d4a4329433c | text-authenticity | en | human | **legitimate** | genuine human text: 'London congestion charge', English Wikipedia, revision 638187193 (2014-12-15) (CC BY-SA 3.0) |
| 896ef91898f0 | text-authenticity | ja | ai | **legitimate** | genuinely model-generated via OpenRouter (openai/gpt-4o-mini, 2026-08-21); prompt in provenance |
| 21c7a83e8996 | text-authenticity | ko | human | **legitimate** | genuine human text: '라면', Korean Wikipedia, revision 13326844 (2014-12-21) (CC BY-SA 3.0) |
| 7d71adb8ad13 | message-hostility | en | hostile | **legitimate-authored** | modeled on documented pattern: Credential phishing: account-suspension urgency lure with look-alike domain; refs in provenance |
| e5c2f2a504b3 | message-hostility | en | legitimate | **legitimate-authored** | modeled on documented pattern: Legitimate-notification contrast case: informational notice with no action, link, or credential request; refs in provenance |
| 6e77a478835b | message-hostility | en | hostile | **legitimate-authored** | modeled on documented pattern: Business email compromise / executive impersonation with urgent out-of-band payment; refs in provenance |
| 01bd3f97ec0e | message-hostility | en | legitimate | **legitimate-authored** | modeled on documented pattern: Legitimate-notification contrast case: reply to a recipient-initiated ticket, routed into the official channel; refs in provenance |
| 6ad59859150b | message-hostility | en | hostile | **legitimate-authored** | modeled on documented pattern: Credential harvesting riding a legitimate e-signature/file-sharing service; refs in provenance |
| 074034989f30 | message-hostility | en | legitimate | **legitimate-authored** | modeled on documented pattern: Legitimate-notification contrast case: attachment-bearing internal notice matching a real booking, verification via known internal channel; refs in provenance |
| e3b132b7349d | message-hostility | ja | hostile | **legitimate-authored** | modeled on documented pattern: 不在通知型スミッシング — delivery-notice smishing impersonating a carrier; refs in provenance |
| 0c0ba40a715f | message-hostility | ko | hostile | **legitimate-authored** | modeled on documented pattern: 공공기관 사칭 스미싱 — public-agency impersonation smishing with sideloaded APK; refs in provenance |
| b4cb1960c7bf | provenance-reasoning | en | no-evidence | **legitimate-authored** | cites real mechanism: C2PA Specification 2.1 (see provenance.mechanism); refs in provenance |
| c064fbdcea13 | provenance-reasoning | en | self-documenting | **legitimate-authored** | cites real mechanism: C2PA Specification 2.1 (see provenance.mechanism); refs in provenance |
| cb4d0189725e | provenance-reasoning | en | scene-true | **legitimate-authored** | cites real mechanism: C2PA Specification 2.1 (see provenance.mechanism); refs in provenance |
| 17e05abf6af0 | provenance-reasoning | en | trust-list | **legitimate-authored** | cites real mechanism: Real case: Nikon revoked its C2PA signing certificates in September 2025 after a Z6III firmware flaw let inauthentic content carry valid signatures |
| 7d34215878da | provenance-reasoning | en | b-only | **legitimate-authored** | cites real mechanism: C2PA Specification 2.1 (see provenance.mechanism); refs in provenance |
| ae3cc8aeda75 | provenance-reasoning | en | derivative-file | **legitimate-authored** | cites real mechanism: C2PA Specification 2.1 (see provenance.mechanism); refs in provenance |

## ja/ko translation status

All ja/ko items whose stem/rationale were machine-translated now carry
`translation_provenance: "machine-unreviewed"` plus a `translation_note`
stating no native-speaker review has occurred (gated by
`packages/content-tools/test/content-legitimacy.test.ts`).

## Landing teaser

`apps/web/lib/demoItems.ts` now pins three real snapshot items by
content-addressed id (AI photo-pair member, model-generated passage,
credential-phishing lure); `apps/web/test/teaser.test.ts` asserts they exist
in the snapshot and that keys/tells are projections of the bank item.
