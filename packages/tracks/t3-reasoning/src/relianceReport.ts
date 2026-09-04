/**
 * Presentation of T3's reliance measure — TEN-35.
 *
 * Not scoring. Nothing here reaches a point total; `score()` never imports
 * this file. It turns the counts already in a stored T3 raw record into the
 * lines a candidate is allowed to see: each rate with its interval, the band,
 * and the two warnings that must travel with the numbers.
 *
 * WHY IT EXISTS. `reliance.over` and `reliance.under` are estimated from the
 * planted errors a form surfaces and the correct-advice claims beside them,
 * and the released form plants FOUR (TEN-91). On 4 events a rate near 0.5
 * carries a 95% interval about 0.70 wide: 2 of 4 is 0.50 (0.15 to 0.85) and
 * 3 of 4 is 0.75 (0.30 to 0.95), so two candidates 12.5 of the 50
 * planted-error points apart sit well inside each other's noise, decided by
 * one event. Eight is the number the evidence supports (Schemmer, Kuhl, Benz
 * & Satzger 2022 ran 8 incorrect + 8 correct per condition, arXiv:2204.06916)
 * and `ERROR_CATCH_MIN_SURFACED` still says so, so a four-plant sitting
 * reports as underpowered. A two-decimal rate on its own reads as a
 * measurement it is not. Every rate below therefore carries its interval, the
 * report says how many events it rests on, and the worked example in
 * `precisionNote` is computed from that count rather than written into the
 * sentence.
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
 * would need a second cutline nobody has data for. A tail with no events
 * withholds the band, because relianceBand(0, 0) reads "calibrated" and a
 * sitting that surfaced nothing has not shown that.
 */
import {
  ERROR_CATCH_MIN_SURFACED, proportionDifferenceInterval, relianceBand, wilsonInterval,
  type Interval, type RelianceBand,
} from "./scoring.js";

export interface RelianceRow {
  key: "over" | "under" | "index";
  label: string;
  /** False when a denominator is 0: the rate is undefined, not zero. */
  defined: boolean;
  /** The point estimate. Never rendered without {@link RelianceRow.interval}. */
  point: number;
  /** Two-sided 95% interval. Wilson for a rate, Newcombe for the index. */
  interval: Interval;
  /** The counts the row rests on, in words. */
  detail: string;
}

export interface RelianceReport {
  rows: RelianceRow[];
  /** Null when either tail has no events: the band would be a guess. */
  band: RelianceBand | null;
  plantedSurfaced: number;
  adviceSurfaced: number;
  /** True when the form surfaced fewer than ERROR_CATCH_MIN_SURFACED plants. */
  underpowered: boolean;
  /** Set only when {@link RelianceReport.underpowered}. */
  underpoweredNote: string | null;
  precisionNote: string;
  independenceNote: string;
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

/**
 * A count from a stored raw record, as a non-negative integer. A record that
 * arrived over the wire can carry anything; a fabricated rate is worse than a
 * missing one, so anything that is not a finite number reads as 0 and a
 * numerator is clamped to its denominator.
 */
const count = (raw: Record<string, number>, k: string, max = Number.POSITIVE_INFINITY): number => {
  const v = raw[k];
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(Math.max(0, Math.floor(v)), max);
};

/** "1 planted error", "8 planted errors". */
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const UNDEFINED_DETAIL = "nothing of this kind surfaced, so there is no rate to report";

/**
 * The worked example that shows how little a rate from `n` events pins down,
 * computed from the events the sitting actually had rather than from a number
 * written into the sentence (TEN-91: the form dropped from 8 plants to 4 and
 * this paragraph still said "eight events"). It compares the two adjacent
 * outcomes either side of the middle, because ONE event is the smallest thing
 * that can move the rate and the reader can check the arithmetic.
 *
 * Below two events there is no adjacent pair to show, so it says the plain
 * thing instead of inventing an illustration.
 */
function precisionIllustration(n: number): string {
  if (n < 2) {
    return "A rate from fewer than two events is not an estimate; read the interval, not the number.";
  }
  const lo = Math.floor(n / 2);
  const hi = lo + 1;
  return (
    `${n} ${n === 1 ? "event" : "events"} cannot pin a rate: ${lo} of ${n} is ` +
    `${formatRate(lo / n)}, ${formatInterval(wilsonInterval(lo, n))}, and ${hi} of ${n} is ` +
    `${formatRate(hi / n)}, ${formatInterval(wilsonInterval(hi, n))}. The two overlap, so one ` +
    "event moves the rate more than the second decimal means."
  );
}

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
  const plantedSurfaced = count(raw, "plantedSurfaced");
  const plantedCaught = count(raw, "plantedCaught", plantedSurfaced);
  const adviceSurfaced = count(raw, "adviceSurfaced");
  const adviceAdopted = count(raw, "adviceAdopted", adviceSurfaced);
  // The two tails count FAILURES: errors swallowed, correct advice refused.
  const overCount = plantedSurfaced - plantedCaught;
  const underCount = adviceSurfaced - adviceAdopted;
  const overDefined = plantedSurfaced > 0;
  const underDefined = adviceSurfaced > 0;
  const over = overDefined ? overCount / plantedSurfaced : 0;
  const under = underDefined ? underCount / adviceSurfaced : 0;
  // Derived, not trusted: a stored record with the flag missing or stale must
  // not silence the warning. The flag agreeing is asserted in the T3 scorer.
  // Only the current spelling is read. The two earlier spellings of this flag
  // (TEN-38, TEN-72) were never written by a production sitting, so a reader
  // for them would buy nothing and keep a dead name alive.
  const underpowered =
    raw["errorCatchRate.underpowered"] === 1 ||
    plantedSurfaced < ERROR_CATCH_MIN_SURFACED;
  return {
    rows: [
      {
        key: "over",
        label: "Over-reliance",
        defined: overDefined,
        point: over,
        interval: wilsonInterval(overCount, plantedSurfaced),
        detail: overDefined
          ? `${overCount} of ${plural(plantedSurfaced, "surfaced planted error", "surfaced planted errors")} went unchallenged`
          : UNDEFINED_DETAIL,
      },
      {
        key: "under",
        label: "Under-reliance",
        defined: underDefined,
        point: under,
        interval: wilsonInterval(underCount, adviceSurfaced),
        detail: underDefined
          ? `${underCount} of ${plural(adviceSurfaced, "correct suggestion", "correct suggestions")} was not adopted`
          : UNDEFINED_DETAIL,
      },
      {
        key: "index",
        label: "Index (under − over)",
        defined: overDefined && underDefined,
        point: under - over,
        interval: proportionDifferenceInterval(
          overCount, plantedSurfaced, underCount, adviceSurfaced,
        ),
        detail:
          overDefined && underDefined
            ? "a difference of two rates, so the noisiest of the three"
            : UNDEFINED_DETAIL,
      },
    ],
    // A tail with no events is not a zero rate, so the band is withheld
    // rather than reading "calibrated" off two missing denominators.
    band: overDefined && underDefined ? relianceBand(over, under) : null,
    plantedSurfaced,
    adviceSurfaced,
    underpowered,
    underpoweredNote: underpowered
      ? `This sitting surfaced ${plural(plantedSurfaced, "planted error", "planted errors")}. ` +
        "The floor for reporting a rate is " +
        `${ERROR_CATCH_MIN_SURFACED}. The over-reliance rate and the band rest on ` +
        `${plural(plantedSurfaced, "event", "events")}, so treat both as provisional.`
      : null,
    precisionNote:
      `The rates come from ${plural(plantedSurfaced, "planted error", "planted errors")} and ` +
      `${plural(adviceSurfaced, "correct suggestion", "correct suggestions")}. ` +
      precisionIllustration(plantedSurfaced),
    independenceNote:
      "The intervals assume the events are independent. People tend to form one policy about " +
      "trusting the assistant rather than judging each claim on its own (Buçinca, Malaya & " +
      "Gajos, CSCW 2021), so the true interval is wider than the one shown, not narrower.",
    reliabilityNote:
      "How stable this result is across repeat sittings has not been measured. No reliability " +
      "figure (Cronbach α, ICC, split-half or test-retest) has been published for any " +
      "behavioural reliance measure, and the one direct test-retest study of advice taking put it " +
      "in the poor range, ICC below 0.5 (Karvelis et al., PLoS ONE 19(11):e0312255, 2024).",
  };
}
