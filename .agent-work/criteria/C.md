# Batch C — FROZEN acceptance criteria (written before implementation; a worker may NOT edit this file)

## TEN-215 — [P1] The credential and share panels read before identity arrives and never re-read, so a candidate who holds a credential is offered a fresh one

Both panels gate on `useIdentity().status !== "pending"` or go through `useService`, and a test mounts each with identity pending, publishes a signed-in identity, and asserts the read happens once, after the publish.

## TEN-221 — [P1] When the review read fails the report drops the calibration curve and the withheld-item disclosure and says nothing

The failure has a state and the T2 card says the answer key could not be read, so the calibration curve and the item-count check are not shown, with a test that fails the review fetch and asserts the sentence.

## TEN-233 — [P2] The partial-sitting share is offered although no partial payload shape exists

Either the panel is not offered for a partial sitting, or `SharePayload` gains a partial arm that the view and `generateMetadata` both branch on, with an end-to-end test.

## TEN-234 — [P2] Every non-2xx on issue, create, publish and revoke is reported as a transient network blip

The panels use the same refused/unreachable split, print the status and the service's reason, and do not offer a retry for a refusal that will not change. A 403 on issue and on create must not produce the try again in a moment wording.

## TEN-235 — [P2] The share-to-wall button has no timeout and no unmount guard, and its URL is hardcoded in two files

One constant for the demo gallery base, a request timeout, an unmount guard, and a distinct sentence for a 413 or 429.

## TEN-120 — Every track figure is drawn on a /100 axis, and no track is worth 100

(NONE STATED — coordinator must write one)

## TEN-119 — replayTrackScore will claim a local replay of a server-issued score, and print MISMATCH at a candidate

(NONE STATED — coordinator must write one)

## TEN-190 — [P1] The claim more than one bank version has been served renders yes when only one has

The threshold matches the sentence: yes at two or more, no at one, count shown either way. A fixture with one digest renders no.

## TEN-181 — [P0] The complete score of record gate clears on a single track manifest

Coverage is computed against the instrument the sitting claims, not against one track's own denominator. A fixture with a single complete t2 manifest renders partial or unknown and does not clear the gate.
