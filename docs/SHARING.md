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
| `playerType` (code, name, tagline, four poles) | A playful lens: ONE bit per track. Two of the four bits read the candidate's own process (was the T1 build revised, were T3 claims checked) rather than a score, so the card says a little about HOW the run went — never an exact figure, never an item, never a score. The precise process numbers stay behind the opt-in `process` section. |
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

**How the candidate reaches it.** `POST /api/attempts/:id/share/publish` —
owner-authenticated, and it takes NO BODY at all. That is the point: there is
nothing in the request for a hostile client to lie about, because the
auto/human split is read from the stored payload by `publishShare`. The
response returns the owner's view of the row, so the UI learns the DECISION
from the row rather than from what it asked for. `ShareLink`'s
`PublishControl` renders that decision, and imports the same
`needsHumanApproval` predicate to say in advance which of the two the
candidate is about to get — so the copy cannot promise what the server will
not do. A refused row is terminal (400), a revoked one has nothing to publish
(404), and revoking a published card removes it from the gallery in the same
`PUBLICLY_SERVED` predicate.

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

### 4.1 The share targets — where a link actually goes

A preview only matters once the link is somewhere. The report and the share
view both render `apps/web/components/ShareTargets.tsx`: the OS share sheet
(`navigator.share`, feature-detected after mount so the server and the client
render the same tree), X, LinkedIn, WhatsApp, and copy link as the fallback
that needs no app, no popup and no integration.

The WORDS are derived, once, in `packages/report/src/shareText.ts` — a pure
module over the frozen payload, so a share text can never say more than the
payload already allows (§1). Per network it is one message in three voices:
short for X (clamped to the 280 − 23 budget a t.co link leaves), a
credential-flavoured paragraph for LinkedIn, one casual line for WhatsApp.
Two rules hold across all of them:

- **No number.** No band, no track value, no percentile, no grade. The
  judging pipeline does not exist (§7.4), and a figure in a feed reads as
  certification whatever the caveat beside it says.
  `SHARE_TEXT_FORBIDDEN` makes that a test, not a habit.
- **The right person.** The report writes "mine"; the share view writes
  "theirs", because whoever holds a link may not be the person on the card.

No pixel, no beacon, no third-party script: the intents are plain links, and
the day-granular view row of §6 stays the only measurement.

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

### 7.6 Moderating out loud — notes, responses and appeals

The queue records WHAT was decided. `moderation_comments` records the
conversation around it, because "we refused this and here is one sentence" was
not enough to run a moderation practice on: the next moderator needs to know
what the last one saw, and the candidate needs somewhere to answer.

**One table, two audiences, one column that separates them.**

| | Internal note (`visibility = 'internal'`) | Message (`visibility = 'shared'`) |
|---|---|---|
| Written by | a moderator | a moderator, or the candidate |
| Seen by | AILX staff on `/review/<case>` | that candidate, and staff |
| Carries the author's identity | yes, the verified `author_ref` | **never** to the candidate |

A candidate cannot write an internal note at any layer: the API gives their
role `shared` unconditionally, the store re-checks it, and a schema CHECK
refuses the row. Internal notes are excluded **in SQL** from every
candidate-audience read (`listComments`, one predicate), and the
candidate-facing shape has no `author` or `visibility` field at all — leaking
the moderator's name would take adding a field, not forgetting a redaction.
That is the same posture as a refusal (§7.3): the reason is shown verbatim,
the human is not.

**Linear, not threaded.** A case has one conversation ordered by insertion.
Threading buys sub-discussions on a surface whose entire content is "one
site, one decision, usually two or three comments" — it would cost a parent
pointer, a render tree and a per-branch permission story for no question it
answers. If a case ever needs two arguments at once, the internal note is
where they go.

**Append-only, so the trail is evidence.** Every write is an INSERT. An edit
inserts a new row pointing at the one it replaces (`supersedes_id`, unique, so
a chain can never fork), and a retraction inserts an empty row the same way. A
moderator sees the whole chain, superseded rows struck through and kept; the
candidate sees the current state. Visibility is INHERITED on an edit: a
message the candidate already read cannot be edited into an internal note, and
an internal note cannot be quietly republished to them. Only the author can
replace their own words.

**The appeal, and why it does not reopen anything.** A refused candidate may
respond once. The response moves the CASE into the moderators' "answered back"
lane; it does not touch the ROW, which stays refused — `rejected_at` is never
cleared and `share_links_one_decision` makes an approval after a refusal
impossible. Turn-taking is enforced server-side: the candidate may write again
only after a moderator answers, which is the same anti-grinding rule that made
a refusal terminal in the first place. If the moderator agrees they were
wrong, the remedy is the one the state model already had — the candidate
revokes and creates a new share, which enters the queue normally. So an appeal
costs one lane and one predicate, and buys a documented right of reply without
a second decision state.

**Where it lives.** `/review` is the staff dashboard: the waiting queue (cards,
because you must LOOK at a site before approving it), the appeals lane and the
decision history (dense tables, because you read those). `/review/<share id>`
is one case: the card, the decision, the trail and the composer. Both are
`page.api.tsx` and both call `withReviewer` server-side, and both answer a
stranger with a 404 page; the API twins (`/api/moderation/<id>`, and
`/api/attempts/<id>/moderation` for the candidate's own case) answer 401/403.
The candidate's half is resolved from the ATTEMPT they own, so there is no
case id for anyone to guess.

**One leak closed on the way past.** The owner's own read of their share used
to return `rejectedBy` and `approvedBy` — the reviewer's identity, to the
person they had just refused. `ownerShareView` drops both, and the public
gallery listing drops `approvedBy` for the same reason.

## 8. The daily challenge grid

The daily (`/daily`, `packages/report/src/daily.ts`) is the second thing this
product asks people to paste in public, and it is the riskier of the two: a
share card describes its owner, but a daily result describes an ITEM SET that
other people have not played yet. So the rule is narrower than §1's.

### What the grid is, and what it cannot be

One glyph per card, in the order the cards were dealt:

| Glyph | Meaning |
|---|---|
| 🟩 | called it |
| 🟥 | missed it |
| ⬜ | never called — the picture did not load |

`dailyGrid` takes a vector of `hit | miss | skip` and NOTHING else. It never
sees an item, a key, a choice, a family or a difficulty, so it cannot encode
one. That is a type-level guarantee, and it is also mutation-tested
(`packages/report/test/daily.test.ts`): flip every key in the pool and the grid
for a given result vector is byte-identical, and for every grid a day can
produce, BOTH keys stay consistent at every position — seeing a published grid
narrows nothing about the answers.

A fourth glyph is the thing to refuse. "🟦 for a correct AI call" reads as a
harmless flourish and publishes the day's key to everyone who has not played,
because a grid plus one poster's answers is the whole answer sheet. The test
fails on it rather than a reviewer having to notice.

The ORDER is deliberately kept. The day's deck is the same for everybody, so
the position of a glyph is public knowledge already, and "we both missed the
third one" is the conversation the feature exists for.

Colour is never the only cue: `dailyShareText` always prints the tally in
words beside the grid, and the glyphs are the oldest, widest-supported block
emoji, so X, LinkedIn, WhatsApp and a plain SMS all render them without an
image or a font.

### What the words may say

`dailyShareText` (in `shareText.ts`, with the rest of the share copy, so the
honesty rules are asserted over it too) may carry the puzzle number, the grid,
the tally and the streak. It may not carry a percentile, a rank, a cohort
position or any suggestion that a streak is evidence of a better eye —
`SHARE_TEXT_FORBIDDEN` and `efficacyClaims.test.ts` are both run over every
string it can emit, and `dailyShareLeaks` is run over the rendered result view
and every share link in `apps/web/test/dailyChallenge.test.tsx`.

### Why this is not exam security

The daily deals from PUBLISHED content: the released-practice tier, whose keys
are public on purpose, and the practice corpus. A determined reader can open
the bundle and read the keys. The grid guard protects the READ — what somebody
sees in a feed before they have played — which is the only thing that can
actually be spoiled here. The operational bank is in another repository and no
browser ever holds it (`AGENTS.md`, "The repository split").

### The day, and the timezone

The deck is a pure function of (calendar day, pool), and the day is the
PLAYER'S OWN local calendar day — the same `localDay` the practice streak uses.
So the puzzle turns over at local midnight, everyone on the same date gets the
same five cards, and no server round trip is needed to agree on what today is.
The cost is written down rather than hidden: two people in different zones get
"today" at different instants, and somebody who flies east may meet the next
puzzle early. That is Wordle's rule and the one people expect; a UTC rollover
would reset the puzzle in the middle of the evening for half the planet.

Nothing about the daily touches a sitting: no answer reaches `score()`, a
report figure or a credential, and there is no ranking of one player against
another. It is a game on published material, and the page says so.
