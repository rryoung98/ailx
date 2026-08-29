# SHARING — the growth loop

How a finished AILX run becomes something a candidate wants to send, and how
that stays safe. Companion to `AGENTS.md` (invariants) and `FRONTEND.md`
(module and security rules). Spec references are to `AILX-Spec-2026.1.md`.

## 1. What is shared, and what never is

A share carries the CARD, which every share has, plus the SECTIONS the
candidate switched on. All of it is built by one pure function
(`buildSharePayload`, `packages/report/src/share.ts`) and frozen into the row
at creation.

### The card — always present

| Field | Why it is safe |
|---|---|
| `playerType` (code, name, tagline, four poles) | A playful lens over four aggregate numbers. Never part of the score. |
| `tracks` — four 0-100 values | Track SHAPE, not item detail. |
| `band` | A quota band over the demo cohort, not a judged result. |

### The sections — per-section opt-in, default in brackets

| Section | Carries | Why it is safe |
|---|---|---|
| `profile` [on] | `strengths[]`, `watchouts[]` | Fixed strings selected by the four poles. A pure re-reading of numbers already in the card, so it adds no information at all. |
| `process` [on] | Per track: `activeSeconds`, `budgetSeconds`, `timedOut`, `iterationRatio`, `verificationEvents`; plus `totalActiveSeconds` | Describes the CANDIDATE's own behaviour, never the instrument. Time and budget are the candidate's clock; `iterationRatio` is a ratio of their own revise/regenerate actions per prompt; `verificationEvents` counts their own verify/challenge actions. None of it is per item, none of it is a correctness bit, and none of it varies with what the bank contains. |
| `completed` [on] | `completedOn`, a UTC day | One date, day-granular, derived from the log's last stamp — no clock is read (purity). |
| `site` [off] | The candidate's OWN built T1 site path | Their creative artifact. T1 has a public brief; sharing the build is the point of it. |
| `note` [off] | One line of the candidate's own words, ≤240 chars | Their words, flattened to a single line and length-capped. Escaped by React at render; a public listing needs a human. |

Deliberately NOT sections, and never serialized: item ids, item content, answer
keys, per-item correctness, confidence values, latencies, per-track event
COUNTS or verb histograms, T2 signal-detection internals (`dPrime`, `brier`,
`nSignal`, `nNoise`), the event log, the attempt id, the participant or auth
reference, locale, the composite number, the percentile.

Two of those need saying out loud. **Event counts and `nSignal`/`nNoise` are
excluded even though the report shows them**: a per-track event count tracks
deck length, and the signal/noise split is the deck's composition. Farmed
across many cards they would describe the bank's inventory, which is exactly
the leak §1 exists to prevent. A ratio and a wall-clock number do not.

### Enforcement — three layers, not one

1. The payload object: `sharePayloadFrom` writes `null` for every section the
   selection has off, even when the caller passed data for it.
2. The HTTP body: `createShare` re-normalizes the request through
   `parseShareSections` (own properties only, booleans only, unknown keys
   dropped) and rebuilds the payload from the stored log. A request cannot
   supply a payload, a site path, another attempt's digest or a status.
3. The rendered HTML: the share view and the gallery tile render from the
   frozen payload and nothing else.

All three are asserted, the payload as an EXACT serialized object with
forbidden-substring checks, in `packages/report/test/share.test.ts`,
`packages/backend/test/share.test.ts` and `apps/web/test/shareView.test.tsx`.

### Item-bank leakage — the conclusion

T2/T3/T4 items are the instrument. If item content or per-item outcomes could
be shared, an attacker could farm shared cards to reconstruct the bank, and
every future sitting would be invalid. So the payload is an ALLOWLIST, not a
redaction. Four aggregate track numbers cannot identify which items were drawn
(the deck is per-attempt and lives only in `attempt_decks`), cannot reveal an
answer key, and do not change with item content; neither can the candidate's
own clock. T1 is different in kind: it is an open build task with a public
brief, so the candidate's own built site is shareable — that is the point of
it. The boundary is therefore: **T1 artifacts and the candidate's own process
may be shared; T2/T3/T4 detail may not, at any layer.**

## 2. Private by default, recoverable by its owner, revocable for real

- Nothing exists until the candidate presses "Create a share link"
  (`apps/web/lib/ShareLink.tsx`). There is no default share.
- The link is an **unlisted capability URL**: 32 random bytes, base64url
  (`/s/<43 chars>`), `noindex`, `cache-control: no-store`.
- **The server stores the token.** This reverses the original design, which
  stored only `sha256(token)`.

### Why the token is stored — the trade, written down

Storing only the digest made a share link **unrecoverable**: a candidate who
cleared storage or opened the report on a second device could not re-copy
their own URL, the only remedy was revoke-and-recreate, and a published
gallery card could not link to the view it came from. Two of the three things
this product is for were blocked by it.

What storing the token actually costs: a database leak would yield working
capability URLs. What it does NOT cost:

- **Guessability is unchanged.** 32 CSPRNG bytes; no dictionary, no rate
  limit, and no observable difference between an unknown token and a revoked
  one.
- **Revocation still fully works.** Every public read filters on
  `PUBLICLY_SERVED` (`revoked_at IS NULL AND rejected_at IS NULL`), defined
  once in `packages/backend/src/share.ts` and composed by the gallery's own
  predicate. The page, the JSON route, the `og:image` and the gallery tile all
  stop together.
- **Ownership is still checked.** The token is returned only by owner-scoped
  reads, which go through `getAttempt(db, attemptId, participantId)` first, and
  by LISTED gallery entries, which their owner published on purpose. The
  anonymous `/api/share/:token` read never returns it.
- **The blast radius is the payload.** What a leaked link exposes is a player
  type, four aggregate numbers, a band and whatever sections the candidate
  chose — low-sensitivity by construction (§1), and already public to anyone
  they sent it to.

That is the deal: an unguessable, `noindex`, fully revocable capability over a
low-sensitivity payload, in exchange for a link the owner can actually get
back. If the payload ever stops being low-sensitivity, this decision has to be
reopened — that is the trigger to watch.

- Revocation stamps `revoked_at` and every read path filters on it, so the
  page, the JSON route and the `og:image` all 404 immediately — and 404
  identically to a token that never existed, so revocation is not observable.
- The row is never deleted. Re-sharing inserts a NEW row with a NEW token; the
  frozen payload is immutable, so CHANGING what a link shows is also a
  revoke-and-recreate.

## 3. Unlisted is not published

The spec's gallery governance ("approval-required, not takedown-based")
governs what becomes **publicly listed**. An unlisted capability URL is not
listed anywhere, is not indexed, and is only reachable by someone the
candidate handed it to — so it needs no per-asset human approval. That
distinction is deliberate and is enforced by the state model, not by UI copy.

### Lifecycle (all five states implemented; monotone stamps, never edits)

```
private (no row)
   └─ create ─▶ unlisted ─┬─ publish (card) ─────────────────▶ published
                          └─ publish (authored) ─▶ submitted ─┬─(human yes)─▶ published
                                                              └─(human no) ─▶ rejected
   revoke, from ANY state ─▶ revoked   (nothing is served again)
```

**Hybrid approval policy**, decided from the STORED payload and never from a
request field:

- **Derived cards auto-publish.** Low risk, high volume, and the actual
  engine of the loop; a human queue would kill it. Recorded as
  `approved_by = 'auto:card'`.
- **Shares carrying candidate-AUTHORED content require a human** — the built
  site (arbitrary HTML on our origin, precisely spec §12's concern) and the
  candidate's own note (escaped and capped, so not an XSS question, but still
  unvetted words on a public wall). `needsHumanApproval` reads the stored
  payload; `publishShare` stops them at `submitted`; only `approveShare`,
  which no candidate-reachable route calls, can stamp `approved_at` with a
  named human. Tested, including the "hostile client sends
  `status: published`" case.

## 4. Social preview

The share view renders the card plus a "What they chose to show" section that
appears only when at least one opt-in section is present. `og:image` is a real
**PNG**, rendered by `next/og` (bundled with Next.js —
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

**A gallery card links to its own `/s/<token>`.** The entry carries the token
and the tile links to the share view it came from. That is safe precisely
because the entry is LISTED: its owner published it, the view serves the same
frozen payload the tile already shows, and revoking (or refusing) kills both in
the same predicate. An unlisted, submitted or refused share is never returned
by anything in `gallery.ts`.

A `GalleryEntry` carries the whole frozen `payload` rather than re-copying
field by field, so a tile and a share view cannot disagree and a new opt-in
section needs no second allowlist to appear.

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

### 7.3 Refusing, on the record

Refusal used to revoke, which stopped the serving but recorded NOTHING: the
schema said who approved and never who refused, or why. That gap is closed.

`rejectSubmission` stamps three columns together — `rejected_at`,
`rejected_by` (the VERIFIED caller identity, never a body field) and
`reject_reason` — under a schema CHECK of all-three-or-none, plus a second
CHECK that approved and rejected are mutually exclusive. It is append-only in
the same sense as every other stamp here: a new monotone state, never a
destructive edit, and the row is never deleted.

A refusal is **terminal for that row**. It cannot be re-submitted (that would
let a candidate grind a reviewer down) and it cannot then be approved. It
fails `PUBLICLY_SERVED`, so the gallery, the share view and the OG image all
404 together.

It stays visible to its OWNER, though — the whole point of recording a reason
is that the candidate reads it. `ShareLink` surfaces the reason verbatim, and
never the reviewer's name, next to a revoke button: revoke, then create a new
link without the part that was refused.

The API refuses a reject with no reason (400) before it touches the row, and
the reason is whitespace-collapsed and capped at `REJECT_REASON_MAX` (500).

### 7.4 "How is the world doing" — `/world`

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

### 7.5 Both builds, again

`/gallery`, `/world` and `/review` are `page.api.tsx`: they read the database,
so they exist only under `AILX_BACKEND=1`. The static Pages export links the
T4 community wall at `/wall` instead — never a nav link the build cannot
serve. `apps/web/test/serverOnlyPages.test.ts` fails the build if any of them
is renamed, or if a route ever has both a `page.tsx` and a `page.api.tsx`.
