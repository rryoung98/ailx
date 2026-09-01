# TRACK-REVIEW.md — are T1–T4 the right things to measure?

Status: analysis and recommendation, 2026-09-01. No track code was changed to write it.
Scope: the user's question — *"Are T1 through T4 the exact kind of material we should be testing,
and the most engaging?"* — judged against two goals that pull in opposite directions: a game people
choose to play, and a statistic a ministry would cite.

Sources: `AILX-Spec-2026.1.md` (§03, §04, T1–T4, §09), `docs/FUTURE-TRACKS.md`,
`docs/SAMPLING.md`, `packages/tracks/*/src`, and the research evidence base at
`/tmp/ailx-research-01a04bca/` (sections 1, 2 and 4).

---

## 0. The verdicts, up front

| Track | Verdict | One-line reason |
|---|---|---|
| **T1 Creative Build** | **KEEP — promote to flagship** | The only track whose construct is unambiguous, whose score has a human criterion, and whose artefact is inherently shareable. It is also the one that cannot enter the population statistic without surgery. |
| **T2 Discrimination** | **CHANGE — demote from 100 pts to a diagnostic block, and rename the construct** | The scored quantity (d′) is the exact statistic the best evidence says does not move with training and is partly a stable perceptual aptitude. Keep the items; stop calling the score AI literacy. |
| **T3 AI-Assisted Reasoning** | **KEEP — this is the load-bearing track** | Its 35 model-free points (RSR/RAIR) measure a behaviour under AI, not a perception. It is the only track measuring the failure mode the field actually worries about. |
| **T4 Generative Direction** | **CUT as a scored track; keep as the gallery/play surface** | It duplicates T1's scoring machinery, duplicates T1's construct claim, costs the most per candidate, and its distinctive component (brief compliance) is a better T3 rubric dimension than a track. |

**If forced to keep exactly one track: T3.** Not T1, which travels further, and not T2, which is
the one people would play. T3 is the only track whose score survives the question "what does a high
score let you predict?" — it measures whether a person keeps judgement while using a model, it does
so with an objective, un-gameable, model-free component, and its content ages with the models
rather than being burned by publication.

---

## 1. The frame: two goals, and which track serves which

The two goals are not equally served by the same material, and it is worth stating the asymmetry
before judging any track.

- **The game** needs: fast feedback, an obvious win condition, low setup, a shareable output, and a
  reason to come back tomorrow.
- **The statistic** needs: invariance across languages and devices, a compressible short form
  (`docs/SAMPLING.md` §5: 45–60 minutes, matrix-sampled, one session), variance that is not a floor
  or a ceiling, a defensible link between short form and full sitting, and content that does not
  burn when it is published.

These conflict most sharply on **exposure**. The game's best asset is a shareable item ("can you
tell which is real?"). Publishing that item destroys its use as a scored item forever
(`docs/FUTURE-TRACKS.md`, "The one-way door"). Any track whose game value comes from *showing the
item* is a track whose scored bank is a consumable. That is T2, and it is the central economic fact
about T2.

They conflict again on **effort**. Wise & DeMars put the motivated-vs-unmotivated gap at ~0.58 SD —
larger than any cross-national difference AILX would want to report. A viral surface recruits
motivated people; a probability panel recruits paid ones. If effort is not measured and modelled,
the published number is a motivation artefact wearing a literacy label.

---
