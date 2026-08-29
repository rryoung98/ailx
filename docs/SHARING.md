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

## 7. The public gallery

Shipped, additive on the state model above — no rewrite, no new share state.

### 7.1 What is listed

One predicate, defined once (`packages/backend/src/gallery.ts`):

```sql
approved_at IS NOT NULL AND revoked_at IS NULL
```

`unlisted` and `submitted` are not listed. `revoked` is never listed again.
Approval is still decided by `publishShare`/`approveShare` from the stored
`site_digest` column, so a card auto-publishes and a site waits for a human —
`/gallery` only reads the result.

**A gallery card carries no link back to `/s/<token>`.** The database stores
only `sha256(token)`, so no server can rebuild the capability URL. Each card
is self-contained: the frozen payload, plus the candidate's own site path when
they opted in. That is a property of the design, not a missing feature.

### 7.2 Reviewing — the simplest defensible gate

`AILX_REVIEWERS` is a comma/whitespace list of AuthProvider refs
(`clerk:<sub>` / `dev:<id>`), checked server-side by `withReviewer` on both the
`/review` page and `/api/gallery/review`. It fails closed (unset = nobody), a
`*` entry is dropped rather than read as "everyone", an anonymous caller gets
401 and a signed-in stranger 403 — and the page itself renders a 404, because
the queue holds sites nobody has vetted yet.

There is deliberately **no staff/roles table**. The product has exactly one
privileged verb; an RBAC system for one verb is the speculative complexity
`AGENTS.md` forbids. The seam if that changes is `isReviewer`.

Refusing a submission **revokes** it: the schema has no "rejected" stamp, and
the only reason to refuse a site-carrying share is the hosted bytes, so the
honest answer is to stop serving them. The row survives as the audit trail and
the candidate can create a new share without the site. (Known gap: the schema
records *who approved*, but not who refused.)

### 7.3 "How is the world doing" — `/world`

Distributions only, and only what is computable today: participation counts,
completion rate, player-type distribution, per-track decile histograms,
summarized item exposure and a weekly trend. Deliberately absent: percentiles,
composites, anything score-shaped. The judging pipeline (spec Phase 4) is not
built and `scores` is empty in practice, so publishing a judged-looking number
would be a claim we cannot back. Track values are the run's OWN scorers over
its mirrored event log, and the page says so.

Two data truths shape the implementation:

- `responses` mirrors the whole client session log, one row per LOG entry, so
  `item_id` and `latency_ms` are NULL. Track shape is read by projecting the
  stored payloads through `@ailx/session` `project()`, never from those
  columns.
- `attempt_decks` is the authoritative record of what an attempt was SHOWN.
  Exposure is aggregated **inside SQL**, so item ids never reach application
  memory — publishing per-item counts would publish the bank's inventory, for
  exactly the reason §1 keeps item detail out of a share payload.

**Re-identification guard.** `MIN_COHORT_SIZE = 10` (`@ailx/report`): a
breakdown is published only once ten complete runs are behind it, exposure is
gated on its own cohort of recorded decks, and the trend on started attempts.
Ten is the common cell-suppression floor in published education and health
statistics. Population totals (people, runs, completion rate) are always shown:
they describe everyone, so they name nobody. No cross-tabulation is offered,
and the serialized payload is asserted to contain no id, no item, no attempt
and no participant.

### 7.4 Both builds, again

`/gallery`, `/world` and `/review` are `page.api.tsx`: they read the database,
so they exist only under `AILX_BACKEND=1`. The static Pages export links the
T4 community wall at `/wall` instead — never a nav link the build cannot
serve. `apps/web/test/serverOnlyPages.test.ts` fails the build if any of them
is renamed, or if a route ever has both a `page.tsx` and a `page.api.tsx`.
