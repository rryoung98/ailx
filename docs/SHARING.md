# SHARING — the growth loop

How a finished AILX run becomes something a candidate wants to send, and how
that stays safe. Companion to `AGENTS.md` (invariants) and `FRONTEND.md`
(module and security rules). Spec references are to `AILX-Spec-2026.1.md`.

## 1. What is shared, and what never is

A share carries exactly three things, built by one pure function
(`buildSharePayload`, `packages/report/src/share.ts`) and frozen into the row
at creation:

| Field | Why it is safe |
|---|---|
| `playerType` (code, name, tagline, four poles) | A playful lens over four aggregate numbers. Never part of the score. |
| `tracks` — four 0-100 values | Track SHAPE, not item detail. |
| `band` | A quota band over the demo cohort, not a judged result. |
| `site` | The candidate's OWN built T1 site path. Present only on a second, explicit opt-in. |

Never serialized: item ids, item content, answer keys, per-item correctness,
confidence values, latencies, the event log, the attempt id, the participant
or auth reference, locale, the composite number, the percentile.

### Item-bank leakage — the conclusion

T2/T3/T4 items are the instrument. If item content or per-item outcomes could
be shared, an attacker could farm shared cards to reconstruct the bank, and
every future sitting would be invalid. So the payload is an ALLOWLIST, not a
redaction, and it is asserted as an exact serialized object in
`packages/report/test/share.test.ts`. Four aggregate track numbers cannot
identify which items were drawn (the deck is per-attempt and lives only in
`attempt_decks`), cannot reveal an answer key, and do not change with item
content. T1 is different in kind: it is an open build task with a public
brief, so the candidate's own built site is shareable — that is the point of
it. The boundary is therefore: **T1 artifacts may be shared; T2/T3/T4 detail
may not, at any layer.**

## 2. Private by default, revocable for real

- Nothing exists until the candidate presses "Create a share link"
  (`apps/web/lib/ShareLink.tsx`). There is no default share.
- The link is an **unlisted capability URL**: 32 random bytes, base64url
  (`/s/<43 chars>`), `noindex`, `cache-control: no-store`.
- The server stores only `sha256(token)`. A database leak yields no working
  link, and the URL cannot be recovered from the backend — the browser that
  created it keeps it. If that copy is lost, the honest answer (and what the
  UI says) is: revoke and make a new one.
- Revocation stamps `revoked_at` and every read path filters on it, so the
  page, the JSON route and the `og:image` all 404 immediately — and 404
  identically to a token that never existed, so revocation is not observable.
- The row is never deleted. Re-sharing inserts a NEW row with a NEW token.

## 3. Unlisted is not published

The spec's gallery governance ("approval-required, not takedown-based")
governs what becomes **publicly listed**. An unlisted capability URL is not
listed anywhere, is not indexed, and is only reachable by someone the
candidate handed it to — so it needs no per-asset human approval. That
distinction is deliberate and is enforced by the state model, not by UI copy.

### Lifecycle (all four states implemented; monotone stamps, never edits)

```
private (no row)
   └─ create ─▶ unlisted ─┬─ publish (card) ────────────▶ published
                          └─ publish (with site) ─▶ submitted ─(human)─▶ published
   revoke, from ANY state ─▶ revoked   (nothing is served again)
```

**Hybrid approval policy**, decided from the stored `site_digest` column and
never from a request field:

- **Derived cards auto-publish.** Low risk, high volume, and the actual
  engine of the loop; a human queue would kill it. Recorded as
  `approved_by = 'auto:card'`.
- **Shares carrying a candidate-built site require a human.** They host
  arbitrary user-authored HTML on our origin, which is precisely spec §12's
  concern. `publishShare` stops them at `submitted`; only `approveShare`,
  which no candidate-reachable route calls, can stamp `approved_at` with a
  named human. Tested, including the "hostile client sends
  `status: published`" case.

## 4. Social preview

`og:image` is a real **PNG**, rendered by `next/og` (bundled with Next.js —
no new dependency, no network at render time) from
`apps/web/lib/shareCardArt.ts`. SVG was rejected: Facebook, X, LinkedIn and
Slack do not render SVG previews, and a paste with no preview does not
spread. The card's text comes from `shareCardLines` in `@ailx/report`, the
same function the page uses, so the preview cannot drift from the page. Its
colours are asserted equal to the `:root` tokens in `app/globals.css`.

## 5. Both builds

The share view is `app/s/[token]/page.api.tsx`. `.api.tsx` joins
`pageExtensions` only when `AILX_BACKEND=1`, so the page does not exist in the
GitHub Pages static export — the page twin of the long-standing
`route.api.ts` rule for API handlers. In the static demo `ShareLink` renders
nothing at all, so there is no button that cannot work.
`apps/web/test/serverOnlyPages.test.ts` fails the build if any file under
`app/` reaches server capability without an `.api.*` name.

## 6. Measuring the loop

One row per served view in `share_views`: a share id and a DATE. No IP, no
user agent, no referrer, no visitor id, no third-party analytics, no cookie.
That is enough to answer "does the loop work" and structurally incapable of
tracking a person. Metadata fetches (scrapers) do not count a view; rendering
the page for a human does.

## 7. Next slice — the public gallery

Additive on this foundation, not a rewrite:

1. A browse route over `share_links WHERE approved_at IS NOT NULL AND
   revoked_at IS NULL`, reading the same frozen payloads.
2. A candidate-facing "add to the gallery" control calling `publishShare`,
   and a reviewer surface calling `approveShare` (auth-gated to reviewers).
3. A "how is the world doing" page of honest AGGREGATES: participation
   counts, player-type distribution, track-shape distributions, completion
   rates, item exposure counts from `attempt_decks`. No percentiles or
   composites implying judged scoring while the judging pipeline (spec
   Phase 4) does not exist, and a minimum cohort size before any breakdown is
   shown so an aggregate can never re-identify one person.
