# Cycle 3 / Otter blockout

Author: AI in the role of modeler.
Reviewers: AI in the role of rigger, then AI in the role of technical artist, in separate
steps. Not human professional review.

Built in Blender 5.2 from `src/blockout_otter.py`, which reads the constants in
`src/otter.py`. Primitives and surface patches, Workbench render. A shape test, not a
look test.

```
blender -b -P docs/design/character-system/src/blockout_otter.py
```

Outputs: `png/16-blockout-*.png`, `models/otter-blockout.glb` and `.blend`.

![Blockout sheet](png/16-blockout-sheet.png)

## What the blockout found

The owl blockout's three fixes carried over unchanged: face, chest and apron are surface
patches from the first build. The otter added two new problems.

| Problem | What the render showed | Fix |
|---|---|---|
| paws | capsule arms placed at the 2D shoulder x-positions sat inside the round body; only two small bumps showed | arms moved outside the body surface and a little forward, mitts with them |
| tail | the cone lay on the ground behind the body with a gap | the tail's base is buried in the lower back; the tip rests on the ground |

The rule that follows: a 2D shoulder position is a projection. In 3D the limb root sits
on the body surface, not at the drawn x-coordinate. The 2D pivot and the 3D pivot are the
same joint, not the same number.

## What holds

- The silhouette reads from the storyboard camera and from the worktable camera. The tail
  is visible from both.
- At 64 px the storyboard view reads as the otter: round head, cream face, tail.
- Head tilt of 20 degrees leaves no gap at the neck.
- The near arm at 150 degrees pivots at the shoulder empty and clears the scarf.
- A lean of 14 degrees at the hips keeps both feet on the ground. The tail stays put,
  because it is parented to the world, not the hips. Whether the tail should lean with
  the body is a production animation decision.

## Rig measurements, 2D, Chrome, 2026-09-12

| Budget | Measured | Limit proposed |
|---|---|---|
| rig SVG | 4 639 bytes raw, 1 145 gzip | 12 000 gzip per character |
| elements per rig | 59 | 120 |
| idle frame rate, two rigs | 61 frames per second | 60, no layout per frame |

## Open for production modeling

- Patch borders are stepped. A production mesh needs clean borders or a painted texture.
- The tail is a straight cone. The 2D tail curves; the production tail needs a bend.
- The mitts have no fingers. The 2D mitt has two short lines. Decide in modeling.
- Ears are spheres with an inner dot. They read; they are not designed.
- Blush is a flat oval on the face patch. In production it is paint, never geometry.

## Reviewer notes

Accepted as a blockout. The rigger notes the tail parenting question above. The
technical artist repeats the owl note. The 160-segment spheres exist for the render. They
must not go to production as they are.
