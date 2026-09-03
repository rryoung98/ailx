"use client";
/**
 * THE FUNNEL EMITTER — the browser half of docs/KPI.md.
 *
 * One module, one queue, one POST. It answers eight questions and no others
 * (`@ailx/contract`'s funnel schema is the list), and it is built to be
 * boring in the four ways that matter:
 *
 *  - IT IS SILENT WITHOUT A BACKEND. The default build is a static export on
 *    GitHub Pages with no service behind it. With `NEXT_PUBLIC_AILX_API_BASE`
 *    unset there is nothing to post to, so nothing is queued, no id is
 *    minted and no storage is touched. Not a failed request — no request.
 *  - IT NEVER BLOCKS AND NEVER THROWS. Every entry point is synchronous,
 *    returns void, and swallows its own failures. A metric must not be able
 *    to take down a render path or a drill. A dropped event is a small hole
 *    in a chart; a thrown one is a broken page.
 *  - IT COUNTS A STEP ONCE. Idempotency beats delivery here: a
 *    double-counted `play_completed` is a lie in the numerator, and a lost
 *    one is a number that is slightly low and still honest. Dedupe keys live
 *    in sessionStorage, so a reload mid-play does not re-count the play it
 *    is in the middle of, while a second play in the same day is a second
 *    play id and counts twice.
 *  - IT CARRIES NOTHING ABOUT A PERSON. An anonymous, rotating client id in
 *    localStorage, a session id, and the visitor's own calendar day. No
 *    account id, no share token, no exam evidence, no third-party script,
 *    no cookie. See the schema header for why each one is banned.
 *
 * D1/D7 IS NOT EMITTED, AND CANNOT BE. A browser cannot know it is about to
 * be a returning visitor. Every event carries `firstSeenDay` and `dayIndex`
 * (whole days since that first day), and retention is a query over those
 * columns downstream: D1 is the share of client ids first seen on day D that
 * emit any event with `dayIndex = 1`, D7 the same with `dayIndex = 7`.
 * docs/KPI.md states the query and what it cannot tell us. Nothing in this
 * file computes a rate.
 */
import {
  FUNNEL_BATCH_MAX,
  FUNNEL_EVENTS_PATH,
  type FunnelBody,
  type FunnelEnvelope,
  type FunnelEvent,
  type FunnelPlayMode,
  type FunnelStep,
  FUNNEL_SCHEMA_VERSION,
} from "@ailx/contract";
import { daysBetween, localDay } from "@ailx/report";
import type { StorageLike } from "@ailx/session";
import { apiBase, apiOrigin } from "../mode";

/** The browser's own record of who it is. localStorage: it outlives a tab. */
export const FUNNEL_CLIENT_KEY = "ailx.funnel.client.v1";
/** This tab's session. sessionStorage: it survives a reload, not a new tab. */
export const FUNNEL_SESSION_KEY = "ailx.funnel.session.v1";

/**
 * How long a client id may live before it is replaced by a new one with a new
 * first-seen day.
 *
 * 90 days is a choice with a cost, said out loud: D1, D7 and D30 are
 * measurable, and nothing beyond 90 days is. An id that never rotated would
 * be a durable identifier for a browser, which is the thing we said we would
 * not keep. `dayIndex` therefore never exceeds this by more than a rounding
 * day, and the schema caps it far above.
 */
export const FUNNEL_CLIENT_ROTATION_DAYS = 90;

/** How long a queued event waits for company before it is sent. */
export const FUNNEL_FLUSH_MS = 2000;

/**
 * A play that has been started and not yet finished, resumed after a reload
 * for this long. Past it, the tab was left open overnight and the next round
 * is a new play, not the old one.
 */
export const FUNNEL_PLAY_RESUME_MS = 30 * 60 * 1000;

/** The five steps that carry the envelope and nothing else. */
export type BareFunnelStep = Extract<
  FunnelStep,
  "landing_viewed" | "signed_in" | "sitting_started" | "share_created" | "share_opened"
>;

interface ClientRecord {
  id: string;
  firstSeenDay: string;
  mintedDay: string;
}

interface OpenPlay {
  id: string;
  mode: FunnelPlayMode;
  startedAt: number;
}

interface SessionRecord {
  id: string;
  /** The local day the session opened. A new day is a new session. */
  day: string;
  /** Dedupe keys already emitted in this session. */
  sent: string[];
  play: OpenPlay | null;
}

export interface FunnelDeps {
  /** Cross-session store, or null where the browser has none. */
  readonly local: StorageLike | null;
  /** Per-tab store, or null. */
  readonly session: StorageLike | null;
  /** Wall clock, epoch ms. */
  readonly now: () => number;
  /** Monotonic ms since page load. */
  readonly monotonic: () => number;
  /** Minutes EAST of UTC. */
  readonly tzOffsetMinutes: () => number;
  /** A fresh anonymous id. */
  readonly uuid: () => string;
  /** Post a batch. Must not throw and must not be awaited by a caller. */
  readonly send: (url: string, body: string) => void;
  /** The sink's URL, or null when this build has no backend. */
  readonly endpoint: () => string | null;
}

export interface Funnel {
  /** One of the five bare steps. Once per browsing session. */
  step: (step: BareFunnelStep) => void;
  /** A round was dealt. Resumes the open play after a reload. */
  playStarted: (mode: FunnelPlayMode) => void;
  /** That round finished. Closes the open play, so the next one is new. */
  playCompleted: (mode: FunnelPlayMode, answered: number) => void;
  /** Send whatever is queued, now. */
  flush: () => void;
  /** Queue length. Tests read it; nothing else should. */
  pending: () => number;
}

/** JSON, or null when it is not the shape we wrote. Never throws. */
function readJson<T>(storage: StorageLike | null, key: string): T | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
  if (storage === null) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota, private mode, a locked-down profile. The event still goes out;
    // it just may be counted again in the next session.
  }
}

/**
 * A store that keeps working when the browser's does not.
 *
 * Private mode, a full quota and a locked-down profile all make
 * `localStorage` throw or vanish. Without this the emitter re-mints a client
 * id and a session id on EVERY call, so one visitor becomes a stream of
 * one-event strangers: bare steps count again and again, and no completion
 * can be paired with its start. The memory copy lasts as long as the page,
 * which is as much as such a browser can honestly give us.
 */
function backed(storage: StorageLike | null): StorageLike {
  const memory = new Map<string, string>();
  return {
    getItem(key) {
      try {
        const stored = storage?.getItem(key) ?? null;
        if (stored !== null) return stored;
      } catch {
        // Fall through to the memory copy.
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      try {
        storage?.setItem(key, value);
      } catch {
        // Quota, private mode, a locked-down profile.
      }
    },
    removeItem(key) {
      memory.delete(key);
      try {
        storage?.removeItem(key);
      } catch {
        // See above.
      }
    },
  };
}

/**
 * The emitter, with every impure capability handed to it (FRONTEND.md §2.2).
 * The browser singleton below is one call to this.
 */
export function createFunnel(deps: FunnelDeps): Funnel {
  const localStore = backed(deps.local);
  const sessionStore = backed(deps.session);
  let queue: FunnelEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    const url = deps.endpoint();
    if (url === null) return;
    try {
      deps.send(url, JSON.stringify({ events: batch }));
    } catch {
      // A send that throws is a send that failed. The batch is already off
      // the queue on purpose: retrying an unknown failure is how a step gets
      // counted twice.
    }
  }

  function enqueue(event: FunnelEvent): void {
    queue.push(event);
    if (queue.length >= FUNNEL_BATCH_MAX) {
      flush();
      return;
    }
    if (timer === null) timer = setTimeout(flush, FUNNEL_FLUSH_MS);
  }

  /** Today, by the visitor's own device. */
  function today(): string {
    return localDay(deps.now(), deps.tzOffsetMinutes());
  }

  /**
   * This browser's id, minted or rotated as needed.
   *
   * A rotation is a NEW client with a new first-seen day, so the retention
   * query never reads across the boundary and quietly calls one browser two
   * people, or one person a 200-day-old cohort member.
   */
  function client(day: string): { record: ClientRecord; minted: boolean } {
    const stored = readJson<Partial<ClientRecord>>(localStore, FUNNEL_CLIENT_KEY);
    const usable =
      typeof stored?.id === "string" &&
      typeof stored.firstSeenDay === "string" &&
      typeof stored.mintedDay === "string" &&
      daysBetween(stored.mintedDay, day) >= 0 &&
      daysBetween(stored.mintedDay, day) <= FUNNEL_CLIENT_ROTATION_DAYS;
    if (usable) return { record: stored as ClientRecord, minted: false };
    const record: ClientRecord = { id: deps.uuid(), firstSeenDay: day, mintedDay: day };
    writeJson(localStore, FUNNEL_CLIENT_KEY, record);
    return { record, minted: true };
  }

  function readSession(day: string): SessionRecord | null {
    const stored = readJson<Partial<SessionRecord>>(sessionStore, FUNNEL_SESSION_KEY);
    if (typeof stored?.id !== "string") return null;
    // A tab left open overnight is a new visit, not a twelve-hour one. Without
    // this, somebody who comes back to yesterday's tab emits nothing at all:
    // the session is still open and every bare step is already deduped, so the
    // return that D1 exists to count never reaches the sink.
    if (stored.day !== day) return null;
    return {
      id: stored.id,
      day,
      sent: Array.isArray(stored.sent) ? stored.sent.filter((k) => typeof k === "string") : [],
      play:
        typeof stored.play?.id === "string" && typeof stored.play.startedAt === "number"
          ? { id: stored.play.id, mode: stored.play.mode as FunnelPlayMode, startedAt: stored.play.startedAt }
          : null,
    };
  }

  /**
   * The session, and — the first time it is asked for — the `visit_started`
   * that makes retention computable. It is emitted HERE rather than from a
   * page, so no surface can be instrumented without it.
   */
  function session(day: string, record: ClientRecord, minted: boolean): SessionRecord {
    const existing = readSession(day);
    if (existing !== null) return existing;
    const fresh: SessionRecord = { id: deps.uuid(), day, sent: [], play: null };
    writeJson(sessionStore, FUNNEL_SESSION_KEY, fresh);
    enqueue(envelope("visit_started", day, record, fresh, { newClient: minted }) as FunnelEvent);
    return fresh;
  }

  function envelope<S extends FunnelStep>(
    step: S,
    day: string,
    record: ClientRecord,
    sess: SessionRecord,
    body: FunnelBody<S>,
  ): FunnelEnvelope & FunnelBody<S> & { step: S } {
    return {
      v: FUNNEL_SCHEMA_VERSION,
      step,
      clientId: record.id,
      sessionId: sess.id,
      ts: deps.now(),
      monotonicMs: deps.monotonic(),
      day,
      firstSeenDay: record.firstSeenDay,
      // Clamped at zero: a device clock moved backwards is a wrong day, not a
      // negative age, and the schema refuses a negative one anyway.
      dayIndex: Math.max(0, daysBetween(record.firstSeenDay, day)),
      ...body,
    };
  }

  /**
   * Everything an event needs, or null when this build has no sink. ONE
   * gate, so no entry point can forget to check for a backend.
   */
  function context(): { day: string; record: ClientRecord; sess: SessionRecord } | null {
    if (deps.endpoint() === null) return null;
    const day = today();
    const { record, minted } = client(day);
    return { day, record, sess: session(day, record, minted) };
  }

  /**
   * The play this session already has open for `mode`, or null.
   *
   * An open play is only the round in front of the person when it is the same
   * loop and recent. A cross-mode resume was the bug worth writing down: a
   * practice round abandoned in the landing hero, then the daily started
   * minutes later, used to resume the practice play id. The daily start was
   * swallowed as a duplicate and its completion went out labelled
   * `mode: "practice"`, so one loop lost a play and the other gained one.
   */
  function openPlay(sess: SessionRecord, mode: FunnelPlayMode): OpenPlay | null {
    const open = sess.play;
    if (open === null || open.mode !== mode) return null;
    return deps.now() - open.startedAt <= FUNNEL_PLAY_RESUME_MS ? open : null;
  }

  /**
   * Queue one event unless this session already sent that key, and persist
   * the session either way — `playStarted` and `playCompleted` mutate the
   * open play before they get here, and that mutation must survive a reload
   * whether or not the event was a duplicate.
   */
  function commit<S extends FunnelStep>(
    step: S,
    key: string,
    ctx: { day: string; record: ClientRecord; sess: SessionRecord },
    body: FunnelBody<S>,
  ): void {
    const fresh = !ctx.sess.sent.includes(key);
    if (fresh) ctx.sess.sent.push(key);
    writeJson(sessionStore, FUNNEL_SESSION_KEY, ctx.sess);
    if (fresh) enqueue(envelope(step, ctx.day, ctx.record, ctx.sess, body) as FunnelEvent);
  }

  return {
    step(step) {
      try {
        const ctx = context();
        if (ctx !== null) commit(step, step, ctx, {} as FunnelBody<BareFunnelStep>);
      } catch {
        // Nothing a visitor can see, and nothing a caller can act on.
      }
    },

    playStarted(mode) {
      try {
        const ctx = context();
        if (ctx === null) return;
        // A reload mid-play resumes the SAME play id, so a round somebody is
        // halfway through is not counted as a second start.
        const play: OpenPlay = openPlay(ctx.sess, mode) ?? {
          id: deps.uuid(),
          mode,
          startedAt: deps.now(),
        };
        ctx.sess.play = play;
        commit("play_started", `play_started:${play.id}`, ctx, { mode: play.mode, playId: play.id });
      } catch {
        // See `step`.
      }
    },

    playCompleted(mode, answered) {
      try {
        const ctx = context();
        if (ctx === null) return;
        // A completion with no start is a round that began in an earlier
        // session (a reload on the results screen). It gets its own id and is
        // counted once; the missing start stays a gap, which is the honest
        // shape of what happened.
        const play = openPlay(ctx.sess, mode) ?? { id: deps.uuid(), mode, startedAt: deps.now() };
        ctx.sess.play = null;
        commit("play_completed", `play_completed:${play.id}`, ctx, {
          mode: play.mode,
          playId: play.id,
          answered: Math.max(0, Math.round(answered)),
        });
      } catch {
        // See `step`.
      }
    },

    flush,
    pending: () => queue.length,
  };
}

// ---------------------------------------------------------------------------
// The browser's one emitter
// ---------------------------------------------------------------------------

/** A store, or null where the browser refuses one. Never throws. */
function browserStore(which: "local" | "session"): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return (which === "local" ? window.localStorage : window.sessionStorage) as StorageLike | null;
  } catch {
    return null;
  }
}

/**
 * `fetch(keepalive)`, and DELIBERATELY NOT `sendBeacon`.
 *
 * A beacon is the obvious choice: it outlives the page. But its credentials
 * mode is fixed at "include", so a beacon to the exam service carries that
 * service's cookies, and a row we promised was anonymous arrives attached to
 * whatever session cookie the candidate happens to hold. `keepalive` buys the
 * same survival past a page hide with `credentials: "omit"`, which is the
 * property docs/KPI.md actually claims. The cost is real and small: a browser
 * without `keepalive` drops the last batch of a session.
 *
 * Fire and forget either way. Nothing here reads the response, because there
 * is no answer this app would act on.
 */
function browserSend(url: string, body: string): void {
  try {
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      // Anonymous by construction: no cookie, no identity header.
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    // Offline, blocked, or a browser that refuses the call. Drop it.
  }
}

/**
 * A v4-shaped anonymous id. `crypto.randomUUID` where it exists, and a
 * `Math.random` fallback where it does not (older Safari, and any non-secure
 * context). The id identifies a browser for at most 90 days and secures
 * nothing, so an unpredictable source is not a requirement.
 */
function browserUuid(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
    if (uuid !== undefined) return uuid();
  } catch {
    // Fall through.
  }
  const hex = (n: number): string =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

/**
 * Where the events go, or null for "this build has no backend".
 *
 * `apiOrigin()` is the test, not `isServerMode()`: the static export has no
 * service of its own, and this repo has no API routes at all (AGENTS.md, the
 * repository split). No origin means no sink, and no sink means silence.
 * `NEXT_PUBLIC_AILX_API_BASE` is still read in exactly one module, lib/mode.ts.
 */
function browserEndpoint(): string | null {
  return apiOrigin() === "" ? null : `${apiBase()}${FUNNEL_EVENTS_PATH}`;
}

let singleton: Funnel | null = null;
/** Aborts the page listener below, so a rebuilt emitter does not stack them. */
let listeners: AbortController | null = null;

/** The app's emitter. Built on first use, so an import touches no browser API. */
export function funnel(): Funnel {
  if (singleton !== null) return singleton;
  singleton = createFunnel({
    local: browserStore("local"),
    session: browserStore("session"),
    now: () => Date.now(),
    monotonic: () =>
      typeof performance === "undefined" ? 0 : Math.max(0, Math.round(performance.now())),
    tzOffsetMinutes: () => -new Date().getTimezoneOffset(),
    uuid: browserUuid,
    send: browserSend,
    endpoint: browserEndpoint,
  });
  // The last event of a session is emitted as the page goes away, so the
  // queue is drained on the one event mobile browsers reliably fire.
  if (typeof document !== "undefined") {
    listeners = new AbortController();
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") singleton?.flush();
      },
      { signal: listeners.signal },
    );
  }
  return singleton;
}

/** Test hook: drop the singleton AND the listener it registered. */
export function resetFunnel(): void {
  listeners?.abort();
  listeners = null;
  singleton = null;
}
