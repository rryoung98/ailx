# Foray Commons character system

Working folder for TEN-279. One organizer, developed through the specialist passes in
`../CHARACTER-SYSTEM-ISSUE.md`, then tested against two supporting concepts.

Status on 2026-09-12: three cycles. Cycle 1 developed a compact bird through passes 1 to 10.
Cycle 2 rebuilt the organizer as an owl chosen from generated concepts and blocked it out in
3D. Cycle 3 did the same for a sea otter. The otter is the current organizer. The generated
owl sheets are the finish reference for production art. Every review is an AI
review in a named role. No human art director has signed off. See `10-revisions.md`
for the acceptance criteria and what remains open.

## Read in this order

| Pass | Document | Main sheets |
|---|---|---|
| 1 | `01-brief.md` | none |
| 2 | `02-references.md` | none |
| 3 | `03-silhouettes.md` | `png/03-silhouettes-*.png` |
| 4 | `04-proportion-face.md` | `png/04-*.png` |
| 5 | `05-costume-color.md` | `png/05-*.png` |
| 6 | `06-turnaround.md` | `png/06-turnaround.png` |
| 7 | `07-expression-pose.md` | `png/07-*.png` |
| 8 | `08-rig-tests.md` | `png/08-deformation.png` |
| 9 | `09-animation-runtime.md` | `animation-test.html` |
| 10 | `10-revisions.md` | `png/10-*.png` |
| 11, 12 | in `04-proportion-face.md` and `05-costume-color.md` | `png/11-*.png`, `png/12-*.png` |
| Cycle 2 | `13-owl-rebuild.md` | `png/13-*.png`, `concepts/` |
| Cycle 2 | `14-blockout.md` | `png/14-*.png`, `models/` |
| Cycle 3 | `15-otter-rebuild.md` | `png/15-*.png`, `concepts/otter-*` |
| Cycle 3 | `16-otter-blockout.md` | `png/16-*.png`, `models/otter-*` |
| Guide | `CHARACTER-SYSTEM.md` | the deliverable |

Pass 11, consumer products, is optional and was not run.

## How the sheets are made

Every sheet comes from construction constants in `src/`. The only generated images are
the concept explorations in `concepts/`, and they are labeled as such. The ticket warns
that a polished generated image proves nothing. So the chosen concept was rebuilt from
rules before anything else was made from it.

```
python3 docs/design/character-system/src/sheets.py     # write svg/
python3 docs/design/character-system/src/animate.py    # write the rig and test page
sh docs/design/character-system/src/render.sh          # both of the above, then png/
```

`render.sh` needs `rsvg-convert` from librsvg. The PNGs are rendered at 1x, so a
figure labeled 64 px is 64 CSS pixels tall.

| File | Role |
|---|---|
| `src/palette.py` | colors, contour width |
| `src/organizer.py` | the organizer: construction, expressions, poses, four views |
| `src/supporting.py` | source keeper, loupe companion, a sibling silhouette |
| `src/build.py` | helpers and the pass 3 silhouette alternatives |
| `src/sheets.py` | every review sheet |
| `src/owl.py` | cycle 2: the owl organizer, four views, expressions, poses |
| `src/owl_sheets.py` | cycle 2 review sheets |
| `src/otter.py` | cycle 3: the otter organizer, four views, expressions, poses |
| `src/char_sheets.py` | the same review sheets for any candidate that exposes `Character` |
| `src/animate.py` | rig export and `animation-test.html`, now the otter |
| `src/blockout.py`, `src/blockout_otter.py` | Blender blockouts, run with `blender -b -P` |

## Labeling

Each pass names its author role and its reviewer role. Both are the same AI model acting
in different roles, in separate steps. That is not professional human review. Human
review is the next step, not this one.
