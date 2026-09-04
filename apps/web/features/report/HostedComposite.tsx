"use client";

/**
 * THE COMPOSITE ON A HOSTED REPORT (TEN-92).
 *
 * A hosted sitting's scores of record are the exam service's, and the browser
 * cannot derive the composite from them: the local event log is what the
 * browser can replay, and a server-issued score has no local evidence behind
 * it. So the service issues the composite too, and this is where it is shown.
 *
 * It renders one of exactly three things, because the service sends one of
 * exactly three answers:
 *
 *  1. ISSUED — the report's own composite card, marked as the service's, with
 *     the score rows it was derived from.
 *  2. WITHHELD — the reason, and the state of every track it waits on. A jury
 *     that has not reported reads differently from a track that was never sat,
 *     which is the point of sending the state at all.
 *  3. NOTHING READABLE — nothing here, and the report's lede says there is no
 *     composite. A composite the browser cannot read is never a zero.
 *
 * The static export has no exam service, so this renders nothing there.
 */
import { CompositeCard } from "./CompositeCard";
import { WITHHELD_LEDE, awaitingCopy, serviceCompositeView, withheldHeadline } from "./compositeView";
import type { AttemptScores } from "./scoresOfRecord";

export function HostedComposite({
  attemptId,
  scores,
}: {
  attemptId: string;
  scores: AttemptScores | null | undefined;
}) {
  // Nothing read yet, or no `scores` object at all: the scores panel below
  // already says so, and a second sentence about the same silence helps
  // nobody.
  if (scores === undefined || scores === null) return null;
  const composite = scores.composite;

  /* NO COMPOSITE FIELD, OR ONE THIS BUILD CANNOT READ. Both parse to null,
     and the browser cannot tell them apart without a flag nobody needs: a
     service too old to send the field and a malformed field are the same fact
     to a candidate, which is that this page has no composite to show. The
     lede above already says exactly that (`reportGate.ts`), so a second
     sentence here would be the same silence said twice. What must never
     happen is a zero, and there is no branch below that can produce one. */
  if (composite === null) return null;

  if (composite.state === "issued") {
    return (
      <section data-testid="hosted-composite" aria-label="Composite score">
        <CompositeCard view={serviceCompositeView(attemptId, composite)} />
      </section>
    );
  }

  return (
    <section
      className="card"
      data-testid="composite-withheld"
      data-reason={composite.reason}
      style={{ marginBottom: "2rem" }}
      aria-label="Composite score"
    >
      <h2 style={{ marginTop: 0 }}>{withheldHeadline(composite)}</h2>
      <p className="muted">{WITHHELD_LEDE[composite.reason]}</p>
      {composite.awaiting.map((a) => (
        <p
          key={a.trackId}
          className="small"
          data-testid={`composite-awaiting-${a.trackId}`}
          data-track-state={a.trackState}
          style={{ margin: "0.3rem 0 0" }}
        >
          {awaitingCopy(a)}
        </p>
      ))}
      {composite.detail === "" ? null : (
        <p className="faint small" style={{ margin: "0.6rem 0 0" }} data-testid="composite-withheld-detail">
          The exam service says: {composite.detail}
        </p>
      )}
    </section>
  );
}
