# ADR: a durable profile, and the player type attached to it

Status: **proposed — schema and endpoints specified, nothing implemented.** No
product code lands on this branch; the only file it adds is this one.
Date: 2026-09-06. Branch: `w/profile-type`. Issue: TEN-178.
Amended the same day by the founder: a type CHANGES OVER TIME (§7).
Yardstick: `docs/ADR-orpc.md` and `docs/ADR-redis.md` — a number before a
preference, and where a number could not be taken this document says so.
Reviewed against `docs/SHARING.md`, `docs/SAMPLING.md` §2/§3/§11,
`docs/CREDENTIAL.md`, `docs/RENAME.md` §2, and `docs/SHAPE.md` (branch
`w/product-shape`, PR #48).

codex review skipped: usage limit.

## 1. The question

The founder's words: *"every user who signs in has a profile attached, and when
they complete the assessment we attach their MBTI to their profile. We want to
filter people through the gallery/forum to see how people are prompting based
on their MBTI."*

Three things are being asked for, and they have different costs:

1. a durable per-person record, created for everyone who signs in;
2. the player type attached to it when a sitting finishes;
3. a gallery filter over that type;
4. and, added by the founder while this was being written: **a type that changes
   over time**, stored as a history of typed runs rather than one value that is
   overwritten, with "current" derived on read.

Two and three collide with a measurement this repo already took. Section 3 is
that collision. This document does not refuse the feature; it changes the unit
the feature is built out of. Four is §7, and it makes the collision smaller
without removing it.

## 2. What already exists — read from the code, not from a diagram

| thing | where | state |
|---|---|---|
| the player type | `packages/report/src/playerType.ts` | **built**. Four axes, one per track, each `Pole` carrying `letter`, `high`, `strength` (50–100) and `evidence` (the measured quantity in words) |
| axis decision rule | same file, `identitySignals` / `playerType` | **built**. T1 iteration ratio, T2 sensitivity, T3 verification events; a track with no recorded behaviour falls back to its score against the demo-cohort median |
| the sixteen names | same file, `NAMES` | **built** |
| the gallery | `apps/web/features/gallery/GalleryView.tsx`, `app/gallery/page.api.tsx` | **live**. Client component, fetches `apiBase()/gallery`, renders type chips with facet counts |
| `?type=MSVD` | `packages/contract/src/gallery.ts`, `PLAYER_TYPE_CODE_RE` | **shipped**. `/^[MP][ST][VA][DE]$/`, strict, a bad value is a 400 |
| the share payload's type | `packages/report/src/share.ts`, `SharePole` | **built, and lossy** — see below |
| a profile | — | **does not exist**, in either repo |
| the forum | — | **does not exist** |
| a completed sitting | — | **impossible today**, TEN-149 |

**The one measured gap inside what exists.** `SharePole` is
`{ track, letter, label, high }`. `Pole.strength` and `Pole.evidence` are
computed and then **dropped** on the way into the stored share payload
(`share.ts`, `sharePayloadFrom`). So every card in the gallery today renders a
letter with no indication of how firmly it was decided, and the store holds no
number to filter or sort on. Fixing that is a share-payload version bump, not a
new subsystem. It is step 2 of the plan.

Identity today: the exam service keys people by `participants.auth_ref`, a
provider-scoped string (`clerk:<sub>` or `dev:<id>`), `UNIQUE`, resolved on
every authenticated request by `ensureParticipant` — **2 Postgres round trips**
(`docs/ADR-redis.md` §3.3, which also carries the one-statement replacement).

## 3. The tension, with the numbers that cause it

A filter is a hard bucket. `?type=INTJ` puts a person in one of sixteen boxes.
`/Users/rickyyoung/GitHub/foray-research-virality.md` §6 measured our own boxes
by running `demoCohortRows()` and `cohortMedians()` from the built
`@ailx/report`:

| track | cohort SD | within 0.10 SD of the cut | within 0.25 SD |
|---|---|---|---|
| t1 | 29.75 | 5 of 44 (11.4%) | 10 of 44 (22.7%) |
| t2 | 16.23 | 5 of 44 (11.4%) | 9 of 44 (20.5%) |
| t3 | 34.89 | 4 of 44 (9.1%) | 10 of 44 (22.7%) |
| t4 | 21.08 | 3 of 44 (6.8%) | 9 of 44 (20.5%) |

> "Treating the four axes as independent, **62.2% of that cohort has at least
> one of its four letters sitting within a quarter of a standard deviation of
> its own cutline.** A third (33.4%) has a letter within a tenth of an SD.
> Those letters are coin flips."

And our position is worse than MBTI's on two counts, per the same section: the
cutlines come from a cohort of **44**, and each axis is read from **one run**
rather than a multi-item scale. The precedent numbers for reruns: McCarley &
Carskadon (1983), 50% classified differently on at least one scale at five-week
retest; the MBTI Manual (Myers et al. 1998) concedes 35% get a different
four-letter type after four weeks.

So the honest statement is: **for roughly two thirds of people, at least one
letter of their code could move on a rerun without the person changing at all.**

A filter built on the code alone would assert the opposite. It would say "these
are the MSVD people" and mean it.

## 4. The decision: the axis is the unit, the code is a rendering

Four decisions, together.

**4.1 Store the four axes, derive the code on read.** The stored object is an
array of up to four axis readings, each with `track`, `high`, `strength` and
`evidence`. The four-letter code is computed from them, never stored as the
thing that is true. This is the same rule the rest of the repo already follows:
`docs/CREDENTIAL.md` §2 — "the stored row is a FROZEN claim; the served document
is DERIVED from it at read time".

*Rejected:* a `profiles.player_type char(4)` column. It is one join cheaper and
it throws away the only information that makes the number defensible. It also
cannot answer "how firmly", which is the question a critic asks first.

**4.2 An axis under a strength threshold is UNDECIDED, and renders as one.**
Research §6: "A letter decided at 51 should be rendered as undecided, not as a
letter."

The threshold is derived, not chosen. On the fallback path,
`strength = 50 + (score − median) / 2`, so a distance of 0.25 SD maps to:

| track | strength at 0.25 SD | at 0.10 SD |
|---|---|---|
| t1 | 53.7 | 51.5 |
| t2 | 52.0 | 50.8 |
| t3 | 54.4 | 51.7 |
| t4 | 52.6 | 51.0 |

**`strength < 55` covers 0.25 SD on all four tracks** (the largest is t3 at
54.4), with one number instead of four. That is the threshold:
`POLE_UNDECIDED_STRENGTH = 55`, exported from `packages/report`.

*Honest caveat, stated here and not buried in §14:* this mapping is exact only
for the cohort-median fallback path. For the two behaviour-derived axes (T1
iteration ratio, T3 verification events) `strength` is a saturation meter, not
an SD map, so 55 there is a display convention, not a measurement. The
threshold is one number because two would be a false precision on a cohort of
44.

**4.3 An undecided axis matches BOTH sides of its filter.** A person whose T2
sits at strength 51 appears under `t2:S` and under `t2:T`. They are not being
placed twice; they are being placed honestly once, in the two places the
measurement cannot separate. The card says so — see 4.4.

*Rejected:* dropping undecided people from both sides. That makes the filter
lie by omission and quietly deletes about a fifth of the wall per axis.
*Rejected:* a third letter (`M?VD`). Sixteen codes become eighty-one, the
`NAMES` table has no entry, and `PLAYER_TYPE_CODE_RE` — already shipped and
already parsed by browsers — would have to change meaning.

**4.4 Strength is on the card.** "Barely" and "strongly" must not look
identical. Each pole renders its letter, a meter, and its `evidence` string;
an undecided pole renders as `S/T` with the word "coin-flip" and the retest
sentence research §6 asked for: *this reads one run, and a run near a cutline
can come out the other way next time.* This requires the payload bump in §12.4.

**4.5 Filter by axis first, by code second.** `?axis=t2:S` is the primary
spelling and the one the chips use. `?type=MSVD` stays, unchanged and still
strict, because it is already shipped and is a shareable link somebody may
hold — but it is matched through the same axis machinery, so an undecided
letter matches both codes.

## 5. What a profile is, and when one is created

**A profile is the durable half of a person.** `participants` is the *login*:
it is keyed by `auth_ref`, it is provider-scoped, and `docs/RENAME.md` I3 says
plainly what happens to it at the coming Clerk development→production cutover:

> "A different Clerk instance mints different `sub` values, and
> `participants.auth_ref` is `clerk:<sub>` UNIQUE. Every existing participant is
> orphaned from their attempts, sittings and credentials. There is no undo that
> re-links them."

**Decision: the profile does not duplicate `participants`; it is a 1:1 child of
it, and it owns a `person_key` that no provider mints.** `participants` keeps
being the login row and the foreign key everything already points at. The
profile adds exactly two things `participants` cannot have: an identity of our
own, and a place to hang readings.

**Decision: created EAGERLY, at first authenticated request, inside
`ensureParticipant`.** Not lazily at first write.

Reasons, in order:
1. "Every signed-in person has a profile" must be true for a *reader*, not just
   for a writer. A lazy profile makes `GET /v1/profile` return 404 for a person
   who has signed in, which is the bug the founder's sentence is trying to
   prevent.
2. It costs **zero extra round trips** if it lands in the same statement.
   `ensureParticipant` is 2 round trips today and `docs/ADR-redis.md` §8 step 1 already
   recommends collapsing it to 1. Do that collapse first, then extend the CTE
   with a second `INSERT ... ON CONFLICT DO NOTHING`. A lazy profile would add a
   third round trip on the write path instead.
3. A profile row created at first sign-in gives `created_at` a meaning — "first
   seen" — that no later event can reconstruct.

**What it holds:** the `person_key`, `created_at`, a display name the person
chose or `null`, a locale, a `type_visibility` flag (§8), and a pointer to the
current type reading. It holds **no** score, no composite, no percentile, no
band, no auth_ref copy, and no email address.

**Surviving the Clerk cutover.** `profile_identities` is a second table:
`(participant_id, auth_ref, provider, linked_at, verified_email_hash)`. One row
per login that has ever resolved to this profile. At the cutover, a new
`clerk:<sub>` from the production instance can be linked to the existing
profile by matching a verified-email hash recorded under the old instance, and
the link is an append-only audit row.

Be exact about what this does and does not fix. It **does not** fix RENAME I3.
Attempts, sittings and credentials point at `participants.id`, and this design
does not move them. What it does is stop the *profile* — the type, the display
name, the day the person first arrived — from dying with the `auth_ref`, and it
puts the link table in place before the cutover instead of after it, which is
the only time it is cheap. The full migration is FOUNDER work, §12.7 step F2.

Emails are stored as `sha256(pepper || lower(email))` with the pepper in Secret
Manager, never as plaintext. Honest limit: an email address is low-entropy, so
this hash protects against a database read and not against a pepper leak.

## 6. What attaches the type, and when

**The founder's phrase is "when they complete the assessment". Nobody can.**
TEN-149, measured on staging 2026-09-05 from a fresh Clerk account: the start
pill on `/exam` renders `aria-disabled="true"` with the label "Connect a model
to start"; the gate is per-run, so it also closes T2 and T3, which need no
model; `attempts` gained 0 rows that night and the last row is 2026-08-30. No
score of record has ever been issued (`docs/POSITIONING.md`).

So the design has to say what the *other* people get, and the answer must not
pretend.

**6.1 A completed sitting → a full reading.** Four axes, a code, a character
name. Written **server-side at score time**, by the same `playerTypeFor` call
the report uses, into an append-only `profile_type_readings` row. Never posted
by a browser: a client-asserted type is a client-asserted score-adjacent claim,
and the repo's rule is that evidence is stored, not asserted.

**6.2 A partial sitting → a partial reading, and it is a different object.**
Once TEN-149 is fixed by letting the model-free tracks start (option (a) in that
issue), a person can finish T2 and T3 and nothing else. They get a reading with
**two** axes, `axis_count = 2`, **no code**, and **no character name**. A code
requires four letters; inventing the other two from a median of nothing is
exactly the "silence is evidence of the low pole" mistake `playerType.ts` was
written to avoid. A partial reading is filterable **by axis** and is invisible
to `?type=` — which is the whole payoff of making the axis the unit.

**6.3 Practice and the daily → no type at all. Not provisional, none.** This is
the hard call and it is deliberate.

- Practice draws from a **separate corpus** with a hard separation from the
  scored bank, asserted by three tests (`packages/report/src/practice.ts`
  header). It is unscored by spec §13.
- The T2 axis is defined from `t2raw.sensitivity` — points awarded by the T2
  *scorer*, against `T2_SENSITIVITY_POINTS = 60`. A practice deck produces no
  such quantity. A "practice T2 axis" would be a different measurement wearing
  the same letter, which is precisely the `personality.ts` letter-collision that
  the current file header records as removed and does not want back.

What a practice-and-daily-only person gets is therefore: a profile that exists,
their days and streak, and `type: null` with `typeState: "none"` and one honest
sentence — *your type comes from a sitting; the daily does not produce one.*
Not a grey box implying a type is loading.

**6.4 One run is one reading.** Every typed run appends a reading; a reading is
never overwritten. Which of them counts as "current", and why that is a derived
answer rather than a stored one, is §7 — the section this brief's second half is
about.

## 7. A type is a history, not a value

The founder is explicit: **a person's type changes over time, and the design
must assume it.** So the stored object is not "this person's type". It is
"every typed run this person has had", and "current" is computed from that on
read.

### 7.1 What is stored: every typed run, appended, never overwritten

One row per typed run in `profile_type_readings` (§12.1): the run id, the axes
with their `strength` and `evidence`, the stamp, and `axis_count` — how many
tracks the reading was built from, because a two-axis reading and a four-axis
reading are not the same object (§6.2).

Nothing is ever updated in place. This is the house rule, not a new one:
`responses` and `transcripts` are append-only and a re-score is an insert
linked by `superseded_by` (root `AGENTS.md`). A re-score of the *same* run
therefore inserts a new reading and stamps `superseded_by` on the old one; a
*new* run inserts a reading that supersedes nothing. The two cases must stay
distinguishable, because one is a correction and the other is a person moving.

A type that silently overwrote its predecessor would destroy the only evidence
that anybody moved — which is the most interesting fact this feature can hold.

### 7.2 How "current" is derived: the last three runs, and it says when they disagree

**Decision.** `currentType(readings)` is a pure function in `packages/report`:

- **fewer than 3 full readings** → the most recent full reading, unchanged.
- **3 or more** → per axis, the mean position across the **last 3 full
  readings**. Position is recovered from the stored pole
  (`value = high ? strength/100 : 1 − strength/100`), averaged, and turned back
  into a letter and a strength by the existing rule. The `evidence` shown is the
  most recent run's string, with the count: *"read from your last 3 runs"*.
- if the most recent reading **disagrees** with that mean on an axis, the axis is
  flagged `moving` and rendered as undecided (§4.2), whatever its strength.

**Why not the single most recent run.** It is the noisiest possible estimator
for exactly the people §3 measured. Averaging 3 readings that differ only by
noise shrinks the standard error by `1/√3 = 0.577`, so the band that carries the
same flip risk narrows from 0.25 SD to **0.144 SD**.

Measured in session against `demoCohortRows()` (N = 44; sample SD, `n − 1`, so
these run a shade above the memo's figures):

| band | people within it, per track | at least one of four |
|---|---|---|
| 0.10 SD | 5, 5, 4, 3 | 33.4% |
| **0.144 SD** | 6, 6, 6, 6 | **44.4%** |
| 0.25 SD | 10, 10, 10, 9 | 63.3% |

So three runs take the fragile share from about 63% to about 44%. **It helps and
it does not fix it**, which is why the undecided band of §4.2 survives smoothing
rather than being replaced by it.

**Why not a longer or weighted window.** A decayed weighting over all runs is
steadier still and cannot be said in one line on a card. "Your last three runs"
can. Three is also the smallest window that produces the shrink above, and the
number of people with even two runs today is **zero** (§13), so anything more
elaborate would be tuned against no data.

**What the mean costs, said plainly.** A genuine change takes two runs to show
up in the letter, so the mean **lags**. The `moving` flag is the whole
mitigation: the run that disagrees is visible immediately, as an undecided axis
plus the sentence, rather than being averaged into silence. If the lag turns out
to matter more than the noise, §13 carries the flip.

### 7.3 What the filter matches: a card, not a person

The gallery lists **shares**, and a share is a snapshot of **one run** (§8). So
the filter's semantics are neither "current" nor "ever held":

> **`?axis=` matches the run each card was published from.**

That is the only reading that cannot go stale, because the card is a frozen
payload the person chose to publish. It has two consequences and the page states
both:

- the same person can appear under two different letters from two different
  runs, and that is correct, not a duplicate;
- a person's *current* derived type (§7.2) can differ from the type on their own
  published card, and neither is wrong — the card says which run it was.

The gallery header therefore says **"Filtering cards, not people. A card is one
run."** and every count is a count of cards. `?held=ever` and
`?held=current` were considered and are **400** — a wall of frozen snapshots has
no "current", and offering the word would promise a person-level index this
design refuses to build (§11.4).

### 7.4 What the person sees, and what stays private

`GET /v1/profile` returns the owner's own history: the last 20 readings, the
derived current type, and per-axis movement (`moving`, and the letter each axis
held in the previous full reading). Nobody else can read it. **Nothing about
history is public by default**, and a share payload carries **no history at
all** — it is one run's card, exactly as it is today.

Movement is worth showing to its owner, and it is honest in a way a static code
is not: *"your verification axis read V, then A, across your last three runs"*
is a fact about behaviour, with the `evidence` string under it. That sentence is
descriptive and must stay descriptive — see §11 item 8.

Publishing history is not in scope and would need its own opt-in, because
`docs/SHARING.md` §2 allows no default share.

## 8. What is public

**Default: private. Nothing in this design makes anything public that is not
public today.**

`docs/SHARING.md` §2: "Nothing exists until the candidate presses 'Create a
share link'... There is no default share." A profile that quietly published a
type would break that in one release.

**Decision: the gallery lists SHARES, not profiles.** The type the gallery
filters on is the type inside a published share payload — the row the person
created on purpose and can revoke. The profile's own copy of the reading is
private and is read only by its owner, through `GET /v1/profile`.

Consequences, spelled out so nobody re-decides them:

- The filter can see: published share payloads only. The predicate stays
  `approved_at IS NOT NULL AND revoked_at IS NULL`, composed from
  `PUBLICLY_SERVED` in `packages/backend/src/share.ts` — **composed, not
  re-implemented** (`docs/SHARING.md` §7.1).
- The filter cannot see: any profile, any unpublished reading, any partial
  reading that was not published, any person who never published.
- A revoked share leaves the filter at once, exactly as it leaves everything
  else. There is no second cache of types to forget.
- There is **no second opt-in switch**. `profiles.type_visibility` exists,
  defaults to `private`, and today governs nothing that is served. It is there
  so a future profile page cannot be built without one; it does not turn the
  gallery on.
- `noindex` stays on every surface that names a person
  (`docs/CREDENTIAL.md` §4). A filterable, indexable directory of candidates is
  the thing that document already refused.
- Facet counts count **published cards**, each of which is individually visible
  already, so no small-cell suppression applies to them. The reporting floor
  (`MIN_COHORT_SIZE = 10`, `docs/SAMPLING.md` §3 S6) applies to any *aggregate*
  derived from types — "MSVD people verify more" — and this ADR specifies no
  such aggregate. `/world` owns that question and states that "no
  cross-tabulation is offered".
- Every response carrying counts carries `population: null` and a `basis`
  string (`docs/SAMPLING.md` §3 S4). A per-type count is a statement about
  people who chose to publish a card, and about nobody else.

## 9. The filter contract

Lives in `packages/contract/src/gallery.ts`. Strict: **reject a bad query, never
normalise it** — the rule TEN-107 wrote after `?limit=1e9` came back as 1 under
a 200.

### 8.1 Exact spelling

```
GET /v1/gallery?axis=t1:M,t2:S&sort=recent
```

`axis` — **one key, one comma-separated list.** Not a repeated key: the
frontend's `firstValues()` in `apps/web/lib/data/serviceFetch.ts` keeps only the
first value of a repeated parameter, so a repeated `axis=` would silently lose
filters at the seam. One list also makes the URL canonical, which matters for a
link somebody shares.

Grammar, and everything outside it is HTTP 400:

```
axis      := entry ("," entry){0,3}
entry     := track ":" letter
track     := "t1" | "t2" | "t3" | "t4"
letter    := the two letters of THAT track's axis, uppercase:
             t1 → M | P     t2 → S | T     t3 → V | A     t4 → D | E
```

- Tracks must be in **ascending order** (`t1` before `t2` …). `?axis=t2:S,t1:M`
  is a 400, not a re-sort — two spellings of one filter is how a browser grows
  a private vocabulary.
- A track may appear **at most once**. `?axis=t1:M,t1:P` is a 400, not a union.
- Letter must match its track. `?axis=t1:S` is a 400.
- Empty value, trailing comma, whitespace, lowercase letter, unknown track: 400.
- Entries are **AND**ed.

`type` — unchanged: `/^[MP][ST][VA][DE]$/`, 400 otherwise.

**`type` and `axis` together → 400.** They are two spellings of the same filter
and accepting both invites them to disagree.

`decided` — `decided=1` only. When present, an **undecided** axis (strength
< 55, or strength absent) does not match; the default is the inclusive
both-sides rule of §4.3. `decided=1` without `type` or `axis` is a 400, because
it would silently mean nothing. `decided=0` is a 400 — the default is written by
omitting the key, the same rule `galleryQueryString` already follows.

`held` — **any value is a 400**, including `held=current` and `held=ever`. The
filter matches the run a card was published from (§7.3); a wall of frozen
snapshots has no "current", and the key would promise a person-level index this
design does not build.

Unknown keys are still **ignored**, deliberately: a gallery link with
`?utm_source=` on the end must still open the gallery (existing comment in
`gallery.ts`). `held` is the one exception, and it is named in the parser
precisely because it is a plausible spelling somebody will try.

### 8.2 Sketch of the contract types

Not exported by this PR; this is the shape the implementing PR writes.

```ts
export const AXIS_LETTERS = {
  t1: ["M", "P"], t2: ["S", "T"], t3: ["V", "A"], t4: ["D", "E"],
} as const;

/** null = this track is not being filtered on. */
export type AxisFilter = { [K in TrackId]: string | null };

export const galleryQuerySchema = z.strictObject({
  type: z.string().regex(PLAYER_TYPE_CODE_RE).nullable(),
  axis: axisFilterSchema,          // all-null when absent
  decided: z.boolean(),            // default false
  sort: z.enum(GALLERY_SORTS),
  withSite: z.boolean(),
  limit: z.number().int().min(1).max(GALLERY_MAX_PAGE_SIZE),
  offset: z.number().int().min(0),
});

/** Facets gain a per-axis form, so a chip is never a dead option. */
export const galleryAxisFacetSchema = z.strictObject({
  track: z.enum(TRACK_IDS),
  letter: z.string().length(1),
  label: z.string().min(1),
  count: z.number().int().nonnegative(),
  /** Of `count`, how many matched only because the axis is undecided. */
  undecided: z.number().int().nonnegative(),
});
```

`galleryQueryString` writes `axis` in ascending track order and omits it when
every track is null, so the round-trip test in
`packages/contract/test/shapes.test.ts` still closes the loop.

### 8.3 What an empty result means, and how the page says it

Three different facts, three different sentences — the distinction
`GalleryView.tsx` already makes and must keep:

| situation | what the page says |
|---|---|
| the query does not parse | the existing `BAD_QUERY_COPY`; **no request is made** |
| nothing published at all (`facets` sum to 0) | the existing "Nobody has published a card yet, so this wall is empty rather than broken." |
| filter matched nothing (`total = 0`, facets non-empty) | the existing "No published card matches this filter." plus, when `decided=1` was on: "Turn off *decided only* to include cards where this letter was a coin flip." |
| the read failed | the existing `serviceRefusedCopy` — never "nobody has published yet", which would be a lie about other people's work |

An empty result is never an outage and is never reported as one. And a chip is
only rendered when its facet count is above zero, which is why facets are
per-axis rather than computed in the browser.

The filtered wall also carries one fixed line, because §7.3 is not obvious:
**"Filtering cards, not people. A card is one run, and the same person can
appear under two types from two runs."**

## 10. The forum

**It does not exist, and this design does not assume it.** No table, no
endpoint and no wire type here is for a forum. The founder's sentence says
"gallery/forum"; what is specified is the gallery.

What the design does do is make a forum cheaper if it is ever built: the axis
filter is a property of a *published share*, so a forum post could carry the
same axis columns without a second definition of what a type is. That is a
consequence, not a plan, and nothing in §12 builds toward it.

## 11. Never-trade list

This feature may never:

1. **Rank people.** No leaderboard, no percentile, no "top N%", no ordering of
   one person against another. `docs/SHARING.md` §8: "there is no ranking of one
   player against another."
2. **Feed a score of record.** No reading, axis or strength may reach `score()`,
   a composite, a band or a credential claim. The type is display, and
   `score()` is pure.
3. **Publish anything the person did not choose to publish.** The default is
   private, and the only public copy of a type is inside a share the person
   created and can revoke.
4. **Become a directory of candidates.** `noindex` stays; no endpoint lists
   people, only published cards.
5. **Widen the credential.** `docs/CREDENTIAL.md` §1 — a credential asserts a
   completed sitting. A profile may not assert more than the sitting did.
6. **Turn a type count into a population statement.** `docs/SAMPLING.md` §2 —
   no Track A figure may be trended or percentiled as a statement about anyone
   larger than "people who chose to sit Foray". The words "national" and
   "representative" are not used about it, ever.
7. **Show a letter as certain when it is not.** An axis under strength 55
   renders as undecided everywhere it is named.
8. **Present movement as improvement.** An axis that moved is a description of
   how a run was played, not a ladder. No "improved", "progress", "levelled up",
   "growth" or arrow-up next to an axis change; no ordering of a person against
   their past self as if one letter beat another. The register is the one
   `DAILY_STREAK_MEANING` already uses, and it is testable the same way
   `SHARE_TEXT_FORBIDDEN` is.

## 12. Implementation plan

Marked by repo. **No store code lands in this public repo** — the handlers, the
store and the migrations live in the private `rryoung98/ailx-backend`
(`packages/core/test/frontendOnly.test.ts` fails the build otherwise).

### 11.1 PRIVATE repo — tables

```sql
-- 1:1 with participants. Created eagerly, inside ensureParticipant.
CREATE TABLE profiles (
  participant_id     uuid PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  person_key         uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  display_name       text,                       -- chosen, nullable, never derived
  locale             text NOT NULL DEFAULT 'en',
  type_visibility    text NOT NULL DEFAULT 'private'
                       CHECK (type_visibility IN ('private','gallery')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- every login that has ever resolved to this profile. Append-only.
CREATE TABLE profile_identities (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id       uuid NOT NULL REFERENCES profiles(participant_id) ON DELETE CASCADE,
  auth_ref             text NOT NULL UNIQUE,     -- 'clerk:<sub>' | 'dev:<id>'
  provider             text NOT NULL,
  verified_email_hash  bytea,                    -- sha256(pepper || lower(email))
  linked_at            timestamptz NOT NULL DEFAULT now(),
  linked_by            text NOT NULL             -- 'auth:first-seen' | 'migration:clerk-prod' | a human ref
);
CREATE INDEX ON profile_identities (verified_email_hash) WHERE verified_email_hash IS NOT NULL;

-- append-only. A re-score inserts; nothing is updated in place.
CREATE TABLE profile_type_readings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES profiles(participant_id) ON DELETE CASCADE,
  source         text NOT NULL CHECK (source IN ('sitting')),   -- widened only by a new ADR
  source_ref     uuid NOT NULL,                                 -- attempts.id
  instrument     text NOT NULL,
  axes           jsonb NOT NULL,   -- [{track,high,strength,evidence}], 1..4 entries
  axis_count     smallint NOT NULL CHECK (axis_count BETWEEN 1 AND 4),
  -- a RE-SCORE of the same run supersedes; a NEW run supersedes nothing.
  -- Keeping the two apart is what makes "this person moved" answerable.
  superseded_by  uuid REFERENCES profile_type_readings(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- the history read of §7.2: latest N live readings for one person.
CREATE INDEX ON profile_type_readings (participant_id, created_at DESC)
  WHERE superseded_by IS NULL;
```

`source` is `CHECK (source IN ('sitting'))` on purpose: §6.3 decided practice
and the daily produce no reading, and a one-value CHECK makes that decision a
constraint rather than a comment. Widening it is a new ADR.

Shares gain derived, indexed axis columns, written at publish time **from the
stored payload** and never from a request field (the rule `docs/SHARING.md` §3
already applies to `site_digest`):

```sql
ALTER TABLE shares
  ADD COLUMN axis_t1 char(1), ADD COLUMN axis_t1_strength smallint,
  ADD COLUMN axis_t2 char(1), ADD COLUMN axis_t2_strength smallint,
  ADD COLUMN axis_t3 char(1), ADD COLUMN axis_t3_strength smallint,
  ADD COLUMN axis_t4 char(1), ADD COLUMN axis_t4_strength smallint;
CREATE INDEX ON shares (axis_t1, axis_t2, axis_t3, axis_t4)
  WHERE approved_at IS NOT NULL AND revoked_at IS NULL;
```

Backfill: letters from existing payloads, **strengths NULL** — a v1/v2 payload
never carried one (§2). A NULL strength is treated as undecided, so an old card
matches both sides and renders no meter. That is the truthful reading: we do
not know how firmly that letter was decided.

### 11.2 PRIVATE repo — endpoints

| route | auth | body |
|---|---|---|
| `GET /v1/profile` | required | the caller's own profile: `personKey`, `displayName`, `createdAt`, `typeVisibility`, `current`: `null` or `{ axes, code \| null, name \| null, partial, movingAxes, runCount, at }`, and `readings`: the last 20 live readings, newest first (§7.4) |
| `PATCH /v1/profile` | required | `{ displayName?, typeVisibility? }`. No other field is writable; a type can never be set by a request |
| `GET /v1/gallery` | as today | extended with `axis`, `decided`, and per-axis facets |

No new public route. No route returns another person's profile. `auth_ref` is
never serialized (`docs/SHARING.md` §1, §7.2).

The reading is written inside the existing score path, not by an endpoint.

### 11.3 PUBLIC repo — `packages/contract`

- `gallery.ts`: `AXIS_LETTERS`, `axisFilterSchema`, `galleryAxisFacetSchema`,
  the `axis`/`decided` parse and write rules of §9, the `type`+`axis` conflict.
- new `profile.ts`: `profileSchema`, `axisReadingSchema`, `typeStateSchema`
  (`"none" | "partial" | "full"`), added to `API_RESPONSE_SCHEMAS`.
- tests: round-trip every legal `axis` spelling, and one test per 400 rule in
  §9.1 — ordering, duplicate track, wrong letter, `type`+`axis`, bare
  `decided`, `decided=0`.

### 11.4 PUBLIC repo — `packages/report`

- export `POLE_UNDECIDED_STRENGTH = 55` and `isUndecided(pole)`.
- `SharePole` gains `strength?: number`; `SHARE_PAYLOAD_VERSION` → 3 with
  `SHARE_PAYLOAD_VERSIONS = [1, 2, 3]`. The parser reads a missing `strength` as
  `undefined`, never as a number.
- a test asserting the threshold table of §4.2 against `demoCohortRows()`, so
  the number in this document fails the build if the demo cohort changes.
- `currentType(readings)` — the §7.2 derivation, pure, in this package because
  it is the same kind of object `playerType()` already is and because both repos
  need the identical answer. It takes readings and returns a type plus
  `movingAxes`; it reads no clock and no store.
- a test that three readings whose letters disagree produce a `moving` axis, and
  that two readings never smooth.

### 11.5 PUBLIC repo — the gallery

- axis chips per track from the new facets, rendered only above zero, driven by
  `galleryQueryString` — the browser still spells no URL of its own (TEN-107).
- `GalleryCard`: a strength meter per pole; an undecided pole rendered `S/T`
  with the coin-flip note; the one-line retest sentence under the code.
- the fourth empty-state sentence of §9.3, and a `decided` chip.
- `apps/web/test/bundleBudget.test.ts` will need re-measuring for `/gallery`.

### 11.6 Order

1. **TEN-149 first**, unchanged from `docs/SHAPE.md` §8: no reading can be
   written while no sitting can start.
2. Payload v3 + strengths (public repo), because everything else reads them.
3. `profiles` + `profile_identities` + eager creation, folded into the
   `ensureParticipant` collapse (private repo).
4. `profile_type_readings` + the write at score time (private repo).
5. `currentType()` in `packages/report` (public), then `GET /v1/profile`
   (private). The derivation is pure and testable before anything serves it.
6. `axis` / `decided` in the contract (public), then in the gallery handler
   (private), then the chips (public). Contract first: the browser must not be
   able to spell a query the service has not learned.

### 11.7 Steps that need the founder

- **F1 — demote the code.** §4 assumes `docs/SHAPE.md` §8 step 4 (lead with the
  character, keep the code as small print). If the founder keeps the code as the
  headline, §4.2 and §4.4 still stand but the product will keep asserting a
  letter it renders as undecided one line below. That is a contradiction a
  reviewer will find.
- **F2 — the Clerk cutover link.** Storing `verified_email_hash` and merging two
  `auth_ref`s into one profile is an identity decision, not an engineering one.
  It must be answered **before** step 11 of `docs/RENAME.md` §5, which is the
  last moment it is cheap.
- **F3 — display names.** A chosen name on a public card is a moderation
  surface this repo does not have. Until F3 is answered, `display_name` is
  stored and never served publicly.

## 13. Flip conditions

**The design flips to a stored code and no undecided band when both hold:**

- a cohort of **≥ 400 completed sittings** shows fewer than 20% of people within
  0.25 SD of any cutline (today: 62.2% within 0.25 SD of at least one, N = 44);
  **and**
- a test-retest on **≥ 100 people who sat twice** shows ≥ 85% four-letter code
  stability (today: **zero** people have sat twice, because zero have sat once —
  `attempts` gained 0 rows on 2026-09-05 and its last row is 2026-08-30).

**The feature is withdrawn if** the axis filter is ever used to order people, or
a count from it appears in a sentence with a population noun in it. Both are
detectable: `SHARE_TEXT_FORBIDDEN` and `efficacyClaims.test.ts` already run over
emitted strings, and `docs/SAMPLING.md` §3 S5 already fails a build on a
population-shaped function name.

**The smoothing window flips** if, once ≥ 50 people have three or more runs,
the `moving` flag fires on more than a third of readings. That would mean the
mean is lagging real change rather than filtering noise, and the window should
shorten to two or go away. The counter-flip is the same statistic below 5%: a
window nobody's data ever disagrees with is a window doing nothing, and the
simpler "most recent run" rule wins.

**A cheaper flip, worth naming:** if per-axis facet counts show one axis
carrying almost all the filtering (people only ever click T2, say), the other
three chips are chrome and should go. That is measurable after the first month
of a working gallery and needs no ADR.

## 14. Honest limits

1. **N = 44, and it is a demo cohort.** Every cutline in this document is a
   median of `demoCohortRows()`. It is not a population, not a norm, and
   `docs/SAMPLING.md` §11 forbids describing it as one.
2. **The 55 threshold is exact only on the fallback path.** For T1 and T3 read
   from behaviour, `strength` is a saturation meter against display constants
   (`T1_FULL_ITERATION_RATIO = 1`, `T3_FULL_VERIFICATION_EVENTS = 3`) that are
   already documented as "display saturation points, NOT norms". 55 there is a
   convention.
3. **No retest data exists.** The rerun risk is inferred from MBTI's published
   numbers and from cutline distance, not measured on Foray. It cannot be
   measured until people sit twice.
4. **The gallery is a self-selected subset of a self-selected cohort.** People
   who publish are not people who sit. No count from this filter describes even
   "Foray takers", only "Foray takers who published a card".
5. **Old cards cannot be repaired.** A v1/v2 payload has no strength and never
   will; those cards match both sides of every axis forever. There are three
   issued credentials and a handful of shares, so the cost is small today and
   grows with every day this is not shipped.
6. **Nothing here was benchmarked.** No query plan was taken against the
   `shares` axis index, because the private repo is not in this worktree and the
   table has too few rows for a plan to mean anything. The index shape is a
   prediction, and §12.1 should be re-checked at 10,000 published cards.
7. **The three-run window is arithmetic, not evidence.** `1/√3` assumes three
   independent readings of an unchanged person with equal variance. All three
   assumptions are untested, and the last one is the one a real person breaks:
   somebody who practised between runs is not being re-measured, they have
   changed. The 44.4% figure inherits the same N = 44 demo cohort as everything
   else in §3.
8. **`profile_identities` does not undo RENAME I3.** Attempts, sittings and
   credentials still point at `participants.id` and are still orphaned by an
   instance switch. This design saves the profile, not the history.

## 15. What was rejected

| rejected | why |
|---|---|
| `profiles.player_type char(4)` as the stored truth | throws away strength and evidence, the only things that make the number defensible, and cannot answer "how firmly" |
| a third, undecided letter in the code | 16 codes → 81, no `NAMES` entry, and it changes the meaning of an already-shipped `PLAYER_TYPE_CODE_RE` |
| dropping near-cutline people from both sides of a filter | deletes about a fifth of the wall per axis and makes the filter lie by omission |
| a provisional type from practice or the daily | a practice deck yields no `t2raw.sensitivity`; the letter would name a different measurement — the `personality.ts` collision this repo already removed once |
| repeated `?axis=` keys | `firstValues()` in `serviceFetch.ts` keeps only the first, so filters would vanish silently at the seam |
| normalising a bad `axis` value | TEN-107's rule: a caller asking for something we will not do is told so |
| lazy profile creation at first write | makes `GET /v1/profile` 404 for a signed-in person, and costs a third round trip on the write path instead of zero on the read path |
| a second publish switch on the profile | two opt-ins for one public fact is how a default becomes public by accident |
| an in-place `current_type` column, updated per run | destroys the evidence that a person moved, which is the most interesting thing the feature holds, and breaks the append-only rule `responses` and `transcripts` already follow |
| "most recent run" as the current type | the noisiest estimator for the 63% of people §3 measured; three runs cut the fragile share to 44.4% for one line of arithmetic |
| a decayed weighting over the whole history | steadier, and cannot be said in one line on a card; tuned against zero repeat sitters |
| `?held=current` / `?held=ever` | a card is a frozen snapshot of one run, so neither word is true of it; "ever" also reads as a bigger cohort than it is |
| history in the share payload | a second public fact with no second opt-in, and `docs/SHARING.md` §2 allows no default share |
| a forum table "while we are here" | not asked for, and it would be the second definition of what a type is |
