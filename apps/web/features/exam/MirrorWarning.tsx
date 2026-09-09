"use client";
/**
 * The mirror is not writing — said out loud, for as long as it is true.
 *
 * `onSyncError` was declared by the persistence layer and never passed, so a
 * hosted sitting whose event log never reached the exam service looked
 * exactly like one that did: the candidate found out when the report could
 * not find their attempt (TEN-123). FRONTEND.md §1 is explicit — offline goes
 * to VISIBLE STATE.
 *
 * It is deliberately NOT dismissable. A candidate cannot fix this and has
 * nothing to decide; what they need is for the sentence to still be there
 * when the run ends. It clears itself on the next pass that lands, which is
 * the only honest way for it to go away.
 *
 * It subscribes to the layer itself rather than taking a prop, because the
 * exam page renders this chrome from five phase branches and threading one
 * more piece of state through all five is how the five drift.
 *
 * The subscription is the mirror's OWN status (`useSyncStatus`, TEN-206), not
 * a second store of the same fact: `failures > 0` means a pass has failed and
 * nothing has landed since, which is exactly the claim this sentence makes.
 * It stays up through the bounded retries (`pending`) as well as after they
 * run out (`failed`), because the candidate's situation is the same in both.
 */
import { useSyncStatus } from "../../lib/data/useSyncStatus";

export const MIRROR_WARNING_LABEL = "Not saved to the exam service";
export const MIRROR_WARNING_COPY =
  "Your work is saved in this browser, and the exam service has not confirmed the latest of it. "
  + "Keep going — Foray keeps trying, and this notice goes away by itself the moment a save lands. "
  + "Do not clear this browser's data, and do not finish the run in a different browser.";

export function MirrorWarning() {
  const { status } = useSyncStatus();
  if (status.failures === 0) return null;
  return (
    <div
      role="alert"
      data-testid="mirror-warning"
      style={{
        background: "var(--card)",
        border: "1px solid var(--bad)",
        borderLeft: "4px solid var(--bad)",
        color: "var(--bad)",
        padding: "0.6rem 0.9rem",
        borderRadius: 8,
        margin: "0.6rem auto",
        maxWidth: 980,
        fontSize: "0.85rem",
      }}
    >
      ⚠ {MIRROR_WARNING_LABEL}: {MIRROR_WARNING_COPY}
    </div>
  );
}
