/**
 * Progression and streaks — PURE derivation over already-stored facts.
 *
 * Two product rules are encoded here rather than in the UI, so they are
 * testable without a database and impossible to fake from a browser:
 *
 *  1. A STREAK IS DERIVED, NEVER ASSERTED. Everything below is a function of
 *     a list of local practice DAYS plus "today". The backend produces that
 *     list from `practice_sessions` rows the server itself stamped; a client
 *     can post answers, never a streak. (FRONTEND.md §4.7.)
 *  2. PROGRESSION IS HONEST OR ABSENT. The judging pipeline (spec Phase 4)
 *     is not built and `scores` is empty, so nothing here emits a percentile,
 *     a composite, a cohort rank or a judged result. Practice accuracy is
 *     practice accuracy; a sitting's track values are that run's OWN scorer
 *     output mirrored from its event log, which is advisory and labelled as
 *     such wherever it is drawn (`PROGRESS_BASIS`).
 *
 * No clock, no I/O: `now` is injected everywhere it is needed.
 */
import { TRACK_IDS, type TrackId, type TrackRawScores } from "@ailx/session";

// ---------------------------------------------------------------------------
// Local days
// ---------------------------------------------------------------------------

/**
 * Timezone bounds for a self-reported UTC offset, in minutes.
 *
 * A participant's own calendar day is the only fair unit for a daily streak —
 * a UTC day punishes anyone east of Greenwich for practising in the evening.
 * The offset is the ONE thing the client tells us about a streak, so it is
 * clamped to the real range of civil offsets (UTC-12 .. UTC+14). The worst a
 * liar can do is move their day boundary within that window, which is exactly
 * what actually travelling would do; it cannot manufacture a day, because the
 * DAY IS DERIVED FROM THE SERVER TIMESTAMP, never from a client one.
 */
export const TZ_OFFSET_MIN = -12 * 60;
export const TZ_OFFSET_MAX = 14 * 60;

/** Clamp to a legal civil offset; anything unusable becomes UTC. */
export function clampTzOffset(offset: unknown): number {
  if (typeof offset !== "number" || !Number.isFinite(offset)) return 0;
  return Math.min(TZ_OFFSET_MAX, Math.max(TZ_OFFSET_MIN, Math.trunc(offset)));
}

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a calendar day this module can do arithmetic on?
 *
 * Well-SHAPED is not enough: "2026-13-45" matches the pattern and is not a
 * date, and a day that is not a date poisons every gap calculation
 * downstream. Exported because the daily challenge (./daily.ts) reads days
 * out of the same untrusted place — a browser's localStorage — and two
 * copies of "what a day is" is how two streaks end up disagreeing.
 */
export function isCalendarDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DAY_RE.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/** The participant's local calendar day (YYYY-MM-DD) for a server instant. */
export function localDay(epochMs: number, tzOffsetMinutes: number): string {
  const shifted = new Date(epochMs + clampTzOffset(tzOffsetMinutes) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** `day` shifted by n days, as YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// What counts as a day of practice
// ---------------------------------------------------------------------------

/**
 * A session counts towards the streak only if it was actually PLAYED.
 *
 * Both floors exist to defeat the same cheap attack — open the drill, mash a
 * key, own the day:
 *  - `PRACTICE_MIN_ANSWERS` — the whole dealt deck, so abandoning halfway
 *    never counts;
 *  - `PRACTICE_MIN_ELAPSED_MS` — measured SERVER-side between the session's
 *    own start and submit, so a scripted instant submit never counts however
 *    honest its client timestamps look.
 *
 * Accuracy is deliberately NOT a condition. This is training: being wrong is
 * the point of the feedback, and a streak that demanded correctness would
 * push people to look answers up instead of learning the tell.
 */
export const PRACTICE_MIN_ANSWERS = 6;
export const PRACTICE_MIN_ELAPSED_MS = 15_000;

export interface PracticeQualification {
  counted: boolean;
  /** Machine-readable reason when it does not count — shown verbatim, kindly. */
  reason: "ok" | "incomplete" | "too_fast";
}

export function qualifiesForStreak(input: {
  answered: number;
  elapsedMs: number;
}): PracticeQualification {
  if (input.answered < PRACTICE_MIN_ANSWERS) return { counted: false, reason: "incomplete" };
  if (input.elapsedMs < PRACTICE_MIN_ELAPSED_MS) return { counted: false, reason: "too_fast" };
  return { counted: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// The streak rule
// ---------------------------------------------------------------------------

/**
 * Rest days. A streak survives ONE missed day, and may only spend a rest day
 * if it has not spent one in the previous `REST_WINDOW_DAYS` days.
 *
 * The point is that a streak should reward a habit, not punish a life. A
 * zero-tolerance streak makes one bad evening delete months, which is the
 * mechanic that turns an instrument into a slot machine — and spec §13 is
 * explicit that the tone here is a well-made instrument, not a mobile game.
 * One rest per week is generous enough to survive travel and illness and
 * tight enough that "practised most days" stays true of anyone with a streak.
 */
export const REST_DAYS_PER_WINDOW = 1;
export const REST_WINDOW_DAYS = 7;

/** One unbroken run of practice days, with the rest days it spent. */
export interface PracticeRun {
  days: string[];
  restDays: string[];
}

/** A rest day may be spent only if none was spent inside the window. */
function canRest(day: string, restDays: readonly string[]): boolean {
  const recent = restDays.filter((r) => Math.abs(daysBetween(r, day)) < REST_WINDOW_DAYS);
  return recent.length < REST_DAYS_PER_WINDOW;
}

/**
 * Split practice days into runs under the rest rule. Input may be unsorted
 * and may repeat a day; output runs are sorted and de-duplicated.
 *
 * ONE implementation of the rule, forwards. `streakSummary` reads current and
 * best off the same runs, so the two numbers can never disagree.
 */
export function practiceRuns(days: readonly string[]): PracticeRun[] {
  const sorted = [...new Set(days.filter((d) => isCalendarDay(d)))].sort();
  const runs: PracticeRun[] = [];
  for (const day of sorted) {
    const run = runs[runs.length - 1];
    const prev = run?.days[run.days.length - 1];
    if (run === undefined || prev === undefined) {
      runs.push({ days: [day], restDays: [] });
      continue;
    }
    const gap = daysBetween(prev, day);
    if (gap === 1) {
      run.days.push(day);
    } else if (gap === 2 && canRest(addDays(prev, 1), run.restDays)) {
      run.restDays.push(addDays(prev, 1));
      run.days.push(day);
    } else {
      runs.push({ days: [day], restDays: [] });
    }
  }
  return runs;
}

export interface StreakSummary {
  /** Days in the run that is still alive today; 0 when the streak is broken. */
  current: number;
  /** Longest run ever recorded. NEVER decreases — a break costs the current
   *  streak, not the record (see the module note on tone). */
  best: number;
  /** Distinct days practised, ever. Also monotone. */
  totalDays: number;
  /** Most recent practice day, or null. */
  lastDay: string | null;
  /** True once today's practice is in. */
  practisedToday: boolean;
  /**
   * True when missing today would still leave the streak alive tomorrow —
   * the UI says this out loud instead of implying loss.
   */
  restDayAvailable: boolean;
}

/**
 * Current and best streak for a participant.
 *
 * Today is never counted against anyone: the day is still open, so a streak
 * whose last day is yesterday is ALIVE (at full length), and one whose last
 * day is the day before yesterday is alive too if a rest day can cover the
 * gap. Only when neither holds does `current` fall to 0.
 */
export function streakSummary(days: readonly string[], today: string): StreakSummary {
  const runs = practiceRuns(days);
  const best = runs.reduce((m, r) => Math.max(m, r.days.length), 0);
  const totalDays = runs.reduce((n, r) => n + r.days.length, 0);
  const last = runs[runs.length - 1];
  const lastDay = last?.days[last.days.length - 1] ?? null;

  let current = 0;
  let restDayAvailable = false;
  if (last !== undefined && lastDay !== null) {
    const behind = daysBetween(lastDay, today);
    const alive =
      behind === 0 ||
      behind === 1 ||
      (behind === 2 && canRest(addDays(lastDay, 1), last.restDays));
    if (alive) {
      current = last.days.length;
      // Could tomorrow still be reached without practising today?
      const restDays = behind === 2 ? [...last.restDays, addDays(lastDay, 1)] : last.restDays;
      restDayAvailable = canRest(today, restDays);
    }
  }
  return {
    current,
    best,
    totalDays,
    lastDay,
    practisedToday: lastDay === today,
    restDayAvailable,
  };
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

/** One local day of practice, already counted by the backend. */
export interface PracticeDayCounts {
  day: string;
  sessions: number;
  answered: number;
  correct: number;
}

export interface PracticeDayPoint extends PracticeDayCounts {
  /** correct / answered, 0-1. Null when nothing was answered. */
  accuracy: number | null;
}

/** One scored sitting of the real instrument, oldest first. */
export interface SittingPoint {
  attemptId: string;
  /** ISO date (UTC) the run started. */
  startedOn: string;
  scores: TrackRawScores;
}

/** Enough practice before a trend line means anything. */
export const MIN_TREND_DAYS = 3;
/** Enough answers before an accuracy number means anything. */
export const MIN_TREND_ANSWERS = 12;

/**
 * The one sentence every progression figure is qualified by. Exported so the
 * page and its tests share a single wording (DRY) and it cannot drift.
 *
 * It used to say practice answers are "graded on the server", full stop. That
 * was false for the anonymous on-ramp: a signed-out round is recorded only in
 * the browser's own ledger (`localPractice.ts`, and the drill's
 * `recorded = server && signed-in` rule), so the service has nothing to grade
 * and /progress could only ever show zero while /practice showed a streak
 * (TEN-132). Both places a practice day can live are now named.
 */
export const PROGRESS_BASIS =
  "Counted from what you actually did. Practice you finish while signed in is recorded and "
  + "graded by the exam service. Practice you do signed out is kept by your browser and never "
  + "reaches the service, so only that browser can show it. Each sitting's figures are that "
  + "run's own scorer output from its stored event log. No percentile, no composite and "
  + "no judged result — the judging pipeline is not built yet, so a number implying one "
  + "would be a claim we cannot back.";

/**
 * What a movement in practice accuracy is, and — much more important — what
 * it is not. Exported so /progress and its tests share ONE wording (DRY),
 * like `PROGRESS_BASIS`.
 *
 * Two reasons a rising practice percentage is not an ability gain:
 *
 *  1. The practice corpus is SMALL and repeats. A rise is partly recognition
 *     of pictures whose answer you have already been shown — memorisation of
 *     the deck, which is why the transfer design in docs/TRANSFER-STUDY.md
 *     measures HELD-OUT generators instead.
 *  2. Accuracy conflates sensitivity with criterion. Gray et al. 2025 and the
 *     Diel et al. (2024) meta-analysis (k = 137, N = 86,155) both find this
 *     literature's accuracy movements are dominated by criterion shift, with
 *     pooled d' indistinguishable from chance. Somebody who simply became
 *     readier to say "AI" produces exactly the same rising percentage as
 *     somebody whose eyes got better, and a product that calls both
 *     "improvement" manufactures confidence it cannot back.
 */
export const PRACTICE_ACCURACY_CAVEAT =
  "This is your hit rate on a small corpus you meet again and again, so part of any rise is "
  + "recognising pictures you have already been given the answer to. It also cannot tell a "
  + "better eye from a greater readiness to call something AI — both look the same in a "
  + "percentage. Read it as a record of what you did here, not as your detection getting better.";

/**
 * A movement between two figures. The name is the WIRE name and is kept for
 * the service contract; read it as "what changed", never as "what improved" —
 * a negative delta is as legitimate an entry as a positive one, and
 * `PRACTICE_ACCURACY_CAVEAT` governs how the practice subject may be shown.
 */
export interface Improvement {
  /** 'practice' or a track id. */
  subject: "practice" | TrackId;
  label: string;
  /** Percentage points, positive or negative; already rounded. */
  delta: number;
  from: number;
  to: number;
}

export interface ProgressReport {
  streak: StreakSummary;
  practice: PracticeDayPoint[];
  /** Accuracy over the first vs the last half of answered practice, or null. */
  practiceAccuracy: { early: number; recent: number; answered: number } | null;
  sittings: SittingPoint[];
  /** Only what genuinely moved; empty is a legitimate answer. */
  improvements: Improvement[];
  basis: string;
  /** Why a figure is missing, so the page never shows a silent blank. */
  notEnoughYet: { practice: boolean; sittings: boolean };
}

/** Halve the answered stream by ANSWERS (not days) so one big day cannot own both halves. */
function accuracyHalves(
  points: readonly PracticeDayPoint[],
): { early: number; recent: number; answered: number } | null {
  const answered = points.reduce((n, p) => n + p.answered, 0);
  if (answered < MIN_TREND_ANSWERS) return null;
  const half = answered / 2;
  let seen = 0;
  let earlyCorrect = 0;
  let earlyAnswered = 0;
  for (const p of points) {
    if (p.answered === 0) continue;
    // Split a straddling day proportionally rather than dropping it.
    const take = Math.max(0, Math.min(p.answered, half - seen));
    earlyAnswered += take;
    earlyCorrect += (p.correct / p.answered) * take;
    seen += p.answered;
  }
  const lateAnswered = answered - earlyAnswered;
  const totalCorrect = points.reduce((n, p) => n + p.correct, 0);
  if (earlyAnswered === 0 || lateAnswered === 0) return null;
  return {
    early: Math.round((earlyCorrect / earlyAnswered) * 100),
    recent: Math.round(((totalCorrect - earlyCorrect) / lateAnswered) * 100),
    answered,
  };
}

/** Round-trip-safe percentage-point delta. */
const delta = (from: number, to: number): number => Math.round(to - from);

/**
 * Assemble the personal progression view. Everything is derived; nothing is
 * invented, and a figure with too little behind it is `null`, never a zero
 * dressed up as a measurement.
 */
export function progressReport(input: {
  days: readonly PracticeDayCounts[];
  sittings: readonly SittingPoint[];
  today: string;
  trackName: (track: TrackId) => string;
}): ProgressReport {
  const practice: PracticeDayPoint[] = [...input.days]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => ({ ...d, accuracy: d.answered === 0 ? null : d.correct / d.answered }));

  const streak = streakSummary(
    practice.filter((p) => p.sessions > 0).map((p) => p.day),
    input.today,
  );
  const practiceAccuracy = accuracyHalves(practice);
  const sittings = [...input.sittings].sort((a, b) => a.startedOn.localeCompare(b.startedOn));

  const improvements: Improvement[] = [];
  if (practiceAccuracy !== null && practiceAccuracy.recent !== practiceAccuracy.early) {
    improvements.push({
      subject: "practice",
      label: "Practice accuracy",
      delta: delta(practiceAccuracy.early, practiceAccuracy.recent),
      from: practiceAccuracy.early,
      to: practiceAccuracy.recent,
    });
  }
  if (sittings.length >= 2) {
    const first = sittings[0];
    const latest = sittings[sittings.length - 1];
    for (const track of TRACK_IDS) {
      const from = Math.round(first.scores[track]);
      const to = Math.round(latest.scores[track]);
      if (from === to) continue;
      improvements.push({ subject: track, label: input.trackName(track), delta: delta(from, to), from, to });
    }
  }
  improvements.sort((a, b) => b.delta - a.delta);

  return {
    streak,
    practice,
    practiceAccuracy,
    sittings,
    improvements,
    basis: PROGRESS_BASIS,
    notEnoughYet: {
      practice: practice.filter((p) => p.sessions > 0).length < MIN_TREND_DAYS,
      sittings: sittings.length < 2,
    },
  };
}
