/**
 * The dealt items the exam service can no longer serve — TEN-68.
 *
 * A withdrawn item still happened. The candidate saw it, answered it and was
 * scored on it, and the exposure ledger retiring it afterwards changes none
 * of that (TEN-61). So the report states the item, the reason and the count,
 * and it does not pretend the deck was ever shorter than it was.
 *
 * What it cannot state is the material: a withheld entry arrives with no
 * stem, no options, no key and no rationale, because those bytes have left
 * custody. `apps/web/test/withheldItems.test.tsx` asserts the absence.
 */
import type { WithheldItem } from "@ailx/contract";

/** Why this item is not shown. The two reasons are not the same fact. */
function reasonOf(item: WithheldItem): string {
  return item.withheld === "withdrawn"
    ? "withdrawn from the bank"
    : "missing from the bank; the ledger does not record why";
}

/**
 * `dealt` is every item the sitting was dealt, withheld ones included — the
 * only honest denominator, and the reason this component takes it rather
 * than counting what it was given.
 */
export function WithheldItems({
  dealt,
  withheld,
}: {
  dealt: number;
  withheld: readonly WithheldItem[];
}) {
  if (withheld.length === 0) return null;
  const many = withheld.length > 1;
  return (
    <section
      data-testid="t2-withheld"
      aria-labelledby="withheld-heading"
      style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.8rem" }}
    >
      <h4 id="withheld-heading" style={{ margin: 0, fontSize: "0.9rem" }}>
        Withdrawn after your sitting
      </h4>
      <p className="small muted" style={{ margin: "0.2rem 0 0.6rem" }} data-testid="withheld-note">
        {withheld.length} of the {dealt} items you were dealt {many ? "are" : "is"} no longer in
        the item bank. Your {many ? "answers" : "answer"} to {many ? "them" : "it"}{" "}
        {many ? "are" : "is"} recorded and still {many ? "count" : "counts"} toward this score. We
        do not show material the bank no longer holds.
      </p>
      <ul className="small mono" style={{ margin: 0, paddingLeft: "1.1rem" }}>
        {withheld.map((item) => (
          <li key={item.id} data-withheld-item={item.id} style={{ margin: "0.2rem 0" }}>
            {item.id} · {reasonOf(item)} ·{" "}
            {item.yourChoice === undefined ? "no answer was recorded" : "your answer is recorded"}
          </li>
        ))}
      </ul>
      <p className="faint small mono" style={{ margin: "0.5rem 0 0" }} data-testid="withheld-count">
        {dealt} items dealt · {withheld.length} withheld · {dealt - withheld.length} in the bank
      </p>
    </section>
  );
}
