# ADR: a durable profile, and the player type attached to it

Status: **proposed — schema and endpoints specified, nothing implemented.** No
product code lands on this branch; the only file it adds is this one.
Date: 2026-09-06. Branch: `w/profile-type`. Issue: TEN-178.
Amended the same day by the founder: a type CHANGES OVER TIME (§7), and the
gallery is readable only by people who have taken part, with a PREVIEW for
everybody else (§16).
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
- **The wall is gated and the preview is not** (§16). Three states: signed out
  gets six sample cards and a count and no wall entry at all; signed in with no
  round gets one capped page with the filters; a completed round gets the whole
  wall, and a completed sitting gets the artefacts. All of it is withheld
  server-side. A `/s/<token>` link is unchanged and resolves for anybody.
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
9. **Serve another person's ARTEFACT or PROMPT to somebody who has not attempted
   that material.** The participation gate of §16, stated as an invariant rather
   than a preference because a published T1 build is a worked answer to a brief
   the reader has not yet met, and their artefact is evidence inside a
   credential. A derived CARD carries no item, no key and no per-item outcome,
   so serving one spoils nothing — which is why the §16.5 preview is allowed and
   an artefact preview is not. The gate may never become a paywall, a ranking, a
   reason to sit again, or a thing described to users as exclusivity (§16.9). Sign-in and participation are TWO gates and only the second protects a score — §16.2, and collapsing them is how a measurement rule becomes a growth tactic.

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
- **F4 — should the daily be a key to the gallery?** §16.3 makes a
  server-stamped practice round the key that exists today. The daily could be a
  second key, but only if it starts submitting to the service — today it never
  leaves the browser, and `docs/SHARING.md` §8 treats that as a feature ("no
  server round trip is needed to agree on what today is"). The trade is one
  route and one column against a daily that still works offline and in the
  static export. It is a product call, not an engineering one.
- **F5 — the one-page cap** for a signed-in visitor who has not played (§16.3).
  It reuses the shipped `GALLERY_PAGE_SIZE` of 24, so it adds no number, but
  where "a look" ends and "a search" begins is a judgement and the founder owns
  it.

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
8. **The gate is a spoiler default, not access control.** Anyone can collect
   share links other people posted, or ask a friend, and see cards without
   playing (§16.4). Nothing in §16 is a security boundary, and calling it one
   would be the overclaim this document keeps refusing elsewhere.
9. **The gate's cost is not measured.** Nobody knows how many people bounce at
   a locked wall rather than play a round, because nothing is gated today. The
   preview exists to make that number small; whether it does is §16.12's flip,
   and it needs a month of real traffic to read.
10. **`profile_identities` does not undo RENAME I3.** Attempts, sittings and
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
| a gate whose only key is a completed sitting | TEN-149 means nobody can sit, so the wall would be readable by nobody, forever. A gate whose key does not exist is a wall (§16.3) |
| a blurred or faded gallery behind the gate | a blurred card is a full card in the DOM with a filter over it — a leak with a decoration on it. Withholding is server-side (§16.5.3) |
| gating the `/s/<token>` share view | the token is a capability its owner handed over on purpose; gating it breaks the loop `docs/SHARING.md` exists to build, and a preview that 401s does not spread (§16.4) |
| a claimed local practice day as a key | `practice_claims` holds days a browser asserted, so the gate would be openable by `POST /practice/claim` with a made-up date (§16.3) |
| the daily as a key, today | it has no route and never leaves the browser, so the service that owns the answer cannot verify it. Founder step F4 (§12.7) |
| a preview of the newest cards | recency on a public page, beside a token circulating on social, is a weak identification, and it turns the preview into a feed people time their publishing for (§16.5.2) |
| a modal over the share page | founder refinement 2 replaced it: one canonical URL, one server render, works with JavaScript off and for a crawler. A modal is a client nicety over a page that already stands alone (§16.4) |
| a separate `/gallery/preview` URL | a third surface showing the same six cards is a third thing to keep on the safe list (§16.4) |
| sign-in justified as spoiler protection | a signed-in stranger is exactly as unattempted as a signed-out one, so the identity gate protects no score and may not borrow the argument (§16.2) |
| `sharePayloadSchema.pick()` for the preview card | a new opt-in section would join the preview automatically. The preview is a hand-listed strict object (§16.10) |
| a per-card `og:image` for the gallery | it would publish six specific people's card art to every scraper, and be re-argued on every sample change. One static image (§16.7) |
| a reciprocity rule ("publish to see") | a share only exists over a completed attempt, so it constrains nobody, and it would buy low-effort cards published for access (§16.8) |

## 16. Two gates: sign-in, and having taken part

Added 2026-09-06, second amendment, over three founder messages read together:

1. *"to see the forum / gallery people need to take the test first."*
2. *"I think the share link should have some spoilers where you can see a modal
   of the gallery, i.e. a preview."*
3. *"Not a modal, but something that can still show a preview and requires
   someone to sign in. Similar to a Twitter share link."*

**The shape is the public post page.** A shared link resolves to a real,
server-rendered, indexable PAGE that anybody can read: the card its owner
published, plus a bounded preview of the wall around it. Going further asks for
a sign-in. Going further than that asks for a round of your own.

**The rule.** Other people's WORK is not readable by someone who has not taken
part. The SHAPE of what people made is readable by anybody.

### 16.1 Why: spoilers, not signups

The defensible reason is **spoiler protection**, and the growth reason is not
used — not in this document and not in the copy.

The gallery shows what people built and, once the forum exists, how they
prompted. To somebody who has not yet attempted the same material, that is a
**worked answer**. This repo already refuses worked answers twice, in these
words:

- `docs/SHARING.md` §8: the daily grid "describes an ITEM SET that other people
  have not played yet", so `dailyGrid` takes `hit | miss | skip` and nothing
  else, and a fourth glyph is refused because "a grid plus one poster's answers
  is the whole answer sheet".
- The same file: "The grid guard protects the READ — what somebody sees in a
  feed before they have played — which is the only thing that can actually be
  spoiled here."

The participation gate is that guard applied to the wall instead of to a glyph.

"It drives signups" does not survive scrutiny and is not the reason. A gate
justified by engagement gets widened whenever engagement dips. A gate justified
by spoilers has a fixed edge — the material you have not attempted — and that
edge is what §16.3 and §16.5 cut on.

### 16.2 THE TWO GATES ARE DIFFERENT, and only one of them is a measurement rule

This is the section to read before changing anything else here, because
collapsing these two is how a measurement rule quietly becomes a growth tactic.

| | **sign-in** | **participation** |
|---|---|---|
| what it is | an IDENTITY gate | a SPOILER gate |
| what it protects | the wall from anonymous bulk enumeration — §11 item 4, "never a directory of candidates" — and it is what a profile, a cross-device streak and the right to publish hang off | the measurement: another person's artefact or prompt reaching somebody who has not attempted that material |
| is it an invariant? | **no.** A product decision, flippable on a number (§16.12) | **yes**, for artefacts and prompts. §11 item 9 |
| may it use the spoiler argument? | **never** | it is the spoiler argument |

**A signed-in stranger is exactly as unattempted as a signed-out one.** Signing
in teaches nobody anything about the instrument and protects no score. So
whatever state 1 gains over state 0 (§16.3) is justified by identity and scale,
never by spoilers, and the copy for that step must not borrow the spoiler
sentence.

**Does the preview contaminate a score of record? No, and the reason is exactly
what it withholds.** Put in the invariants, because it is why a preview may
exist at all:

> A derived CARD carries no item, no key, no per-item outcome and no artefact
> (`docs/SHARING.md` §1 — item ids, item content, per-item correctness,
> confidence, latency, `dPrime`, `brier`, `nSignal`, `nNoise` and event counts
> are "deliberately NOT sections, and never serialized"). Seeing one before your
> own attempt therefore changes nothing you could be scored on. **Another
> person's ARTEFACT or PROMPT is different in kind, and is never served to
> somebody who has not attempted that material.**

The artefact half is the measurement half. The `site` section carries a T1
build; T1 is an open build task judged by a comparative-judgement panel
(`docs/COMPARATIVE-JUDGEMENT.md`) against a brief the next candidate will meet,
and the artefact is evidence inside a credential (`docs/CREDENTIAL.md` §1 —
"here is the artifact they built"). Somebody who studies three published builds
and then attempts that brief has been coached, and their submission is a
contaminated input.

Two things this does **not** claim, said out loud because the overclaim is
tempting:

1. It does not protect the item bank. The bank is in the private repo and no
   browser holds it (`AGENTS.md`, "The repository split"); the daily deals from
   published content whose keys are public on purpose.
2. It does not protect the population statistic. That is protected by the frozen
   anchor being panel-only — `docs/TREND-FORM.md` §2.1: "Track A never sees the
   anchor." Track A's growth loop is assumed to involve screenshotting items. No
   gate on a web wall changes that, and none is claimed to.

### 16.3 Three states, and what each one gains

| state | who | what they see | what it gains over the state above |
|---|---|---|---|
| **0 — signed out** | anybody, including a crawler | the shared card in full, plus a **preview strip**: six sample cards from the wall, the total published count, and one sentence. No filters, no paging, no search, no artefacts, no tokens | — |
| **1 — signed in, no round** | authenticated, no qualifying round | the **wall of cards**: the first page — `GALLERY_PAGE_SIZE`, already 24 and already shipped — with the axis filters and facets on. Still no artefact, no forum, and **no paging past that page** | browsing and filtering instead of a fixed sample of six — plus the things sign-in is actually for: a profile, a streak that follows them across devices, and the right to publish |
| **2 — one qualifying round** | a completed, SERVER-STAMPED practice round | the whole wall: every page, every filter, every published card and its `/s/<token>` link | the wall as a **search** rather than a look — unbounded browsing |
| **3 — a sitting of their own** | a completed sitting, or (once §6.2's partial sittings exist) the tracks the artefact came from | the **artefacts**: the `site` section, and any future forum thread carrying prompts | the measurement half, §16.2 |

**What each boundary is for, in one line each.** 0 → 1 is identity. 1 → 2 is
scale: a fixed page is a look, and the whole wall is a search, and it is the
search that "the wall is not readable by someone who has not taken part"
actually means. 2 → 3 is the measurement.

**The one-page cap on state 1 is not a spoiler rule and is not described as one.** It is the existing `GALLERY_PAGE_SIZE` (24, `packages/contract/src/gallery.ts`), so it invents no number and no new constant.
Cards are spoiler-safe (§16.2). The cap exists so that mining the wall costs a
round rather than an account, and so that the founder's rule — take part before
you read other people's work — has a real edge without the page being a wall.
It is the number most likely to be wrong in this document, and §16.12 flips it
on traffic rather than on taste.

**If signing in gained a visitor nothing, the step would be friction with no
payoff and should not ship.** It gains the two rows above and it is worth saying
in the visitor's own terms rather than ours (§16.6).

**Tier 2's key exists today.** `POST /practice` and `POST /practice/:id` are
shipped and server-stamped, and `PRACTICE_MIN_ANSWERS` / `PRACTICE_MIN_ELAPSED_MS`
(`docs/PROGRESSION.md` §3.1) already define a round that "took long enough to
have been read". A person can sign in, play one six-card round, and be in —
tonight, with TEN-149 open. That is the test this design had to pass: §6 says
only a sitting produces a type, and TEN-149 says nobody can sit, so a gate whose
only key was a completed sitting would ship a wall readable by **nobody**. A
gate whose key does not exist is a wall.

**A qualifying round is a SERVER-STAMPED round; a claimed local day is not.**
`practice_claims` holds days a browser asserted (`docs/PROGRESSION.md` §3.6: "a
table of its own, so a client-asserted day can never wear a server stamp"). A
gate that accepted a claimed day would be opened by `POST /practice/claim` with
a made-up date, which is not a gate. The predicate reads practice sessions,
never claims.

**The daily is not a key yet, and saying otherwise would be false.**
`packages/contract/src/routes.ts` carries `startPractice`, `claimPractice` and
`submitPractice`, and nothing daily; `docs/SHARING.md` §8 makes a virtue of it —
"no server round trip is needed to agree on what today is". A round that never
leaves the browser cannot be verified by the service that owns the answer.
Making the daily a key needs a server-stamped daily submit: founder step **F4**
(§12.7). Until then the copy says "practice round", because that is the door
that opens.

**Anonymous play stays anonymous, and stays open to play.** Nothing here
gates `/practice`, `/daily`, `/wall` or the static export. The gate is on the
wall of other people's work, never on the work.

### 16.4 The share page: the destination, not a doorway

**Decision: `/s/<token>` keeps working for everybody, exactly as it does today.
No token starts 404ing, nothing that was public yesterday moves behind auth, and
`docs/SHARING.md`'s promises are unbroken.** The page is where the link lands,
and it is complete on arrival: the card, then the preview strip, then one
sentence.

The gate is on the INDEX, never on the capability. This repo already made that
distinction — `docs/SHARING.md` §3, "Unlisted is not published": a capability URL
"is not listed anywhere, is not indexed, and is only reachable by someone the
candidate handed it to". The wall is a search nobody handed you. A link is a
gift: one card, chosen by its owner, sent on purpose. Gating it would make the
owner's own act of sending conditional on the recipient's participation, which
is not the founder's rule and reads as a demand.

**There is no modal.** One canonical URL, one server render. The preview strip
is server-rendered HTML on the share page and on a locked `/gallery`; it works
with JavaScript off, it works for a crawler, it works at 360 px, and there is no
overlay state to get out of sync with a page. A modal presentation may be added
later as a client nicety over a page that already stands alone — never as the
route to the content, and never as the only way to read it.

There is also **no separate `/gallery/preview` page**. The preview is a
component over one service route, rendered inline in the two places it belongs.
A third URL showing the same six cards would be a second thing to keep on the
safe list.

Two consequences of leaving the link ungated, both accepted:

1. Somebody determined can collect links other people posted and see cards
   without playing. So can they by asking a friend. The gate is a spoiler
   default, not an access-control system, and this document does not call it
   one.
2. The gallery tile links to `/s/<token>` (`docs/SHARING.md` §7.1) and that stays
   true. The tile is behind the gate; the link it points at is not; and the
   preview strip carries no token at all (§16.5.1).

**If this is ever reversed** — if a share view starts demanding participation —
`docs/SHARING.md` §2's "recoverable by its owner" and §4's social preview must
both be reopened in the same change, because a preview that 401s does not
spread. Do not reverse it in a corner.

### 16.5 The preview strip

**The line, and it is the whole design: a preview may reveal the SHAPE of what
people made, and nothing that functions as an answer.**

#### 16.5.1 The two lists

**Safe to preview** — served to anybody, on a public, indexable page:

| field | why it is safe |
|---|---|
| `playerType.code`, `name`, `tagline` | a lens over four aggregate numbers; names no item |
| the four poles: letter, label, `strength`, the meter, `evidence` | `evidence` describes the OWNER's own behaviour ("revised most builds"), never an item |
| `tracks` — four 0-100 values | track SHAPE. `docs/SHARING.md` §1: "cannot identify which items were drawn, cannot reveal an answer key, and do not change with item content" |
| `band` | a quota band over the demo cohort, not a judged result |
| the character portrait | art, keyed off the code |
| `completedOn` | one UTC day |
| counts: cards published, people who published | aggregate, names nobody |
| **the shared card itself**, on `/s/<token>` | its owner published it and the page is already showing it. Showing it again gives nothing away |

**Never in a preview, withheld SERVER-SIDE** — absent from the response body,
never hidden in the DOM:

| field | why it is withheld |
|---|---|
| the `site` section — the T1 build | a worked answer to a brief the reader has not attempted (§16.2). Invariant, not preference |
| prompt text, now or in the forum | the same thing in another medium |
| any rationale, tell or key | teaching material for a deck; a preview is not where to meet one cold |
| anything derived from an operational item — id, content, per-item outcome, confidence, latency, `dPrime`, `brier`, `nSignal`, `nNoise`, event counts | already never serialized (`docs/SHARING.md` §1); the preview adds no exception |
| the owner's `note` | the candidate's own words, human-approved for the WALL. A public page is a wider audience than the wall |
| the share `token`, and any `/s/` link | a token is a capability, and a capability does not belong in a public, cacheable, indexed page |
| `displayName` | not served publicly at all until founder step F3 (§12.7) |
| facet counts per axis | §16.5.3 |

The rule behind both lists in one line: **if a field could help somebody
recognise an item, or hand them another person's work on material they have not
met, it is not in the preview.** The safe list describes a person's run. The
withheld list describes the instrument, or another person's work on it.

**A crawler and a signed-out visitor get the same bytes.** That is the test of
whether the line is real: if the two ever differ, something is being withheld by
presentation rather than by the server.

#### 16.5.2 How many cards, and which

**Six cards, a FIXED sample, deterministic and stable. Not the newest.**

- **Newest leaks recency.** "Published in the last hour", on a public page,
  beside a token circulating on social, is a weak identification of one person —
  and it turns the preview into a feed people time their publishing for.
- A fixed sample is **cacheable**, so a crawler, a scraper and a human see the
  same page, and it cannot drift from what was indexed.
- Six is two rows of three on a phone and one row on a desktop. It is enough to
  show that the cards differ from each other, which is all the preview must
  prove.

**Selection: the six oldest published, card-only shares** — oldest, because it is
the one order that never changes; card-only (`site_digest IS NULL`), so no
artefact can enter the sample even before the projection strips it. The sample
is recomputed only when a member is revoked or refused, which is also the only
way it goes stale. With fewer than six, the preview shows what there is and says
so — never a placeholder, never a card invented for the purpose.

**Personalised previews are rejected.** A preview that varies by viewer has to
have its withholding re-argued per viewer, and it cannot be cached or crawled
coherently.

#### 16.5.3 What is withheld, and how

**The withholding is server-side. The wall's `entries` are ABSENT from a state-0
response — not empty, not `null`, never present-but-hidden.** The browser never
receives what it must not show, so there is nothing for `filter: none` in
devtools to reveal. A blurred card is a full card in the DOM with a decoration
over it: a leak, not a design, and it is refused by name.

**Facets are withheld at state 0 too.** §8 argues facet counts are safe because
each counted card is individually visible; for a state-0 caller they are not, so
the argument does not carry — a facet of size 1, plus a card circulating on X, is
a weak identification. Facets arrive with the filters, at state 1.

**The tests that prove it.** Private repo,
`packages/backend/test/galleryGate.test.ts`, in the style
`packages/report/test/share.test.ts` already uses: serialize a state-0 response
and assert the string contains no share token, no `/s/` path, no `site`, no
`note`, no `displayName`, and that the parsed object has no `entries` and no
`facets` key — forbidden-substring and exact-object, the two layers that already
guard the share payload. Public repo: a view test asserts the preview renders no
wall entry and no element carrying a blur, an opacity or a `user-select` style,
so the design cannot become CSS-recoverable later without failing a build.

### 16.6 The copy: three states, three sentences, and what sign-in really buys

Collapsing any pair produces the sentence that reads "sign in" to somebody who
is already signed in.

| state | headline | body | action |
|---|---|---|---|
| **0 signed out** | "This is one card from a real Foray run." | "Below is a sample of what other people published. Sign in to browse the wall — you get a profile, a practice streak that follows you across devices, and the ability to publish a card of your own." | "Sign in" |
| **1 signed in, no round** | "One round opens the whole wall." | "You are seeing the first page. Play one six-card practice round and every page and filter opens. It is held back so nobody reads other people's work before their own first go — about five minutes." | "Play a practice round" → `/practice` |
| **3-locked section, on an open wall** | (inline, on the card) | "The build behind this card opens once you have sat the exam yourself. It is a worked answer to a brief you have not attempted." | no button while TEN-149 is open; the sentence stands alone |

**Note which sentence carries the spoiler reason.** State 1's does. State 0's
does not, and may not: signing in protects no measurement (§16.2), so its copy
says what the person actually gets — a profile, their own type once they take
part, a streak across devices, and the right to publish. That is the honest
answer in their terms, and if it is ever not enough to justify the step, the
step should go rather than the sentence get stronger.

Exported as constants beside `BAD_QUERY_COPY` in the gallery feature, so the
honesty tests (`SHARE_TEXT_FORBIDDEN`, `efficacyClaims.test.ts`) run over them
like every other emitted string. Three words are refused in review and in test:
**exclusive**, **members**, and **unlock** as a noun. No sentence counts what
the visitor is missing — "412 cards you cannot see" is pressure wearing a fact.
The register is `docs/PROGRESSION.md` §3.6's, which already refuses scarcity and
countdowns.

**The rule every line must satisfy: the action it names must be possible TODAY.**
That is why state 1's key is a practice round and not a sitting, and why the
tier-3 sentence names no button while nobody can sit.

### 16.7 Crawlers and Open Graph

A crawler carries no identity, so a crawler is state 0, and everything it can
reach is on the safe list of §16.5.1. That is deliberate: the public page is
public because there is nothing on it to withhold.

- **`/s/<token>` is unchanged**, and stays `noindex` with `cache-control:
  no-store` (`docs/SHARING.md` §2). The preview strip added to it carries no
  token and no artefact, so the page's crawl posture does not change.
- **`/s/<token>/card.png` is unchanged.** It renders only from the frozen
  payload, holds no key, reads no store, and 404s on a revoked or unknown token.
  Nothing gated can leak through it, because nothing gated is in the payload it
  reads.
- **`/gallery` serves a crawler the state-0 page**: the preview strip plus the
  existing generic `metadata` in `app/gallery/page.api.tsx`, which describes the
  wall and names no card. No wall entry is server-rendered to an unauthenticated
  caller, so no search cache can hold one. It names nobody — `displayName` is
  not served (§16.5.1) — which is why it may be indexed at all;
  `docs/CREDENTIAL.md` §4 keeps `noindex` on every surface that NAMES a person.
- **No new `og:image` route.** The gallery's own social image, if it ever gets
  one, is a STATIC asset — never a render of the six sample cards. A per-card OG
  on a public page would publish six specific people's card art to every scraper
  and would have to be re-argued each time the sample changed.

Nothing gated leaks through metadata, because the withholding is server-side
(§16.5.3) and the only per-card metadata surface in this app is the share view,
which is not gated. A gate implemented in the browser would have leaked through
both.

### 16.8 Reciprocity — a recommendation, marked as one

The founder did not ask whether publishing requires having published, so this
document invents no rule. What it records is that the system already answered it:

**A share can only exist over a completed attempt.** `createShare` builds the
payload from a stored log, so anybody who can publish has already taken part.
There is no publisher who has not participated, and a reciprocity rule would
constrain nobody.

**Recommendation, not a decision:** do not add one later either. "Publish to
see" turns a wall into a toll and converts a spoiler default into a demand, and
the first thing it produces is low-effort cards published to buy access — a
moderation cost with nothing on the other side of it.

### 16.9 Never-trade, added to §11 as item 9

Neither gate may ever:

- become a **paywall**, or be lifted by paying, in any currency;
- become a **ranking** — no "you have seen N cards", no state shown as status, no
  badge for holding a key;
- become a reason to take the test **again**. One round opens it for good. A gate
  that re-closes is a retention mechanic wearing a spoiler argument;
- be described to users as **exclusivity**, membership or a club. The
  participation step is described as spoiler protection, in the words of §16.6
  and no others, and the sign-in step is described by what it gives the person;
- have a key that costs money, an invitation, or a wait;
- be checked in the **browser**. A gate the client evaluates is a gate the client
  can lie about, and it ships the data it is gating on the way past.

And the sign-in gate may never borrow the spoiler justification (§16.2), because
a signed-in stranger is exactly as unattempted as a signed-out one. The preview
may never carry an artefact, a prompt, a rationale, a key, an item-derived field,
a note or a token. Widening the safe list is an ADR, not a ticket.

### 16.10 Implementation

**Where the check runs: the exam service, in one place.** The service owns the
store, so it is the only side that knows whether a round happened. This repo
holds no store and must not grow one
(`packages/core/test/frontendOnly.test.ts`).

*PRIVATE repo.*

- One predicate, defined once beside `PUBLICLY_SERVED` and composed, never
  re-implemented (`docs/SHARING.md` §7.1's rule):

  ```sql
  -- state 2: one server-stamped qualifying round. Never practice_claims.
  EXISTS (SELECT 1 FROM practice_sessions s
           WHERE s.participant_id = $1
             AND s.completed_at IS NOT NULL
             AND s.answer_count >= $min_answers
             AND s.completed_at - s.started_at >= $min_elapsed)
  -- state 3: an attempt of their own.
  OR EXISTS (SELECT 1 FROM attempts a
              WHERE a.participant_id = $1 AND a.completed_at IS NOT NULL)
  ```

  The floors are the exported `PRACTICE_MIN_ANSWERS` and
  `PRACTICE_MIN_ELAPSED_MS`, so the gate and the streak cannot disagree about
  what a round is.
- `GET /v1/gallery` becomes **identity-OPTIONAL**: an unauthenticated caller gets
  **200** with the preview payload, never a 401. A 401 cannot carry the sentence
  that says what to do, and the page must.
- The state is computed once per request, before the listing query. A state-0
  request runs the preview query instead of the listing query, and a state-1
  request runs the listing query with `limit = min(limit, GALLERY_PAGE_SIZE)` and `offset = 0`
  **enforced server-side** — a browser asking for page 2 gets page 1, and the
  response says which state it is in rather than silently truncating (the
  TEN-107 rule: never normalise a filter in silence; here the cap is a property
  of the caller, not of the query, so it is reported in `access`, not a 400).
- `GET /v1/gallery/preview` — the same preview payload on its own route,
  unauthenticated and cacheable, for the share page and the locked gallery. It
  is the only public gallery-shaped route, and it selects card-only shares by
  construction (`site_digest IS NULL`), so an artefact cannot enter it even if
  the projection changes later.
- State 3 is per-section, not per-card: a state-2 caller gets the card with
  `payload.site = null` and `siteLocked: true`, redacted **in the projection**.

*PUBLIC repo — `packages/contract`.*

```ts
export const GALLERY_ACCESS_STATES = ["signed-out", "no-round", "open"] as const;

export const galleryAccessSchema = z.strictObject({
  state: z.enum(GALLERY_ACCESS_STATES),
  /** 0 signed out · 1 signed in, no round · 2 a round · 3 a sitting */
  tier: z.number().int().min(0).max(3),
  /** Cards published. Aggregate, and the only wall number state 0 gets. */
  total: z.number().int().nonnegative(),
  /** Present when the server capped the page (state 1). Null otherwise. */
  pageCap: z.number().int().positive().nullable(),
});

/** The preview card: the safe list of §16.5.1 and nothing else. */
export const previewCardSchema = z.strictObject({
  code: z.string().regex(PLAYER_TYPE_CODE_RE),
  name: z.string().min(1),
  tagline: z.string().min(1),
  poles: z.array(previewPoleSchema).max(4),   // track, letter, label, strength
  tracks: z.record(z.enum(TRACK_IDS), z.number().min(0).max(100)),
  band: z.string().min(1),
  completedOn: z.string().nullable(),          // one UTC day
});
```

The object is built by one pure `previewCardFrom(payload)` in
`packages/report`, an ALLOWLIST in the same shape as `sharePayloadFrom`
(`docs/SHARING.md` §1: "the payload is an ALLOWLIST, not a redaction"), and the
contract's schema is a **strict object over a hand-listed set of fields** — not
a `.pick()` off the payload, and never `sharePayloadSchema` itself, which
delegates to `parseSharePayload` and therefore carries whatever the payload
carries. `galleryEntrySchema`
carries the whole frozen payload on purpose (`docs/SHARING.md` §7.1), and that
is exactly the property a preview must not inherit: a new opt-in section must
appear on the wall automatically and must NOT appear in the preview
automatically. One contract test asserts a preview card parses with `site`,
`note` and `token` in the input and absent from the output; one asserts that
adding a field to the share payload does not add it here.

The listing response's `entries` and `facets` become **optional and absent** when
`state === "signed-out"` — optional, not nullable and not empty, so a client that
forgets to check `state` fails to compile rather than rendering an empty wall
under the "nobody has published a card yet" sentence (§9.3, which must keep
meaning what it says).

*PUBLIC repo — the app.*

- `GalleryView` starts sending identity headers. It sends none today, on purpose
  ("what is listed does not depend on who is looking"), and `gallery.ts`'s own
  header says `GET /gallery` is "public, unauthenticated". Both comments become
  false and must change in the same commit as the behaviour. The headers are the frozen
  `BROWSER_REQUEST_HEADERS` list, so no CORS preflight changes.
- `features/gallery/GalleryPreview.tsx` renders the six sample cards and the
  §16.6 copy. It imports no `GalleryCard`: a preview that reuses the wall's tile
  inherits the wall's fields, which is the leak this section exists to prevent.
- `app/s/[token]/page.api.tsx` renders the strip under the card, server-side. No
  dialog, no client route, no new URL.
- `/gallery` renders the same component when `state === "signed-out"`, and the
  wall plus the state-1 sentence when `state === "no-round"`.
- The four empty-state sentences of §9.3 are untouched and are never shown to a
  locked caller: "nobody has published a card yet" and "you have not played yet"
  are different facts and must never be swapped.
- Bundle budgets for `/gallery` and `/s/[token]` are re-measured
  (`apps/web/test/bundleBudget.test.ts`).

*Order.* The contract's `access` and `previewCard` blocks first, then the service
predicate and the preview route, then the share-page strip and the gallery
states. The browser must not be able to render a state the service has not
learned to send — the rule §12.6 already applies to the filter.

### 16.11 Steps that need the founder

- **F4 — is the daily a key?** §16.3 makes a server-stamped practice round the
  key that exists today. The daily could be a second key, but only if it starts
  submitting to the service; today it never leaves the browser and
  `docs/SHARING.md` §8 treats that as a feature. One route and one column against
  a daily that still works offline and in the static export.
- **F5 — the one-page cap.** It reuses the shipped `GALLERY_PAGE_SIZE` of 24,
  so it adds no number, but where "a look" ends and "a search" begins is a
  judgement and the founder owns it.
- **F1 and F3 above still apply**: the code-versus-character headline, and
  whether a display name is ever served publicly. A named card changes the
  crawl posture of §16.7 and would have to be re-argued there.

### 16.12 Flip conditions

- **The sign-in step goes** if it gains the visitor nothing measurable: state-0
  pages viewed rising over a month with at least 200 of them while sign-ins do
  not move. It is not an invariant and it protects no score (§16.2), so it is
  the first thing to drop rather than the last.
- **The page cap moves or goes.** If almost nobody at state 1 reaches the bottom
  of the first page, the cap is theatre and should go. If the wall is being
  scraped page by page by signed-in accounts, it should tighten.
- **The card tier opens** — the whole wall public — if the numbers show the gate
  turning people away rather than delaying them. Cards were never the
  measurement half.
- **The artefact tier never opens on a number.** It is item 9 of §11, and it
  changes only if T1 stops being judged against a re-used brief.
- **The preview shrinks** if a card ever starts carrying a field that names an
  item. The safe list is a list, not a rule of thumb, and it is re-read whenever
  the payload version changes (§12.4 takes it to v3).
- **The gate tightens to a sitting** only if TEN-149 is fixed AND a measured
  spoiler effect appears — published builds converging on a shape after the wall
  opens, say. Never as a growth decision.
