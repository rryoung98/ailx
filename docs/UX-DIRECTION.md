# UX direction — fun, without spending the credibility

Recorded 2026-08-29. Standing direction for UI/UX work.

## The goal

Make AILX as fun and attention-holding as possible. Duolingo is the reference: people
return daily, feel themselves improving, and share what they got.

## The tension, stated honestly

`AILX-Spec-2026.1.md` says the opposite in one place: "No cosmetic unlocks or currency.
The audience is adult professionals; the tone should be closer to a well-made instrument
than to a mobile game."

That rule was written for a professional exam audience. The product has since chosen virality as its
main focus. Both can be true — but only if the surfaces are separated deliberately.

## The resolution: split the surfaces

Duolingo itself is the proof. The app is playful; the Duolingo English Test is proctored,
serious, and accepted by universities. Same company, same brand, two tones — and the
seriousness of the test is what makes the playfulness affordable.

**Serious surface — the scored sitting.** Calm, uncluttered, no animation that competes
with the task, no scoring pressure games, no streak nags mid-exam. Nothing here may
influence a scored input. This is what makes the number mean something.

**Playful surface — everything else.** Practice, progression, streaks, the gallery, share
cards, the world page, onboarding. Be genuinely delightful here: motion, personality,
immediate feedback, satisfying transitions, a shareable identity.

## What actually makes Duolingo work (copy these, not the cosmetics)

1. **Immediate, specific feedback.** Right/wrong the instant you answer. The spec's own
   T2 Mastery round already does this — that is the most fun thing in the product and it
   is already designed. Say it teaches the tells, never that it raises a score: the
   published effect is between-subjects and did not move non-specialists' sensitivity
   (spec §13).
2. **Small units.** Five minutes is a complete, satisfying session.
3. **Visible progress.** You can see what you did — days, rounds, cards; the record is the
   reward. Not "see yourself getting better": /progress cannot tell a better eye from a
   readier trigger finger, and says so (`PRACTICE_ACCURACY_CAVEAT`).
4. **Streaks with kindness.** Motivating, not punishing. Protect the best-streak.
5. **Identity, not rank.** The player-type card is our owl: something people share because
   it says who they are. Prefer identity and self-comparison over leaderboards ranking
   people against each other.
6. **Polish as respect.** Fast, tactile, no jank. Delight is mostly craft, not confetti.

## Guardrails

- No currency, no cosmetic unlocks, no pay-to-win mechanics. Fun comes from feedback,
  progress and identity — not from a shop.
- Never let a game mechanic touch a scored input. Streaks, badges and practice results must
  not influence, or appear to influence, a sitting's score.
- Honesty over hype: no fabricated numbers, percentiles or judged scores while the judging
  pipeline does not exist. A fun product that overclaims is a dead credential.
- Accessibility is part of the fun: motion must respect `prefers-reduced-motion`, and every
  playful control needs a keyboard path (this is an exam — a11y failures are validity
  failures).

## Practical implication

Where the spec's instrument-tone rule and this direction disagree, the rule applies to the
SCORED SITTING and this direction applies to everything else. Say which surface you are
building before you argue about tone.
