/**
 * The PROFILE wire contract — the durable half of a person, and the type
 * history hanging off it (docs/ADR-profile-and-type.md §5, §7).
 *
 * WHAT A PROFILE IS. `participants` is the LOGIN: provider-scoped, keyed by
 * `auth_ref`, and orphaned the day the Clerk instance changes. The profile is
 * the person: an identity of our own (`personKey`), the day they first
 * arrived, and a place to hang readings. It holds no score, no composite, no
 * percentile, no band, no `auth_ref` and no email address — and none of those
 * may be added here, because this is the shape a browser receives.
 *
 * WHAT IS NEVER STORED, AND THEREFORE NEVER SENT. The four-letter code. A
 * code is a RENDERING of four axes (§4.1); the axes carry `strength` and
 * `evidence`, which are the only things that make a letter defensible, and
 * `current` is derived on read by `currentType()` in `@ailx/report` — the same
 * pure function both repositories run.
 *
 * PRIVATE. `GET /profile` returns the CALLER'S OWN profile and nothing else.
 * No route here returns another person's, and nothing on it is public by
 * default: the only public copy of a type is inside a share its owner created
 * on purpose and can revoke (§8).
 */
import { z } from "zod";
import { AXIS_TRACKS } from "./gallery.js";

/** Stored on the profile, defaults to `private`, and governs nothing served today (§8). */
export const TYPE_VISIBILITIES = ["private", "gallery"] as const;
export type TypeVisibility = (typeof TYPE_VISIBILITIES)[number];

/**
 * What the person has: nothing, a partial sitting's two or three axes, or a
 * full four-axis reading. `"none"` is an ANSWER, not a loading state — a
 * practice-and-daily-only person has no type and is told so in one honest
 * sentence (§6.3).
 */
export const TYPE_STATES = ["none", "partial", "full"] as const;
export type TypeState = (typeof TYPE_STATES)[number];

/** The only source a reading may have. Widening it is a new ADR, and a database CHECK says so too. */
export const READING_SOURCES = ["sitting"] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

const trackSchema = z.enum(AXIS_TRACKS as unknown as [string, ...string[]]);

/**
 * One STORED axis reading, exactly as the row holds it: no letter, because a
 * letter is derived from `high`, and storing it would be a second answer to
 * the same question.
 */
export const axisReadingSchema = z.strictObject({
  track: trackSchema,
  high: z.boolean(),
  strength: z.number().min(0).max(100),
  evidence: z.string(),
});
export type AxisReadingWire = z.infer<typeof axisReadingSchema>;

/** One typed run, as its owner reads it back. Append-only: this row never changed. */
export const typeReadingSchema = z.strictObject({
  id: z.string().min(1),
  at: z.string().min(1),
  source: z.enum(READING_SOURCES),
  /** The attempt this reading was written from — the caller's own. */
  sourceRef: z.string().min(1),
  instrument: z.string().min(1),
  axes: z.array(axisReadingSchema).min(1).max(AXIS_TRACKS.length),
  axisCount: z.number().int().min(1).max(AXIS_TRACKS.length),
});
export type TypeReadingWire = z.infer<typeof typeReadingSchema>;

/**
 * A DERIVED axis: the letter, the meter, and the two things a card must not
 * hide — `undecided` (a coin flip, rendered as one) and `moving` (the newest
 * run disagreed with the mean of the window, so the axis reads undecided
 * whatever its strength).
 */
export const derivedPoleSchema = z.strictObject({
  track: trackSchema,
  letter: z.string().length(1),
  label: z.string().min(1),
  high: z.boolean(),
  strength: z.number().min(0).max(100),
  evidence: z.string(),
  undecided: z.boolean(),
  moving: z.boolean(),
  previousLetter: z.string().length(1).nullable(),
});

/** The derived "current" type. `code` is null for a partial reading — never invented. */
export const currentTypeSchema = z.strictObject({
  axes: z.array(derivedPoleSchema).min(1).max(AXIS_TRACKS.length),
  code: z.string().nullable(),
  name: z.string().nullable(),
  tagline: z.string().nullable(),
  partial: z.boolean(),
  axisCount: z.number().int().min(1).max(AXIS_TRACKS.length),
  movingAxes: z.array(trackSchema),
  /** How many runs the mean was taken over: 1, or the three-run window. */
  runCount: z.number().int().min(1),
  at: z.string().min(1),
});

/** How many readings `GET /profile` hands back, newest first (§7.4). */
export const PROFILE_READING_HISTORY = 20;

export const profileSchema = z.strictObject({
  /** OUR key for this person, minted by no provider, stable across a Clerk instance switch. */
  personKey: z.string().min(1),
  /** Chosen, never derived, and never served publicly until founder step F3. */
  displayName: z.string().nullable(),
  createdAt: z.string().min(1),
  typeVisibility: z.enum(TYPE_VISIBILITIES),
  typeState: z.enum(TYPE_STATES),
  current: currentTypeSchema.nullable(),
  readings: z.array(typeReadingSchema).max(PROFILE_READING_HISTORY),
});
export type Profile = z.infer<typeof profileSchema>;
