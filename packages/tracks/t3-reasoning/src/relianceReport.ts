/**
 * Presentation of T3's reliance measure — TEN-35.
 *
 * Not scoring. Nothing here reaches a point total; `score()` never imports
 * this file. It turns the counts already in a stored T3 raw record into the
 * lines a candidate is allowed to see: each rate with its interval, the band,
 * and the two warnings that must travel with the numbers.
 *
 * WHY IT EXISTS. `reliance.over` and `reliance.under` are estimated from at
 * most 8 planted errors and the correct-advice claims beside them. On 8 events
 * a rate near 0.5 carries a 95% interval about 0.57 wide, so 5 of 8 (0.31 to
 * 0.86) and 7 of 8 (0.53 to 0.98) sit inside each other's noise while 12.5 of
 * the 50 RSR points ride on the difference. A two-decimal rate on its own reads as a measurement it is not.
 * Every rate below therefore carries its interval, and the report says how
 * many events it rests on.
 *
 * Evidence, in short: no Cronbach α, ICC, split-half or test-retest figure
 * has been published for any behavioural reliance measure; the one direct
 * test-retest study of advice taking found ICC < 0.5 (Karvelis et al., PLoS
 * ONE 19(11):e0312255, 2024); behavioural difference scores — the shape of
 * `index = under − over` — are less reliable than their components (Hedge,
 * Powell & Sumner, Behav. Res. Methods 50:1166–1186, 2018; Enkavi et al.,
 * PNAS 2019, median contrast ICC 0.174).
 *
 * The band is the coarse reading, and it is the pair's band from
 * {@link relianceBand}. Per-tail bands were considered and dropped: they
 * would need a second cutline nobody has data for.
 */
import {
  proportionDifferenceInterval, relianceBand, RSR_MIN_SURFACED, wilsonInterval,
  type Interval, type RelianceBand,
} from "./scoring.js";

export interface RelianceRow {
  key: "over" | "under" | "index";
  label: string;
  /** The point estimate. Never rendered without {@link RelianceRow.interval}. */
  point: number;
  /** Two-sided 95% interval. Wilson for a rate, Newcombe for the index. */
  interval: Interval;
  /** The counts the row rests on, in words. */
  detail: string;
}

export interface RelianceReport {
  rows: RelianceRow[];
  band: RelianceBand;
  plantedSurfaced: number;
  adviceSurfaced: number;
  /** True when the form surfaced fewer than RSR_MIN_SURFACED planted errors. */
  underpowered: boolean;
  /** Set only when {@link RelianceReport.underpowered}. */
  underpoweredNote: string | null;
  precisionNote: string;
  reliabilityNote: string;
}

/** Signed two-decimal number with a typographic minus. */
export function formatRate(x: number): string {
  return `${x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}`;
}

/** "95% CI −0.12 to 0.63". */
export function formatInterval(i: Interval): string {
  return `95% CI ${formatRate(i.lo)} to ${formatRate(i.hi)}`;
}

const num = (raw: Record<string, number>, k: string): number =>
  typeof raw[k] === "number" ? raw[k] : 0;

/**
 * Build the reliance lines from a stored T3 raw record. Pure.
 *
 * Returns null for a record that carries no reliance counts, so a caller can
 * pass any track's raw record without branching on the track id.
 */
export function relianceReportFromRaw(raw: Record<string, number>): RelianceReport | null {
  if (typeof raw.plantedSurfaced !== "number" || typeof raw.adviceSurfaced !== "number") {
    return null;
  }
  const plantedSurfaced = num(raw, "plantedSurfaced");
  const plantedCaught = num(raw, "plantedCaught");
  const adviceSurfaced = num(raw, "adviceSurfaced");
  const adviceAdopted = num(raw, "adviceAdopted");
  // The two tails count FAILURES: errors swallowed, correct advice refused.
  const overCount = plantedSurfaced - plantedCaught;
  const underCount = adviceSurfaced - adviceAdopted;
  const over = plantedSurfaced > 0 ? overCount / plantedSurfaced : 0;
  const under = adviceSurfaced > 0 ? underCount / adviceSurfaced : 0;
  const underpowered = num(raw, "rsr.underpowered") === 1;
  return {
    rows: [
      {
        key: "over",
        label: "Over-reliance",
        point: over,
        interval: wilsonInterval(overCount, plantedSurfaced),
        detail: `${overCount} of ${plantedSurfaced} surfaced planted errors went unchallenged`,
      },
      {
        key: "under",
        label: "Under-reliance",
        point: under,
        interval: wilsonInterval(underCount, adviceSurfaced),
        detail: `${underCount} of ${adviceSurfaced} correct suggestions were not adopted`,
      },
      {
        key: "index",
        label: "Index (under − over)",
        point: under - over,
        interval: proportionDifferenceInterval(
          overCount, plantedSurfaced, underCount, adviceSurfaced,
        ),
        detail: "a difference of two rates, so it is the noisiest of the three",
      },
    ],
    band: relianceBand(over, under),
    plantedSurfaced,
    adviceSurfaced,
    underpowered,
    underpoweredNote: underpowered
      ? `This sitting surfaced ${plantedSurfaced} planted errors. The floor for reporting a rate is ` +
        `${RSR_MIN_SURFACED}. The over-reliance rate and the band rest on ${plantedSurfaced} events, ` +
        "so treat both as provisional."
      : null,
    precisionNote:
      `The rates come from ${plantedSurfaced} planted errors and ${adviceSurfaced} correct ` +
      "suggestions. Eight events cannot pin a rate: 5 of 8 is 0.63, " +
      `${formatInterval(wilsonInterval(5, 8))}, and 7 of 8 is 0.88, ` +
      `${formatInterval(wilsonInterval(7, 8))}. The two overlap. Read the band, not the ` +
      "second decimal.",
    reliabilityNote:
      "No reliability figure (Cronbach α, ICC, split-half or test-retest) has been published for " +
      "any behavioural reliance measure. The one direct test-retest study of advice taking put it in " +
      "the poor range, ICC below 0.5 (Karvelis et al., PLoS ONE 19(11):e0312255, 2024).",
  };
}
