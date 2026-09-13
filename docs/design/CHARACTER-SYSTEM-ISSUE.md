# Develop the Foray Commons character system through specialist design passes

## Problem and outcome

The first Commons storyboard conveys atmosphere, but its characters feel generic and generated. The organizer sheet is exploration only; no human, bird, mole, or instrument character is approved.

Build a distinctive, personable cast with shared construction rules. Solve readability and identity first, detail later. Use Animal Crossing as a reference for coherent world and cast design, while creating an original Foray aesthetic. This is a proposed workflow, not a claim about a particular studio's process.

The Commons supports practical AI literacy: a welcoming 4–5 minute experience leading to demonstrated skills and a personal profile. Characters should make participation inviting for adults, with specific motives, flaws and relationships. Avoid long dialogue, constant congratulations, and childish exam gamification.

## Scope

Develop one organizer deeply, then test the resulting system against two contrasting supporting-character concepts. Do not produce a large cast or redesign the frontend before the system is reviewed.

## Specialist passes and review gates

1. **Brief | art director and character/narrative designer.** Define audience, role, desire, contradiction, habits, relationship to the visitor, and purpose in the learning interaction. Deliver a short brief and criteria for evaluating designs.
2. **Reference and mood exploration | concept artists, independently reviewed by art director.** Assemble annotated references for shape, gesture, clothing, materials and cultural tone. Explain what each contributes. Explore competing directions before selecting one.
3. **Silhouette and shape language | concept artists.** Explore several silhouettes in black and white without decorative props. Test recognition at intended mobile and desktop sizes. Art director selects a direction based on readability and personality.
4. **Proportion and face studies | character designers with modeler/rigger input.** Compare head/body ratios, eye placement, muzzle/nose construction, hands and limbs. Define shared construction logic and deliberate exceptions. Expressions must read without captions.
5. **Costume, material and color studies | concept artists and art director, with technical artist review.** Compare economical costume shapes, limited palettes and rendering conventions. Personality must survive grayscale and removal of accessories. Review contrast against the Commons environment.
6. **Turnarounds and model sheets | character designer and modeler.** Produce consistent front, side, back and three-quarter views, scale reference, material callouts and construction notes. Resolve contradictions before detailed modeling.
7. **Expression and pose sheets | animator and rigger, reviewed by art director.** Show listening, uncertainty, overcommitment, reconsideration and satisfaction. Define neutral stance, characteristic gesture and movement rhythm. Include a brief collaborative interaction with the visitor.
8. **3D and rig tests | modeler, rigger and technical artist.** Create a simple blockout and deformation tests. Check silhouette from actual camera angles, facial range, hand/prop contact and export feasibility. Feed failures back into the drawings before final detail.
9. **Animation and runtime tests | animator and technical artist.** Test idle, greeting, thinking, correction and transition into an activity. Evaluate web performance, mobile legibility, reduced-motion alternatives and static fallback. Set measurable asset and runtime budgets before production assets.
10. **Cross-specialist revisions | art director coordinates all contributors.** Record findings, revisions and unresolved tradeoffs. Re-review the revised work; a single generation or a single reviewer is not completion.
11. **Consumer-products review | optional, only if physical products become relevant.** Check small-format reproduction, embroidery/plush/print constraints and recognizable identity. Do not make merchandise a dependency for the web experience.

Each pass must identify its author and separate reviewer, show alternatives where appropriate, and include concrete feedback plus the revised artifact. AI role-based reviews may assist but must be labeled as such, not represented as professional human review.

## Character-system deliverable

A concise illustrated guide defining:
- Shared head/body ratios and permitted ranges.
- Eye placement, face construction and expression logic.
- Silhouette families, limb/hand construction and scale.
- Costume complexity, palette rules, materials and rendering conventions.
- Movement rules and intentional personality-specific exceptions.
- Examples of related characters that remain distinguishable without color or accessories.

## Acceptance criteria

- [ ] Organizer identity and silhouette selected through documented alternatives and critique.
- [ ] Character reads at actual interface sizes, in silhouette and grayscale.
- [ ] Personality is evident through pose and behavior without explanatory slogans.
- [ ] Turnarounds, expressions and poses describe the same buildable character.
- [ ] Two contrasting supporting concepts demonstrate a coherent, non-repetitive cast system.
- [ ] Model, rig and animation tests resolve construction problems and document revisions.
- [ ] Technical art review covers mobile performance, accessibility and fallback behavior.
- [ ] Art director review records accepted decisions and remaining limitations.
- [ ] Final source files, sheets, test clips and design rules are organized for handoff.
- [ ] No character design is treated as approved solely because a generated image looks polished.

## Existing local explorations

- docs/design/COMMONS-STORYBOARD.md
- docs/design/commons-storyboard-v1.png
- docs/design/ORGANIZER-EXPLORATION.md
- docs/design/organizer-exploration-v1.png

These are working references in the local repository, not approved production assets or confirmed remote attachments. Preserve the existing filled, smoothly animated profile-history chart; this character task does not redefine assessment metrics.

## Out of scope

Frontend implementation, a full production cast, hiring or commissioning specialists, merchandise production, and new scoring claims. Track implementation separately after visual direction review.


## Status on 2026-09-12

Passes 1 to 10 have artifacts and reviews in `character-system/`. Start with
`character-system/README.md`. Every review is an AI review in a named role. The
acceptance criteria are assessed one by one in `character-system/10-revisions.md`.
Human art-director review is the next step. Pass 11 was not run.
