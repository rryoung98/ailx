# PROGRESSION.md — practice, streaks and the personal progress page

The reason to come back, and the felt sense of getting better. Spec §13
("Experience design") is the source; `AGENTS.md` and `FRONTEND.md` are the
contracts. Where they disagree with this file, they win.

Section order: 1 Why · 2 Practice · 3 The streak rule · 4 Progression ·
5 Where the code lives · 6 What is deliberately absent · 7 Known gaps.

---

## 1. Why a second loop exists

A scored sitting is a **rare event**. It is long, it is timed, and a candidate
cannot retry it. Nothing that happens once a season can carry a habit, so a
streak built on sittings would be a streak nobody ever has.

Spec §13 already names the repeatable unit: the T2 **Mastery** training round —
five minutes on the durable artefact families with immediate right/wrong
feedback on every card, which published work found moved typical participants
from 31% to 51% detection and super-recognisers from 41% to 64%. It is called
"the most satisfying part of the whole experience because people can feel
themselves getting better". That is the loop. Practice is the unit; the streak
counts practice days; the progress page shows the trajectory.

The governing rule from §13 is unchanged and enforced in code: **every game
mechanic lives in onboarding, pacing, reveal or social layers. None of them
enters `score()`.** Practice is unscored, reaches no report figure, and writes
to no scored table.

---

## 2. Practice

### 2.1 The hard separation from the scored bank

> Practice must never draw from, reveal, or teach the answers to a scored item.

A bank item somebody has practised is a **dead item**, and there is no way to
un-teach an answer. The separation is therefore structural, not a convention:

1. `packages/report/src/practice.ts` imports no instrument content, takes no
   bank argument, and reads no file. Its only material is `PRACTICE_BANK`.
2. Every practice id is prefixed `practice:`; no scored id is.
3. `packages/report/test/practice.test.ts` asserts all of it **against the real
   `bank.jsonl` on disk** — no shared id, no shared passage, no near-duplicate
   passage (a word-level fingerprint, so a paraphrase fails too), no leaked
   rationale, and a scored id resolves to nothing at every entry point.
4. `packages/backend/test/practice.test.ts` re-asserts it at the deal: twenty
   dealt decks contain only practice ids, and a practice round writes no row to
   `attempts`, `responses` or `attempt_decks`.

### 2.2 The corpus, honestly

18 hand-written text passages, six per family, three carrying a planted
artefact and three clean. The call is **"does this passage carry a &lt;family&gt;
artefact?"** — deliberately *not* T2's authentic-versus-synthetic media call.

This is a **placeholder set** and the page says so. A synthetic-vs-human drill
needs a licensed human-written and model-generated media corpus; inventing one
would train the wrong tell, and borrowing scored items would burn the bank. The
families, the immediate feedback and the five-minute shape are the spec's; the
corpus is a stand-in. Replacing it is content work, not code: fill
`PRACTICE_BANK`, bump `PRACTICE_BANK_VERSION`, and the tests above still hold.

### 2.3 The round

Six cards, family-balanced and class-balanced (so the feedback teaches rather
than rewarding a "call artefact on everything" bias), dealt by a pure seeded
sampler. In the hosted build the **server deals and records the deck before any
answer is taken**, so the submit can refuse an answer to a card this session was
never shown — that is what stops a client walking the corpus. In the static
export the drill still plays from the bundled corpus and records nothing, and
says so.

---

## 3. The streak rule

### 3.1 What counts as a day

A day counts when the participant **finishes a whole round** and the round took
long enough to have been read.

| Floor | Value | Why |
|---|---|---|
| `PRACTICE_MIN_ANSWERS` | the whole 6-card deck | An abandoned session never counts. |
| `PRACTICE_MIN_ELAPSED_MS` | 15 s, measured SERVER-side between `started_at` and the submit | A scripted instant submit never counts, however honest its client timestamps look. |

**Accuracy is deliberately not a condition.** This is training: being wrong is
the point of the feedback, and a streak that demanded correctness would push
people to look answers up instead of learning the tell.

### 3.2 Which day

The participant's **own local calendar day**. A UTC day punishes everyone east
of Greenwich for practising in the evening.

The day is derived from `completed_at` — a **server** stamp — shifted by the UTC
offset recorded with that same session. The offset is the one thing the client
tells us, and it is clamped to a real civil offset (UTC−12 … UTC+14). The worst
a liar can do is move their own day boundary inside that window, which is
exactly what actually travelling would do; it cannot manufacture a day, because
no client timestamp is anywhere in the derivation.

### 3.3 Rest days (the grace rule)

> A streak survives **one** missed day, and may spend a rest day only if it has
> not spent one in the previous **7** days.

A zero-tolerance streak makes one bad evening delete months. That is the
mechanic that turns an instrument into a slot machine, and spec §13 is explicit
that the tone here is a well-made instrument, not a mobile game. One rest per
week survives travel and illness, and is tight enough that "practised most
days" stays true of anyone with a streak.

**Today is never held against you.** The day is still open, so a streak whose
last day is yesterday is alive at full length, and one whose last day is the day
before yesterday is alive too if a rest day can cover the gap.

### 3.4 A break costs the run, never the record

`best` (longest run ever) and `totalDays` (distinct days ever) are **monotone**:
they never decrease. A lapsed streak reads "your best run of N days stands", not
"you lost your streak". There is no way to lose anything on this page.

### 3.5 Derived, never stored

There is **no streak column and no streak table**. A stored counter is a number
the server must trust itself to have maintained, and every bug in it is
unfalsifiable afterwards. `streakSummary()` recomputes current, best and total
from the stored sessions on every read, so the streak is always exactly what the
evidence says. One forward scan (`practiceRuns`) produces both numbers, so they
cannot disagree.

---

## 4. Progression

Three honest things, and nothing else:

- **Practice accuracy per day**, as the server graded it, plus an early-half vs
  recent-half comparison over answers (not days, so one big day cannot own both
  halves).
- **Per-track shape across sittings**, oldest first — each run's **own** scorer
  output projected from its stored event log. Advisory (FRONTEND.md §4.7) and
  labelled as such on the page.
- **What moved**: first vs latest sitting per track, and early vs recent
  practice accuracy. Declines are shown as declines.

Everything is qualified by one exported sentence, `PROGRESS_BASIS`, so the page
and its tests share a single wording:

> No percentile, no composite and no judged result — the judging pipeline is not
> built yet, so a number implying one would be a claim we cannot back.

A figure with too little behind it says **why it is missing** rather than
drawing an empty chart: `MIN_TREND_DAYS` (3) for a trend line,
`MIN_TREND_ANSWERS` (12) for an accuracy comparison, two sittings for a track
comparison.

---

## 5. Where the code lives

| Thing | Home |
|---|---|
| Practice corpus, deck sampling, grading | `packages/report/src/practice.ts` (pure) |
| Local days, streak rule, progression shaping | `packages/report/src/progress.ts` (pure) |
| Session persistence, server grading, day counting | `packages/backend/src/practice.ts` |
| Tables | `db/schema.sql` — `practice_sessions`, `practice_answers`; migration in `db/README.md` |
| API | `apps/web/app/api/practice/route.api.ts`, `.../[id]/route.api.ts` |
| Drill UI | `apps/web/lib/PracticeDrill.tsx` + its CSS module |
| Pages | `app/practice/page.tsx` (both builds), `app/progress/page.api.tsx` (server only) |

`/progress` reads the store, so it is a `page.api.tsx` and does not exist in the
GitHub Pages export at all — the same page-twin rule as `/gallery`, `/world` and
`/review`, enforced by `apps/web/test/serverOnlyPages.test.ts`. `/practice` is a
plain `page.tsx` on purpose: its corpus is bundled and its API calls are made
from the client, so the drill plays in the demo, which is the surface that sells
the loop.

---

## 6. Deliberately absent

No currency. No cosmetic unlocks. No badges. No levels. No leaderboard, and no
ranking of one person against another anywhere in the loop. Spec §13's warning
is that the tone should read as a well-made instrument, not a mobile game, and
`apps/web/test/progressPage.test.tsx` holds that as a test.

Nothing in the loop is shareable yet. Progression **could** become a share
section later, and the seam for that is clean: `progressReport()` is a pure
function returning a plain object, and `@ailx/report`'s share payload is an
explicit section allowlist. Adding a section is a decision about what a
candidate may publish about themselves, not a refactor — it belongs with the
sharing work, not here.

---

## 7. Known gaps

1. **The corpus is a placeholder** (§2.2). It is the one thing standing between
   this drill and the spec's measured 31%→51% intervention.
2. **Pre/post is not wired.** Spec §13 wants the training round recorded as a
   measured intervention against the scored deck. Practice is deliberately
   decoupled from sittings today; linking them is a psychometrics decision.
3. **`/progress` needs a proven identity.** Under `AILX_AUTH=clerk` a page
   render carries the session; under `AILX_AUTH=dev` the browser sends no
   asserted header on a navigation, so the page shows its honest "we do not know
   who you are" state. The drill itself works either way.
4. **No E2E yet.** FRONTEND.md §6.4 lists the required specs; a practice→streak
   journey belongs on that list once Playwright covers the exam path.
