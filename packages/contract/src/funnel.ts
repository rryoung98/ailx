/**
 * THE FUNNEL EVENT SCHEMA — the eight steps we count on the way to 10,000
 * players, and nothing else.
 *
 * It lives in the contract package because the browser emits these events and
 * the exam service stores them, and a type copied into two repositories is a
 * type that drifts. Everything here is pure: no clock, no storage, no fetch.
 * The browser half is `apps/web/lib/data/funnel.ts`; the sink is the service's.
 *
 * WHAT THIS MAY CARRY. An anonymous client id, a session id, a local calendar
 * day, and the few counts a step needs to be readable. Nothing else.
 *
 * WHAT IT MAY NEVER CARRY, and the reasons are not stylistic:
 *
 *  - No name, no email, no account id, no IP, no referrer, no user agent
 *    string. The id is minted by the browser, rotates (see
 *    `apps/web/lib/data/funnel.ts`), and identifies nobody.
 *  - No SHARE TOKEN. A token is a capability: whoever holds it can open a
 *    candidate's card. A capability in a metrics table is a leak with a
 *    retention policy. So `share_created` and `share_opened` carry no token,
 *    and click-through is measured in aggregate — opens over creates — which
 *    is the number a review meeting actually asks for.
 *  - No exam evidence. `sitting_started` is the ONLY step the exam surface
 *    emits, and nothing inside a sitting is instrumented at all.
 *    Responses, per-item timings and judge output are exam evidence
 *    and belong in the append-only store, which is content-addressed and
 *    replayable. A funnel table is neither.
 *
 * RETENTION IS NOT AN EVENT. "Came back on day 1" is a property of an id and
 * a calendar, so it cannot be fired honestly at emit time — a browser cannot
 * know it is about to be a returning visitor, and one that guessed would be
 * counting its own optimism. Every event therefore carries `firstSeenDay` and
 * `dayIndex`, and D1/D7 is a query over those (docs/KPI.md).
 */
import { API_ROUTES } from "./routes.js";

/**
 * A local calendar day, `YYYY-MM-DD`, that is also a real date.
 *
 * `@ailx/report` already spells this rule (`isCalendarDay` in progress.ts)
 * and this is deliberately NOT importing it. `@ailx/contract` depends on
 * `@ailx/report` for TYPES only; a value import would make the contract
 * unresolvable until report is built, and the private repo vendors the
 * contract on its own. Four lines of duplication buy a package that stands
 * up by itself. If a third copy ever appears, move the rule down here and
 * have report import it.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  // Round-trip, because `Date.parse` ROLLS an impossible date over instead of
  // refusing it: "2026-02-30" parses happily and comes back as 2 March. A day
  // that is not the day it says it is would land two cohorts in one bucket.
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/** Bumped when a field changes meaning. Stored with every row. */
export const FUNNEL_SCHEMA_VERSION = 1;

/**
 * The one URL the browser posts a batch to, under `apiBase()` — and it is the
 * MANIFEST's spelling, not a second one.
 *
 * It was a bare literal here, outside `API_ROUTES`, which is why the drift in
 * TEN-133 went unseen: the guard in `apps/web/test/routeManifest.test.ts`
 * only knows the segments the manifest declares, so `/events` was invisible
 * to it. No deployment mounts the route today; see the manifest entry.
 */
export const FUNNEL_EVENTS_PATH: string = API_ROUTES.funnelEvents.path;

/** Most events a single POST may carry. A longer body is a bug, not traffic. */
export const FUNNEL_BATCH_MAX = 20;

/**
 * The eight steps, in the order a person walks them.
 *
 * Named for the question a review meeting asks, not for the component that
 * fires them: `play_completed` survives the drill being rewritten, and
 * `PracticeDrillDoneEvent` would not.
 */
export const FUNNEL_STEPS = [
  "visit_started",
  "landing_viewed",
  "play_started",
  "play_completed",
  "signed_in",
  "sitting_started",
  "share_created",
  "share_opened",
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** The two unscored loops. A sitting is not a play and never counts as one. */
export const FUNNEL_PLAY_MODES = ["practice", "daily"] as const;
export type FunnelPlayMode = (typeof FUNNEL_PLAY_MODES)[number];

/** Client and session ids as the browser mints them: `crypto.randomUUID()`. */
export const FUNNEL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cards in one play. Above this the emitter is wrong, so the row is refused. */
export const FUNNEL_MAX_ANSWERED = 100;

/** Days a client id may live before it is rotated. Bounds `dayIndex`. */
export const FUNNEL_MAX_DAY_INDEX = 400;

/** What every event carries, whatever step it is. */
export interface FunnelEnvelope {
  /** {@link FUNNEL_SCHEMA_VERSION} at the time of emit. */
  readonly v: number;
  readonly step: FunnelStep;
  /** Anonymous, browser-minted, rotating. Identifies a browser, not a person. */
  readonly clientId: string;
  /** One browsing session. Survives a reload, dies with the tab. */
  readonly sessionId: string;
  /**
   * Wall clock at emit, epoch ms. It decides nothing on its own — a device
   * clock can be wrong by years — but it is what a late-arriving batch is
   * placed by.
   */
  readonly ts: number;
  /**
   * Milliseconds since THIS PAGE LOADED, from `performance.now()`. It does
   * not move when the clock is corrected or the device crosses a timezone, so
   * it orders two events from the same page load exactly. It does NOT order a
   * whole session: a reload keeps the session id and restarts this counter at
   * zero, so across a reload only `ts` (a device clock, and fallible) places
   * the two halves.
   */
  readonly monotonicMs: number;
  /** The visitor's own calendar day, `YYYY-MM-DD`, from their device. */
  readonly day: string;
  /** The first day this client id was seen, `YYYY-MM-DD`. */
  readonly firstSeenDay: string;
  /** Whole days from `firstSeenDay` to `day`. 0 on the first day. */
  readonly dayIndex: number;
}

/** A browsing session began. The step that makes D1/D7 computable. */
export interface VisitStarted extends FunnelEnvelope {
  readonly step: "visit_started";
  /** True when the id was minted for this visit — a first-ever session. */
  readonly newClient: boolean;
}

/** Somebody opened the front page. */
export interface LandingViewed extends FunnelEnvelope {
  readonly step: "landing_viewed";
}

/** A practice or daily round was dealt and shown. */
export interface PlayStarted extends FunnelEnvelope {
  readonly step: "play_started";
  readonly mode: FunnelPlayMode;
  /** One round. The same id on the matching `play_completed`, and nowhere else. */
  readonly playId: string;
}

/** The last card of that round was called. */
export interface PlayCompleted extends FunnelEnvelope {
  readonly step: "play_completed";
  readonly mode: FunnelPlayMode;
  readonly playId: string;
  /** Cards actually called. A dropped card is not one. */
  readonly answered: number;
}

/** An account exists and the browser is holding it. No account id travels. */
export interface SignedIn extends FunnelEnvelope {
  readonly step: "signed_in";
}

/** A scored sitting started. The only step the exam path emits. */
export interface SittingStarted extends FunnelEnvelope {
  readonly step: "sitting_started";
}

/** A candidate minted a share link. No token, ever (see the header). */
export interface ShareCreated extends FunnelEnvelope {
  readonly step: "share_created";
}

/** Somebody opened a share link and the card resolved. */
export interface ShareOpened extends FunnelEnvelope {
  readonly step: "share_opened";
}

export type FunnelEvent =
  | VisitStarted
  | LandingViewed
  | PlayStarted
  | PlayCompleted
  | SignedIn
  | SittingStarted
  | ShareCreated
  | ShareOpened;

/** The fields a caller supplies; the emitter fills the envelope. */
export type FunnelBody<S extends FunnelStep> = Omit<
  Extract<FunnelEvent, { step: S }>,
  keyof FunnelEnvelope
>;

function isId(value: unknown): value is string {
  return typeof value === "string" && FUNNEL_ID_RE.test(value);
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * One event from untrusted input, or null.
 *
 * Used on BOTH sides: the browser can assert on it, and the service refuses
 * anything it does not return. A funnel row is written by an anonymous POST,
 * so "the client would not send that" is not a check.
 */
export function parseFunnelEvent(value: unknown): FunnelEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.v !== FUNNEL_SCHEMA_VERSION) return null;
  const step = raw.step;
  if (typeof step !== "string" || !(FUNNEL_STEPS as readonly string[]).includes(step)) return null;
  if (!isId(raw.clientId) || !isId(raw.sessionId)) return null;
  if (typeof raw.ts !== "number" || !Number.isInteger(raw.ts) || raw.ts <= 0) return null;
  if (typeof raw.monotonicMs !== "number" || !Number.isFinite(raw.monotonicMs) || raw.monotonicMs < 0) {
    return null;
  }
  if (!isDay(raw.day) || !isDay(raw.firstSeenDay)) return null;
  if (!isCount(raw.dayIndex, FUNNEL_MAX_DAY_INDEX)) return null;
  const base: Omit<FunnelEnvelope, "step"> = {
    v: FUNNEL_SCHEMA_VERSION,
    clientId: raw.clientId,
    sessionId: raw.sessionId,
    ts: raw.ts,
    monotonicMs: raw.monotonicMs,
    day: raw.day,
    firstSeenDay: raw.firstSeenDay,
    dayIndex: raw.dayIndex,
  };
  switch (step as FunnelStep) {
    case "visit_started":
      return typeof raw.newClient === "boolean"
        ? { ...base, step: "visit_started", newClient: raw.newClient }
        : null;
    case "play_started":
      return isPlayMode(raw.mode) && isId(raw.playId)
        ? { ...base, step: "play_started", mode: raw.mode, playId: raw.playId }
        : null;
    case "play_completed":
      return isPlayMode(raw.mode) && isId(raw.playId) && isCount(raw.answered, FUNNEL_MAX_ANSWERED)
        ? {
            ...base,
            step: "play_completed",
            mode: raw.mode,
            playId: raw.playId,
            answered: raw.answered,
          }
        : null;
    // The five bare steps carry the envelope and nothing else. They are
    // written out rather than defaulted so that a step added to
    // FUNNEL_STEPS without a parse rule fails to compile here.
    case "landing_viewed":
      return { ...base, step: "landing_viewed" };
    case "signed_in":
      return { ...base, step: "signed_in" };
    case "sitting_started":
      return { ...base, step: "sitting_started" };
    case "share_created":
      return { ...base, step: "share_created" };
    case "share_opened":
      return { ...base, step: "share_opened" };
  }
}

function isPlayMode(value: unknown): value is FunnelPlayMode {
  return typeof value === "string" && (FUNNEL_PLAY_MODES as readonly string[]).includes(value);
}

/**
 * A whole POST body, or null.
 *
 * ALL OR NOTHING on purpose. A batch with one malformed row means the emitter
 * and the schema disagree, and half-storing that batch would put a gap in the
 * numerator of whichever step happened to be malformed.
 */
export function parseFunnelBatch(value: unknown): FunnelEvent[] | null {
  if (typeof value !== "object" || value === null) return null;
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length === 0 || events.length > FUNNEL_BATCH_MAX) return null;
  const out: FunnelEvent[] = [];
  for (const entry of events) {
    const parsed = parseFunnelEvent(entry);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}
