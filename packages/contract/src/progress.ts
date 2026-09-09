/**
 * The PROGRESS and WORLD wire contracts — the two success bodies `/progress`
 * and `/aggregates` promise, as schemas rather than as casts.
 *
 * They are here for the reason `gallery.ts` gives: a body the browser cannot
 * recognise is an outage, not a shape to coerce. Until TEN-216 exactly ONE
 * route validated its body, so any wire drift between this repo and the
 * private service — which AGENTS.md guarantees deploy on separate clocks —
 * threw a TypeError into the root error boundary during render, and the
 * sentence written for that case (`SERVICE_INVALID_COPY`) was never shown.
 *
 * The TypeScript types stay in `@ailx/report`, which is where the pure
 * derivations that BUILD these bodies live. These schemas are checked against
 * them by `satisfies z.ZodType<...>`, so a field that is added there and not
 * here fails to compile rather than failing in a browser.
 *
 * STRICT, like every other schema in this package: an unknown key means the
 * two sides disagree about what this route answers, and quietly rendering the
 * half we recognise is how that disagreement stays invisible.
 */
import { z } from "zod";
import type {
  Improvement,
  ProgressReport,
  StreakSummary,
  WorldAggregates,
} from "@ailx/report";
import { AXIS_TRACKS, type AxisTrack } from "./gallery.js";

/** The four track ids, spelled ONCE — `AXES` in `@ailx/report` is the source. */
const trackId = z.enum(AXIS_TRACKS as unknown as [AxisTrack, ...AxisTrack[]]);

/** Four aggregate 0-100 values, one per track. Never per item. */
const trackScores = z.strictObject(
  Object.fromEntries(AXIS_TRACKS.map((t) => [t, z.number()])) as Record<AxisTrack, z.ZodNumber>,
);

const streakSchema = z.strictObject({
  current: z.number(),
  best: z.number(),
  totalDays: z.number(),
  lastDay: z.string().nullable(),
  practisedToday: z.boolean(),
  restDayAvailable: z.boolean(),
}) satisfies z.ZodType<StreakSummary>;

const practiceDaySchema = z.strictObject({
  day: z.string(),
  sessions: z.number(),
  answered: z.number(),
  correct: z.number(),
  accuracy: z.number().nullable(),
});

const sittingSchema = z.strictObject({
  attemptId: z.string(),
  startedOn: z.string(),
  scores: trackScores,
});

const improvementSchema = z.strictObject({
  subject: z.union([z.literal("practice"), trackId]),
  label: z.string(),
  delta: z.number(),
  from: z.number(),
  to: z.number(),
}) satisfies z.ZodType<Improvement>;

export const progressReportSchema = z.strictObject({
  streak: streakSchema,
  practice: z.array(practiceDaySchema),
  practiceAccuracy: z
    .strictObject({ early: z.number(), recent: z.number(), answered: z.number() })
    .nullable(),
  sittings: z.array(sittingSchema),
  improvements: z.array(improvementSchema),
  basis: z.string(),
  notEnoughYet: z.strictObject({ practice: z.boolean(), sittings: z.boolean() }),
}) satisfies z.ZodType<ProgressReport>;

/**
 * `GET /progress`. `claimedDays` is OPTIONAL on the wire and stays optional
 * here: it is the days an account already holds, and a build with no
 * practice claim simply does not send it.
 */
export const progressResponseSchema = z.strictObject({
  progress: progressReportSchema,
  claimedDays: z.array(z.string()).optional(),
});

const participationSchema = z.strictObject({
  participants: z.number(),
  attemptsStarted: z.number(),
  attemptsFinalized: z.number(),
  completionRate: z.number().nullable(),
});

const typeCountSchema = z.strictObject({
  code: z.string(),
  name: z.string(),
  count: z.number(),
  share: z.number(),
});

const trackShapeSchema = z.strictObject({
  track: trackId,
  buckets: z.array(z.number()),
  median: z.number(),
  mean: z.number(),
});

const exposureSchema = z.strictObject({
  decksRecorded: z.number(),
  distinctItems: z.number(),
  totalExposures: z.number(),
  meanExposuresPerItem: z.number(),
  maxExposuresPerItem: z.number(),
});

const trendPointSchema = z.strictObject({
  period: z.string(),
  started: z.number(),
  finalized: z.number(),
});

export const worldAggregatesSchema = z.strictObject({
  minCohortSize: z.number(),
  cohortSize: z.number(),
  suppressed: z.boolean(),
  participation: participationSchema,
  playerTypes: z.array(typeCountSchema).nullable(),
  tracks: z.array(trackShapeSchema).nullable(),
  exposure: exposureSchema.nullable(),
  trend: z.array(trendPointSchema).nullable(),
}) satisfies z.ZodType<WorldAggregates>;

/** `GET /aggregates`. */
export const aggregatesResponseSchema = z.strictObject({ aggregates: worldAggregatesSchema });
