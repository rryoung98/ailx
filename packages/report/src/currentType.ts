/**
 * The CURRENT type — derived on read from a history of typed runs, never
 * stored (docs/ADR-profile-and-type.md §7).
 *
 * The founder's rule is that a person's type CHANGES OVER TIME, so the stored
 * object is every typed run they have had and "current" is arithmetic over the
 * newest few. Nothing here reads a clock, a store or a random number: it takes
 * readings and returns a type, which is why both repositories can run it and
 * get the identical answer.
 *
 * WHY THREE RUNS. One run is the noisiest estimator available for exactly the
 * people the ADR measured: 62.2% of the demo cohort (N = 44) has at least one
 * letter within a quarter of a standard deviation of its own cutline.
 * Averaging three readings shrinks the standard error by 1/sqrt(3) = 0.577, so
 * the band carrying the same flip risk narrows from 0.25 SD to 0.144 SD and
 * the fragile share falls from about 63% to about 44%. It HELPS and it does
 * NOT fix it, which is why the undecided band of §4.2 survives the smoothing
 * rather than being replaced by it.
 *
 * WHAT THE MEAN COSTS, said plainly: a genuine change takes two runs to show
 * up in the letter, so the mean LAGS. The `moving` flag is the whole
 * mitigation — an axis whose newest run disagrees with the mean is rendered
 * UNDECIDED whatever its strength, so the disagreement is visible immediately
 * instead of being averaged into silence.
 */
import { TRACK_IDS, type TrackId } from "@ailx/session";
import { POLE_UNDECIDED_STRENGTH, type Pole, poleAt, poleValue, typeName } from "./playerType.js";

/** How many FULL readings the mean is taken over, once that many exist. */
export const CURRENT_TYPE_WINDOW = 3;

/**
 * One stored axis reading. The four-letter code is NOT stored anywhere: a
 * letter is a rendering of `high`, and `strength` and `evidence` are the only
 * things that make the letter defensible (§4.1).
 */
export interface AxisReading {
  readonly track: TrackId;
  readonly high: boolean;
  /** 50-100, toward the chosen pole. */
  readonly strength: number;
  /** The measured quantity this pole was read from, in words. */
  readonly evidence: string;
}

/**
 * One typed run. `at` is an ISO stamp; `axes` carries one to four readings,
 * because a partial sitting is a different object from a full one and must
 * stay one (§6.2).
 */
export interface TypeReading {
  readonly id?: string;
  readonly at: string;
  readonly axes: readonly AxisReading[];
}

/** A rendered axis: the pole, plus the two things a card must not hide. */
export interface DerivedPole extends Pole {
  /** Strength below the threshold, or an axis whose newest run disagrees. */
  readonly undecided: boolean;
  /** The newest run read the other letter from the mean of the window. */
  readonly moving: boolean;
  /** The letter this axis held in the previous reading, when there is one. */
  readonly previousLetter: string | null;
}

export interface CurrentType {
  readonly axes: readonly DerivedPole[];
  /** Four letters, or `null` when the reading is partial — never invented. */
  readonly code: string | null;
  readonly name: string | null;
  readonly tagline: string | null;
  /** Fewer than four axes: no code, no character. */
  readonly partial: boolean;
  readonly axisCount: number;
  readonly movingAxes: readonly TrackId[];
  /** How many readings the mean was taken over: 1, or `CURRENT_TYPE_WINDOW`. */
  readonly runCount: number;
  /** The stamp of the newest reading the answer was derived from. */
  readonly at: string;
}

/** Track order is the axis order everywhere: t1, t2, t3, t4. */
const trackOrder = (t: TrackId): number => TRACK_IDS.indexOf(t);

const isFinitePercent = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;

/**
 * A reading, cleaned: at most one axis per track, in track order, every axis
 * carrying a usable strength. A row that arrives with two `t2` entries is read
 * as its FIRST one rather than refused — the alternative is a profile page
 * that 500s over a row nobody can repair — and the duplicate is dropped, never
 * averaged into the same axis twice.
 */
function cleaned(reading: TypeReading): { at: string; time: number; axes: AxisReading[] } | null {
  const seen = new Map<TrackId, AxisReading>();
  for (const axis of reading.axes ?? []) {
    if (axis === undefined || axis === null || !TRACK_IDS.includes(axis.track)) continue;
    if (typeof axis.high !== "boolean" || !isFinitePercent(axis.strength)) continue;
    if (!seen.has(axis.track)) seen.set(axis.track, axis);
  }
  if (seen.size === 0) return null;
  const time = new Date(reading.at).getTime();
  return {
    at: reading.at,
    time: Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time,
    axes: [...seen.values()].sort((a, b) => trackOrder(a.track) - trackOrder(b.track)),
  };
}

type CleanReading = NonNullable<ReturnType<typeof cleaned>>;

const letterOf = (axis: AxisReading): string => poleAt(axis.track, poleValue(axis), "").letter;

/** The letter this track held in the newest reading OLDER than `from`. */
function previousLetter(history: readonly CleanReading[], from: number, track: TrackId): string | null {
  for (let i = from + 1; i < history.length; i += 1) {
    const axis = history[i].axes.find((a) => a.track === track);
    if (axis !== undefined) return letterOf(axis);
  }
  return null;
}

function assemble(axes: readonly DerivedPole[], at: string, runCount: number): CurrentType {
  const ordered = [...axes].sort((a, b) => trackOrder(a.track) - trackOrder(b.track));
  const partial = ordered.length < TRACK_IDS.length;
  const code = partial ? null : ordered.map((a) => a.letter).join("");
  const named = code === null ? null : typeName(code);
  return {
    axes: ordered,
    code,
    name: named?.name ?? null,
    tagline: named?.tagline ?? null,
    partial,
    axisCount: ordered.length,
    movingAxes: ordered.filter((a) => a.moving).map((a) => a.track),
    runCount,
    at,
  };
}

/**
 * The current type, or `null` when there is nothing to read one from.
 *
 * `null` is the answer for a person who has signed in and never sat: a profile
 * exists, and it carries no type. A grey box implying a type is loading would
 * be the lie (§6.3).
 *
 * The rule, in order:
 *  - fewer than three FULL readings: the most recent full reading, unchanged;
 *  - three or more: per axis, the mean position over the last three, with an
 *    axis whose newest run disagrees flagged `moving` and rendered undecided;
 *  - no full reading at all: the most recent PARTIAL reading, unchanged, with
 *    no code and no character. Two axes are not four and are never smoothed
 *    into a fifth thing.
 *
 * Readings may arrive in any order; they are sorted newest-first here rather
 * than trusted, because a store read without `ORDER BY` used to change a score
 * by a rounding step in this codebase and the same class of bug would silently
 * pick a different "most recent run" here.
 */
export function currentType(readings: readonly TypeReading[]): CurrentType | null {
  const history = (readings ?? [])
    .map(cleaned)
    .filter((r): r is CleanReading => r !== null)
    .sort((a, b) => b.time - a.time);
  if (history.length === 0) return null;

  const full = history.filter((r) => r.axes.length === TRACK_IDS.length);

  // No full reading: the newest partial one, unchanged.
  if (full.length === 0) {
    const newest = history[0];
    return assemble(
      newest.axes.map((axis) => {
        const pole = poleAt(axis.track, poleValue(axis), axis.evidence);
        return {
          ...pole,
          undecided: pole.strength < POLE_UNDECIDED_STRENGTH,
          moving: false,
          previousLetter: previousLetter(history, 0, axis.track),
        };
      }),
      newest.at,
      1,
    );
  }

  const newestFull = full[0];
  const newestIndex = history.indexOf(newestFull);

  // One or two full readings: no mean. Two points do not average into a
  // trend, and pretending they do would hide the very first move.
  if (full.length < CURRENT_TYPE_WINDOW) {
    return assemble(
      newestFull.axes.map((axis) => {
        const pole = poleAt(axis.track, poleValue(axis), axis.evidence);
        return {
          ...pole,
          undecided: pole.strength < POLE_UNDECIDED_STRENGTH,
          moving: false,
          previousLetter: previousLetter(history, newestIndex, axis.track),
        };
      }),
      newestFull.at,
      1,
    );
  }

  const window = full.slice(0, CURRENT_TYPE_WINDOW);
  return assemble(
    newestFull.axes.map((axis) => {
      const values = window.map((r) => {
        const a = r.axes.find((x) => x.track === axis.track);
        // `full` means all four tracks are present, so this cannot miss.
        return poleValue(a as AxisReading);
      });
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const pole = poleAt(
        axis.track,
        mean,
        `${axis.evidence} (read from your last ${CURRENT_TYPE_WINDOW} runs)`,
      );
      const moving = pole.letter !== letterOf(axis);
      return {
        ...pole,
        // A moving axis is undecided WHATEVER its strength: the mean and the
        // newest run disagree, and a confident letter over a disagreement is
        // the overclaim §4.2 exists to refuse.
        undecided: moving || pole.strength < POLE_UNDECIDED_STRENGTH,
        moving,
        previousLetter: previousLetter(history, newestIndex, axis.track),
      };
    }),
    newestFull.at,
    CURRENT_TYPE_WINDOW,
  );
}
