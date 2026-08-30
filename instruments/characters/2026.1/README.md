# Player-type characters — 2026.1

The sixteen player types get sixteen faces. `packages/report/src/playerType.ts`
already names each type and writes its tagline; this tree gives each one a
drawing, a spoken line, and the provenance that lets us publish the drawing.

## Why they exist

`docs/UX-DIRECTION.md` picks identity over rank: "the player-type card is our
owl: something people share because it says who they are". A block of four
letters does not travel through a feed. The character is what makes the card
screenshot-able at thumbnail size — which is the only size the viral surface
has.

They are a PLAYFUL surface, and the split in `docs/UX-DIRECTION.md` applies:
nothing here appears during a scored sitting, and no character has ever seen a
score. The player type itself is a lens on one run, split at the demo cohort's
median, and the composite never reads it.

## The art direction, and why it is one paragraph

`cast.json` holds `style_preamble` ONCE, and every prompt is that paragraph
plus the character's own `subject` line. A per-character style paragraph drifts
by the sixth character and nobody notices until all sixteen are side by side.

The direction fits the shipped design language: the paper palette (`--bg`
#f7f4f2, `--accent` #0b6b47), one even hand-drawn ink weight, flat matte fills,
no gloss and no 3D. Each character is an animate handmade INSTRUMENT — a
sextant, a spirit level, a metronome, an empty picture frame — chosen so the
object says something true about the type it belongs to, and so sixteen
silhouettes stay distinguishable at 48 pixels.

One model draws all sixteen, which is the opposite of the practice corpus rule
(`instruments/practice/2026.1/README.md`) and for the opposite reason: there,
one generator's fingerprint is the failure; here, sixteen fingerprints are.

## The voice

Each character says one line to you on the report and the share view. It has
to match the tagline's register — dry, specific, and honest about a weak run.
A voice that flatters is a voice that lies, and the card stops being worth
sharing. `packages/report/test/characters.test.ts` fails on praise words and
on a line that is not a sentence.

## Files

- `cast.json` — hand-written input. This is the file to edit: code, slug,
  subject, alt text, voice line.
- `generated.json` — every attempt, with the verdict a person gave it.
- `characters.json` — the built manifest. Source of truth for the app.
- `tools/generate-character-images.py` · `tools/build-characters.py`
- Assets land in `apps/web/public/characters/`, named by content address (a
  redraw CHANGES the filename — delete the orphan and update
  `docs/CREDITS.md`; the build prints orphans and the test fails on them).
- `packages/report/src/characterCast.ts` is GENERATED; do not edit it.

## Redrawing one

```sh
export AILX_GEN_OPENROUTER_KEY=sk-or-...
python3 instruments/characters/2026.1/tools/generate-character-images.py --only PTAD --force
python3 instruments/characters/2026.1/tools/generate-character-images.py --status
# LOOK at .ailx-generated/characters/<file>, full size AND at 48px, then:
python3 .../generate-character-images.py --accept PTAD --reason "..."
python3 .../generate-character-images.py --reject PTAD --reason "..."
python3 instruments/characters/2026.1/tools/build-characters.py
```

## What a person must check before accepting

1. **It is not somebody else's character.** A design that reads as an existing
   mascot, game creature or franchise character is a legal and reputational
   problem, not a taste one. Reject it.
2. **It reads at 48 pixels.** Scale it down before you decide. A busy
   instrument becomes a smudge in a feed, which is where it will mostly live.
3. **No text in the picture.** The preamble bans it; models add it anyway
   (the first weathervane arrived with N/E/S/W on it and was rejected).
4. **It matches the other fifteen.** Line weight, palette, framing and scale.
   Consistency across the set beats any single image being spectacular.

## What the build refuses

- a character with no ACCEPTED attempt;
- an attempt drawn by a model other than `cast.json`'s;
- an attempt whose prompt is not preamble + the current subject (edit the
  subject, redraw — never rewrite history);
- a staged file whose bytes no longer match the recorded hash;
- two characters sharing one asset;
- an asset over the encoded-size budget.
