/**
 * The `withheld` arm of the exam service's redacted item view.
 *
 * An item the sitting DEALT that the served bank no longer carries comes back
 * as `{ phase: "withheld" }` with its id, the candidate's own recorded choice
 * and the reason — no stem, no options, no key, no rationale, because those
 * bytes have left custody and that is what a withdrawal means (TEN-61).
 *
 * Only this arm is spelled here. The PRESENTED arms are per-track content
 * (`T2PresentedItem` in `@ailx/track-t2`), and the browser already validates
 * them there; what the browser had no name for was the arm that carries no
 * content at all, so a review with a withdrawn item rendered five items where
 * six were sat (TEN-68).
 */

/**
 * `withdrawn` — the exposure ledger retired or demoted the item.
 * `unavailable` — it is missing and the ledger does not say why. A different
 * fact, and it must not be dressed up as the first.
 */
export const WITHHELD_REASONS = ["withdrawn", "unavailable"] as const;

export type WithheldReason = (typeof WITHHELD_REASONS)[number];

/**
 * One dealt item whose material the service can no longer serve.
 *
 * A type alias rather than an interface so it keeps an implicit index
 * signature: the browser reads the wire as `Record<string, unknown>`, and
 * {@link isWithheldItem} has to narrow that array without a cast.
 */
export type WithheldItem = {
  phase: "withheld";
  id: string;
  withheld: WithheldReason;
  /** The candidate's own recorded choice, when they answered. Review only. */
  yourChoice?: number;
};

/**
 * True when this wire item is the withheld arm. Checked field by field rather
 * than cast: the browser is reading a foreign response, and an entry that
 * claims `phase: "withheld"` without a usable id or a reason we can name is
 * not a thing we can honestly show a candidate.
 */
export function isWithheldItem(raw: unknown): raw is WithheldItem {
  if (typeof raw !== "object" || raw === null) return false;
  const it = raw as Record<string, unknown>;
  return (
    it.phase === "withheld" &&
    typeof it.id === "string" &&
    it.id.length > 0 &&
    WITHHELD_REASONS.includes(it.withheld as WithheldReason)
  );
}
