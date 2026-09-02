# PROGRESSION.md — practice, streaks and the personal progress page

The reason to come back, and the record of having come back. Spec §13
("Experience design") is the source; `AGENTS.md` and `FRONTEND.md` are the
contracts. Where they disagree with this file, they win.

Section order: 1 Why · 2 Practice · 3 The streak rule · 4 Progression ·
5 Where the code lives · 6 What is deliberately absent · 7 Known gaps.

Whether the loop actually transfers is an open question with a design and no
data: `docs/TRANSFER-STUDY.md` — pre/post *d′* on held-out generators, with the
criterion reported separately so the two are never conflated again.

---

## 1. Why a second loop exists

A scored sitting is a **rare event**. It is long, it is timed, and a candidate
cannot retry it. Nothing that happens once a season can carry a habit, so a
streak built on sittings would be a streak nobody ever has.

Spec §13 already names the repeatable unit: the T2 **Mastery** training round —
five minutes on the durable artefact families with immediate right/wrong
feedback on every card. It is the loop because people *enjoy* it, and for no
other reason: **the loop is justified by engagement, never by efficacy.** The
evidence for what this drill does — Gray et al. 2025 read with its
between-subjects design, and Geissler et al.'s N = 1,200 trial in which
gamified and feedback drilling did not beat control — is written once in spec
§13 and once in code as `PRACTICE_EFFICACY_NOTE`. Import that constant; do not
paraphrase it, and never quote the accuracy numbers without the design.
Practice is the unit; the streak counts practice days; the progress page shows
what you did, not that you improved.

The honest position is therefore "we do not know", not "it works" and not "it
does not". `docs/TRANSFER-STUDY.md` is the experiment that would settle it, and
§3 of that file is the case for publishing the answer whichever way it lands.

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

28 real **images**: 12 genuine photographs and 16 model-generated ones. 23 are
FOUND on Wikimedia Commons under CC0, CC-BY, CC-BY-SA or public domain; five
we GENERATED ourselves (below). The call is T2's own — **"is this a photograph
or an AI-generated image?"** — and every card ends with a one-line **tell**
naming the artefact actually visible in that picture, or, for a photograph,
naming the suspicious-looking feature and why it is genuine.

The tell is the deliverable. Whatever the training effect the spec cites is
worth, it came from being shown the thing you looked straight past, not from
the card count — so the tells are written per picture and the corpus test
refuses a missing, duplicated or answer-restating one.

| Where it lives | What it is |
|---|---|
| `instruments/practice/2026.1/curation.json` | hand-written curation: title, class, family, difficulty, alt, tell |
| `instruments/practice/2026.1/corpus.json` | the built manifest — the source of truth |
| `packages/report/src/practiceCorpus.ts` | GENERATED from it, so the bundle can carry the corpus into the static export |
| `apps/web/public/practice-media/` | the assets, content-addressed, ≤200 KB each and all encoded towards one common size |
| `instruments/tools/commons_media.py` | the one Commons fetch/licence/encode helper, shared with the scored deck's pipeline |
| `instruments/tools/openrouter_images.py` | the one image-GENERATION client: vetted models, provider families, redistribution basis, budget route |
| `instruments/practice/2026.1/generated.json` | the generation ledger — every attempt, its model, its full prompt, its cost, and the human verdict on it |

Rebuild with
`python3 instruments/practice/2026.1/tools/build-practice-corpus.py`.
The pipeline **refuses** rather than guesses: a title already in the scored
bank, an asset whose bytes match a scored asset, a licence outside the allowed
set, an image curated `synthetic` whose Commons page claims no generator, or
an image curated `authentic` whose page mentions one. Commons category
membership is not evidence — those categories contain AI *restorations* of
real photographs and real photographs of AI-themed events, both of which were
found and rejected while this corpus was built.

**Assets live in the repo, not in Blob storage.** `/practice` ships in the
static GitHub Pages export, which has no server to sign a Blob URL from, so a
Blob-backed corpus would make the drill work only in the hosted build — and
the demo is the surface that sells the loop. 23 budgeted JPEGs is about 3 MB.
The budget is per asset (≤200 KB) and every asset is encoded towards ONE
common size rather than merely under the cap — see "no free answers" below.

**No free answers.** A practice bank fails twice over if a card can be called
without looking: the candidate learns the shortcut instead of the artefact,
and the bank's measured difficulty is a lie. This corpus HAD such a shortcut.
Generators default to 1:1 and cameras shoot 3:2 or 4:3, so every near-square
item was synthetic and "answer AI if square" took 29% of the bank blind. Six
items are now reframed by crop — three photographs to square, three
generations to 3:2 — and each crop is recorded in that item's
`credit.derivative` exactly like the watermark crops. Encoded size leaked the
same way (noise compresses large, smooth gradients compress small), so every
asset is encoded towards one common size instead of merely under the cap.
`packages/report/test/practiceCorpus.test.ts` now FAILS if aspect band, exact
ratio, orientation, width, height, pixel count, file-size band or colour
components predicts the answer better than chance — a silent shortcut is worse
than a loud one.

**Three generated items are not photorealistic, and the data says so.**
`donkey-cart` is an oil-painting pastiche; `tower-city-haze` and
`temple-plaza-crowd` read as CGI renders. A candidate can call these from the
finish in a second and never reach the artefact, which teaches
"painterly = generated" — false of every genuine painting and of every
photorealistic generation. They are kept because freely-licensed
photorealistic generations are scarce, but they carry `material.style`
(`painterly` / `render`), the test refuses an undeclared or unknown value, and
`donkey-cart`'s tell now names the shortcut and refuses it. Replacing them
with photorealistic generations under the same licensing discipline is the
first content job.

**What is still thin, and it is said on the page.** The corpus is small, and
the families are not equally deep: physics 4 synthetic / 4 authentic, function
7 / 5, sociocultural 5 / 3. Generation went straight at the thinnest of those:
sociocultural went from 2 to 5 generated items — a kilt with its pleats at the
front, outdoor shoes standing on the raised floor of a Japanese genkan, and a
cricket wicket with two stumps and no bails — each a specific error a person
who knows the setting would catch, rather than a stereotype. 28 cards still
repeat inside a few rounds; depth now needs scale, not a new mechanism.

**We generate now, and the model mix is a rule, not a preference.** Five items
were made for this corpus by
`instruments/practice/2026.1/tools/generate-practice-images.py`, because found
generations are scarce and rarely culturally specific enough to be culturally
WRONG. They come from FIVE models across BOTH provider families reachable
through OpenRouter — `openai/gpt-5-image`, `openai/gpt-5.4-image-2`,
`google/gemini-2.5-flash-image`, `google/gemini-3.1-flash-lite-image` — with
the older 2.5 model kept deliberately, because its cruder failures are the
easy end of a difficulty range one model cannot supply. A corpus generated by
one model teaches that model's fingerprint instead of the artefact, which is
the aspect-ratio leak again in a form nobody can see, so
`practiceCorpus.test.ts` FAILS if fewer than two models or two provider
families are used, or if any one model holds more than half of what we made.

**Every generated image was looked at by a person, and most attempts were
not.** Generation only ever produces a PENDING attempt; the build refuses
anything not explicitly accepted. Ten attempts produced five items. The five
rejections are in the ledger with their reasons, because they are the useful
part: a market scene whose shadows the model quietly normalised back to one
sun (twice), a canal whose "missing" reflection came back present but dark,
and a British street whose left-hand-drive tell was both illegible and
arguable — left-hand drive in Britain is unusual, not impossible, and a tell
that teaches an arguable rule is worse than no item.

**Redistribution rights are recorded per item, from the provider's own
terms.** OpenAI assigns output rights to the customer; Google does not claim
them; OpenRouter claims nothing and passes the model terms through. The quoted
basis is on every generated item as `credit.rights_basis`, and
`openrouter_images.py` cannot generate from a provider that has no basis
entry — unclear rights block the image instead of being argued about after it
ships. Both providers require that AI origin is never denied, which is what
this corpus is for. See `docs/CREDITS.md`.

**Reproducibility is the format's advantage over scavenged media.** A found
generation comes with a Commons page that usually says only "AI-generated". A
generated item carries the exact model, the FULL prompt, the date, the
OpenRouter generation id and the cost.

**The credit line moved to AFTER the call.** It had to: a generated item's
credit names the model, and a Commons author is often literally called
"midjourney" or "Gemini Ai", so the caption was answering the card for a
reader who never looked at the picture. Hiding it on generated items alone
would have made a MISSING caption the giveaway, so no card is captioned until
it is answered, and every credit then appears in full. The prompt is never
rendered — it names the artefact.

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

### 3.6 The anonymous on-ramp: playing with no account

The first ask for an account used to arrive before anybody had a reason to
care, and once Clerk landed it arrived in front of the game: the API refuses an
unauthenticated caller, so a drill that could only play through the server
could not play at all for a stranger. **A visitor now plays immediately and
keeps a streak with no account.** Signing in is asked for only where an
identity is genuinely needed — a scored sitting, progress across devices, a
credential — and never anywhere else.

**Where an anonymous day lives, and why.** `localStorage`, in the visitor's own
browser (`packages/report/src/localPractice.ts` holds the rules,
`apps/web/lib/data/localPractice.ts` the storage and the network). Three candidates
were considered:

| Option | Verdict |
|---|---|
| **localStorage** | **Chosen.** Works in BOTH builds — the static Pages export has no server at all, so anything server-shaped would make the loop exist in only one of them. Nothing about a stranger leaves their machine, and there is no row to delete later because there is no row. |
| A cookie | Rejected. It ships the days to the server on every navigation, which is collection about somebody who has agreed to nothing, and 4 kB is a ceiling a year of days would reach. |
| An anonymous server participant | Rejected. `participants.auth_ref` is provider-scoped and means a PROVEN identity. Minting one for a visitor manufactures exactly the identity the scored path requires, and leaves a personal-data row belonging to nobody. |

The cost is real and is stated on the page rather than hidden: clearing site
data ends it, and it does not follow anyone to a second device. **That cost is
the honest reason to sign in**, and it is the only one the copy is allowed to
use — `LOCAL_PRACTICE_BASIS`, `SIGN_IN_VALUE`, `CLAIM_PROMISE` and
`CLAIMED_DAYS_BASIS` are exported wordings, and a test refuses scarcity,
countdowns and "you are about to lose" phrasing in any of them.

**A local day is worth less than a server day, and is labelled as such.** A
server day is derived from a server-stamped `completed_at` and cannot be
asserted by a client (§3.5). A local day is the browser's own word: it earns
the streak on that browser's screen and nothing else. It reaches no score, no
report figure, no credential and no cohort statistic. The qualification rule is
the same `qualifiesForStreak` in both places, applied to an elapsed time each
side measures for itself.

**The claim.** When an anonymous player signs in, `lib/auth/ClaimProgress.tsx`
posts the unclaimed days to `POST /practice/claim`, once per account. The
server stores them in `practice_claims` — a table of its own, so a
client-asserted day can never wear a server stamp — and `practiceDays()` merges
the two lists with the same `mergePracticeDays` the browser uses: per field the
LARGER of the two, never the sum, so claiming twice changes nothing. A day is
marked claimed in the browser only when the server says it stored THAT day, so
a failed claim loses nothing and the next sign-in retries it; a day already
claimed is never offered to a second account. `/progress` marks a claimed day
"brought from a browser" in words, not a colour.

**Anonymous play is not a way into a scored sitting**, and that is a test
(`apps/web/test/anonymousScoredSitting.test.ts`), not a convention. A refused
attempt creation yields no attempt id, so no deck is dealt and no score is ever
requested; the run falls back to the bundled released-practice tier, whose keys
are published on purpose and which is no score of record. A score of record
needs a proven identity, and always will.

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
| The browser-kept ledger, the claim's rules and its wordings | `packages/report/src/localPractice.ts` (pure) |
| Reading/writing that ledger, and POSTing a claim | `apps/web/lib/data/localPractice.ts` |
| Who the browser is, as something a view re-renders on | `apps/web/lib/auth/identityState.ts` |
| The claim itself, fired once per account at sign-in | `apps/web/lib/auth/ClaimProgress.tsx` |
| Claimed days (server side) | `practice_claims` + `POST /practice/claim` (PRIVATE backend repo) |
| Session persistence, server grading, day counting | `packages/backend/src/practice.ts` |
| Tables | `db/schema.sql` — `practice_sessions`, `practice_answers`; migration in `db/README.md` |
| API | `apps/web/app/api/practice/route.api.ts`, `.../[id]/route.api.ts` |
| Drill UI | `apps/web/features/practice/PracticeDrill.tsx` + its CSS module |
| Daily deck, grid, daily ledger | `packages/report/src/daily.ts` (pure) |
| Daily share words | `packages/report/src/shareText.ts` (pure), with the rest of the share copy |
| Daily UI and its browser store | `apps/web/features/daily/DailyChallenge.tsx`, `apps/web/features/daily/dailyState.ts` |
| Pages | `app/practice/page.tsx` and `app/daily/page.tsx` (both builds), `app/progress/page.api.tsx` (server only) |

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

The DAILY CHALLENGE (`/daily`) is the one exception, and a narrow one. It is
the same shape as practice — published material, no score, a streak that counts
returns — with two additions: everybody gets the same five cards on the same
calendar date, and the result can be posted as a grid. The grid is safe by
construction and by mutation test (docs/SHARING.md §8): it is built from
hit/miss/skip and can carry no key, no item and no rank. Its streak is
`streakSummary`, the same function and the same rest-day rule as practice, over
a SEPARATE store — a daily round is not a practice round, and folding one into
the other would inflate a streak that is supposed to mean one specific thing.

Nothing else in the loop is shareable. Progression **could** become a share
section later, and the seam for that is clean: `progressReport()` is a pure
function returning a plain object, and `@ailx/report`'s share payload is an
explicit section allowlist. Adding a section is a decision about what a
candidate may publish about themselves, not a refactor — it belongs with the
sharing work, not here.

---

## 7. Known gaps

1. **The corpus is real but still small** (§2.2). 28 licensed images now do
   T2's own authentic-versus-synthetic call, and the second route is open: the
   repository generates its own images, multi-model, licensed and vetted. What
   it needs now is SCALE, and scale needs a budget line. The verification batch
   was ten calls for about $0.50, almost all of it the two OpenAI models
   (Gemini image calls billed at nothing measurable), and it kept five. At that
   accept rate, roughly 2 calls per shipped item, another 30 items is about 60
   calls. The generator takes its own key from `AILX_GEN_OPENROUTER_KEY` and
   falls back to the shared candidate proxy only under a hard per-run cap,
   because that budget belongs to people sitting T4.
   An independent review of all 24 shipped pictures (2026-08-30) pulled one
   item and rewrote nine tells; what it found is worth stating, because the
   same mistakes are easy to make again:
   - `balcony-ironwork` was PULLED. Its tell rested on a balustrade about 20 px
     wide — an undifferentiated smear at 8× zoom. A tell nobody can see teaches
     a candidate to distrust their own eyes. The item was also the restoration
     trap live: a real château, a Commons author literally named "chat gpt",
     and a title saying "sepia" over a full-colour asset, so "AI-generated" was
     doing double duty for "AI-edited" on provenance nobody can corroborate.
   - `moated-palace-reflection` was KEPT with a new tell. The old one praised a
     reflection that is not in the picture: the moat is wind-chopped edge to
     edge and mirrors nothing. On a *photograph* that is the worst failure in
     the set — it teaches a check, then rewards it where it returns nothing,
     and marks a candidate wrong for looking honestly. The image is good, so
     the tell now teaches the true rule: a rippled surface CANNOT mirror, and
     an absent reflection is a fact about the weather, not about the pipeline.
   - Two tells taught FALSE RULES and were rewritten: smaller front wheels are
     normal on real horse-drawn carriages, and a lamp-post height difference
     that is within perspective is not evidence.
   - Three alt texts described a different picture from the one shown (a
     tractor called a trolley, the wrong mushroom species, chopped water called
     "still"). A screen-reader candidate answers from the alt, so a wrong alt
     is a wrong QUESTION, not a typo.
2. **The physics family is thin, and its synthetic tells were too alike.** All
   three generated physics items said "nothing casts a shadow", so one trick
   cleared the family. Two are re-told: `tower-city-haze` on glass that mirrors
   nothing while the ponds below it mirror the trees, and `promenade-lamp-posts`
   on the DISAGREEMENT between objects that cast shadows and objects that do
   not in the same sunlight. `chapel-golden-hour` remains the shadow item and is
   the clearest of the three. The fourth is now `ladder-one-stile`, generated:
   a shadow that is the wrong LADDER — four wide rungs on the wall, ten close
   ones on the object casting them.

   Two physics artefacts resisted prompting outright, on two models each, and
   this is worth knowing before the next run: shadows that point in different
   directions in one frame, and an object with no reflection in mirror-flat
   water. Both times the model quietly restored the physics — one global sun,
   a reflection present but dark. Physics violations seem easier to FIND than
   to commission; sociocultural and functional errors came back first time.
3. **Media is still images only.** Spec §T2 also runs video and audio blocks.
   Practice drills neither, and the corpus format has no place for them yet.
4. **Pre/post is not wired.** Spec §13 wants the training round recorded as a
   measured intervention against the scored deck. Practice is deliberately
   decoupled from sittings today; linking them is a psychometrics decision.
5. **`/progress` needs a proven identity.** Under `AILX_AUTH=clerk` a page
   render carries the session; under `AILX_AUTH=dev` the browser sends no
   asserted header on a navigation, so the page shows its honest "we do not know
   who you are" state. The drill itself works either way.
6. **A claimed day cannot be verified, and is not pretended to be.** A browser
   ledger is the browser's own word: somebody who edits it can claim a streak
   they did not practise. Practice is unscored, unshared and uncredentialled,
   so what that buys is a lie told to oneself — but the days are stored apart
   from the sessions we stamped, bounded (`MAX_LOCAL_DAYS`,
   `MAX_LOCAL_SESSIONS_PER_DAY`), and labelled as self-reported wherever they
   are drawn, so nothing downstream can ever mistake one for a measurement.
7. **No E2E yet.** FRONTEND.md §6.4 lists the required specs; a practice→streak
   journey belongs on that list once Playwright covers the exam path.
