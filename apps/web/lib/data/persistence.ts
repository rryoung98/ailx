/**
 * Attempt persistence seam for the exam flow.
 *
 * Static showcase (default): localStorage only — exactly the previous
 * behaviour, via @ailx/session’s validated save/load.
 *
 * Server mode (NEXT_PUBLIC_AILX_BACKEND=1): localStorage stays the
 * synchronous source of truth for the running tab, and every save also
 * mirrors NEW log entries to the backend as append-only `responses` rows
 * (payload = the session log entry, seq = its log seq — so the server holds
 * the same event-sourced record the client replays). Sync is best-effort
 * and resumable: progress is persisted per attempt, retries happen on the
 * next save, and server-side seq idempotency makes re-sends safe.
 */
import { readMigratedItem, removeMigratedItem } from "@ailx/core";
import { apiPath, type ApiPath } from "@ailx/contract";
import {
  clearAttempt,
  loadAttemptValidated,
  SaveConflictError,
  saveAttempt,
  type SequencedEntry,
  type StorageLike,
  type ValidatedLog,
} from "@ailx/session";
import { serviceHeaders } from "./traceparent";
import { deadline, isTimeout, type CallClass } from "./deadline";
import { apiBase, isServerMode, siteApiRoot } from "../mode";

/**
 * Identity lives in `lib/data/authHeaders.ts` — one module owns "who is calling and
 * how does that travel", because the answer differs same-origin vs
 * cross-origin. Re-exported here so existing importers (and the E2E fixtures,
 * which seed `DEV_USER_KEY` directly) keep one import site.
 */
export { DEV_USER_KEY, clearDevUser, devUser } from "./authHeaders";

/**
 * Where this attempt's SERVER copy has got to.
 *
 * It exists because "the mirror failed" used to be a line in the console and
 * nothing else (TEN-123), and because the one failure that matters — the
 * finalize POST — happens after the last thing the candidate does, so no
 * later `save()` was ever going to retry it (TEN-206). A status a surface can
 * read is what lets the completion screen and the report say "your sitting is
 * not scored yet" instead of showing a report with no score of record, no
 * reason and no action.
 */
export type SyncPhase =
  /** Static build, or nothing mirrored yet. There is no server copy to wait for. */
  | "idle"
  /** A pass is queued or running. */
  | "pending"
  /** Everything in the local log is on the server. */
  | "synced"
  /** The last pass failed and the bounded retries are used up. */
  | "failed";

export interface SyncStatus {
  readonly phase: SyncPhase;
  /** True once the service has finalized this attempt — and so scored it. */
  readonly finalized: boolean;
  /**
   * The sitting is COMPLETE in this browser and the service has not finalized
   * it. Nothing else issues the score of record (TEN-66), so while this is
   * true the sitting has no score and the candidate must be told.
   */
  readonly finalizePending: boolean;
  /** Failed passes since the last success. Zero after any success. */
  readonly failures: number;
  /** Why the last pass failed, as a sentence. Absent when nothing has failed. */
  readonly message?: string;
}

const IDLE_STATUS: SyncStatus = Object.freeze({
  phase: "idle",
  finalized: false,
  finalizePending: false,
  failures: 0,
});

export interface AttemptPersistence {
  load(): ValidatedLog | null;
  /** Synchronous; throws SaveConflictError on multi-tab races (unchanged). */
  save(log: readonly SequencedEntry[]): void;
  clear(): void;
  /** Resolves when pending server sync (if any) has settled, WITH its outcome. */
  flush(): Promise<SyncStatus>;
  /** The mirror's state right now, synchronously. */
  status(): SyncStatus;
  /**
   * Ask again, now — the candidate pressing Retry, or a surface that owes
   * them an answer. Re-reads the stored log first, so a page that never ran
   * the sitting (the report) can still push it over the line.
   */
  resume(): Promise<SyncStatus>;
  /** Called on every status change. Returns the unsubscribe. */
  subscribe(fn: (status: SyncStatus) => void): () => void;
}

export function createLocalPersistence(storage: StorageLike): AttemptPersistence {
  return {
    load: () => loadAttemptValidated(storage),
    save: (log) => saveAttempt(storage, log),
    clear: () => clearAttempt(storage),
    flush: () => Promise.resolve(IDLE_STATUS),
    status: () => IDLE_STATUS,
    resume: () => Promise.resolve(IDLE_STATUS),
    // A local-only build has no server copy, so its status can never change.
    // The subscription is still offered so a surface has one shape to code
    // against in both builds.
    subscribe: () => () => {},
  };
}

// ---------------------------------------------------------------------------
// Server mirror
// ---------------------------------------------------------------------------

/** Mirror progress key for an attempt. Exported so the E2E fixtures can seed
 *  a resumed run exactly as the app would have written it. */
export const syncKey = (clientAttemptId: string) => `foray:sync:v1:${clientAttemptId}`;

interface SyncState {
  /** Server-side attempts.id (uuid) — the client attempt id stays in payloads. */
  serverAttemptId?: string;
  /** Count of log entries already mirrored (log seq is contiguous from 0). */
  syncedThrough: number;
  finalized: boolean;
  /**
   * The decks the server RECORDED for this attempt (`attempt_decks`), exactly
   * as POST /attempts returned them. Kept so the deck the candidate is later
   * SHOWN — fetched from GET /attempts/:id/items — can be checked against the
   * deck the exposure log claims was dealt, across a reload.
   */
  deck?: DeckRecord[];
}

export interface ApiPersistenceOptions {
  /** Versioned API root: `/api` on this app's own routes, `<origin>/v1` on the service. */
  baseUrl: string;
  /**
   * Root of the SERVED-SITE space (`<siteRoot>/site/<digest>/index.html`).
   * Separate from `baseUrl` because the site path is `/api/site/...` on both
   * hosts — it is baked into stored share payloads and credential claims and
   * cannot be re-versioned. See `lib/mode.ts` `siteApiRoot()`.
   */
  siteRoot: string;
  fetchFn: typeof fetch;
  /** Called when a sync pass fails; the pass is retried on the next save. */
  onSyncError?: (err: unknown) => void;
}

/** Shape check for decks read back out of localStorage (never trusted). */
function validDecks(value: unknown): value is DeckRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (d) =>
        typeof (d as DeckRecord)?.trackId === "string" &&
        typeof (d as DeckRecord)?.bankSha256 === "string" &&
        Array.isArray((d as DeckRecord)?.itemIds) &&
        (d as DeckRecord).itemIds.every((id) => typeof id === "string"),
    )
  );
}

function readSyncState(storage: StorageLike, clientAttemptId: string): SyncState {
  try {
    const raw = readMigratedItem(storage, syncKey(clientAttemptId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncState>;
      if (typeof parsed.syncedThrough === "number" && parsed.syncedThrough >= 0) {
        return {
          serverAttemptId: typeof parsed.serverAttemptId === "string" ? parsed.serverAttemptId : undefined,
          syncedThrough: Math.floor(parsed.syncedThrough),
          finalized: parsed.finalized === true,
          // Re-validated rather than trusted: this came back through
          // localStorage, which any tab (or extension) can rewrite.
          ...(validDecks(parsed.deck) ? { deck: parsed.deck } : {}),
        };
      }
    }
  } catch {
    // Corrupt state — restart the mirror; server idempotency absorbs re-sends.
  }
  return { syncedThrough: 0, finalized: false };
}

function writeSyncState(storage: StorageLike, clientAttemptId: string, state: SyncState): void {
  try {
    storage.setItem(syncKey(clientAttemptId), JSON.stringify(state));
  } catch {
    // Quota/private mode: next pass re-sends from the last persisted point.
  }
}

/**
 * Single GET path: same auth header, same error rule as {@link postJson}, and
 * the same BOUND. Every request through this module carries a deadline from
 * `lib/data/deadline.ts` — before TEN-210 none of them did, so a stalled
 * socket parked the mirror queue for the life of the tab and no `catch` in
 * this file could ever run.
 */
async function getJson(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  path: ApiPath,
  callClass: CallClass = "read",
): Promise<Record<string, unknown>> {
  const bound = deadline(callClass);
  try {
    const res = await opts.fetchFn(`${opts.baseUrl}${path}`, {
      headers: await serviceHeaders(storage),
      signal: bound.signal,
    });
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    bound.settle();
  }
}

/** Single POST path shared by the mirror and attempt pre-creation. */
async function postJson(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  path: ApiPath,
  body?: unknown,
  callClass: CallClass = "write",
): Promise<Record<string, unknown>> {
  const bound = deadline(callClass);
  try {
    const res = await opts.fetchFn(`${opts.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(await serviceHeaders(storage)),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: bound.signal,
    });
    if (!res.ok) {
      throw new Error(`POST ${path} failed: ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    bound.settle();
  }
}

/**
 * Server attempt id the mirror is (or will be) writing this attempt's rows
 * under — undefined until the attempt exists server-side. Consumed by the T1
 * site upload, which posts to the same attempt as the mirrored log.
 */
export function getServerAttemptId(storage: StorageLike, clientAttemptId: string): string | undefined {
  return readSyncState(storage, clientAttemptId).serverAttemptId;
}

/**
 * How long the mirror waits before asking again, and therefore HOW MANY TIMES
 * it asks: four entries, so four automatic retries and then it stops.
 *
 * Bounded on purpose. An unbounded retry loop against a service that is
 * refusing is a browser hammering a sick server, and — worse for the person
 * in front of it — a spinner that is indistinguishable from progress. When
 * these are used up the status goes to `failed`, the surfaces say so, and the
 * next attempt is the candidate's own (`resume()`). The delays grow so a cold
 * start (measured at 1213 ms, docs/ADR-redis.md) and a short outage are both
 * absorbed without a person having to do anything.
 */
const RETRY_BACKOFF_MS = [1_000, 4_000, 10_000, 30_000] as const;

/** The failure, as one sentence a candidate can be shown. */
function syncFailureMessage(err: unknown): string {
  if (isTimeout(err)) return "the Foray service did not answer in time";
  return err instanceof Error ? err.message : String(err);
}

class ServerMirror {
  private lastLog: readonly SequencedEntry[] = [];
  private inflight: Promise<void> = Promise.resolve();
  private phase: SyncPhase = "idle";
  private failures = 0;
  private message: string | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(status: SyncStatus) => void>();

  constructor(
    private readonly storage: StorageLike,
    private readonly opts: ApiPersistenceOptions,
  ) {}

  /**
   * Queue a sync pass for `log`. Passes are serialized.
   *
   * A failure used to be retried only when something else called `save()` or
   * `load()`. That is exactly why a failed FINALIZE was permanent: it is the
   * pass that follows the last thing the candidate ever does, so nothing was
   * coming to trigger it (TEN-206). The retry is now this module's own, and
   * bounded — see {@link RETRY_BACKOFF_MS}.
   */
  enqueue(log: readonly SequencedEntry[]): void {
    this.lastLog = log;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.setPhase("pending");
    this.inflight = this.inflight.then(() =>
      this.syncPass().then(
        () => {
          this.failures = 0;
          this.message = undefined;
          this.setPhase("synced");
        },
        (err: unknown) => {
          this.failures += 1;
          this.message = syncFailureMessage(err);
          // Reported on EVERY failed pass, including the ones a retry is
          // about to follow: a host that wants to log or count them sees all
          // of them, and the phase below says whether anything more will
          // happen on its own.
          (this.opts.onSyncError ?? ((e) => console.warn("[ailx sync]", e)))(err);
          this.scheduleRetry();
        },
      ),
    );
  }

  /** Ask again now, on the candidate's say-so. Resets the retry budget. */
  retryNow(log?: readonly SequencedEntry[]): Promise<SyncStatus> {
    this.failures = 0;
    const next = log ?? this.lastLog;
    if (next.length > 0) this.enqueue(next);
    return this.flush();
  }

  status(): SyncStatus {
    const log = this.lastLog;
    const first = log[0];
    const sync =
      first?.type === "attempt_started" ? readSyncState(this.storage, first.attemptId) : undefined;
    const completedLocally = log.length > 0 && log[log.length - 1].type === "attempt_completed";
    const finalized = sync?.finalized === true;
    return {
      phase: this.phase,
      finalized,
      finalizePending: completedLocally && !finalized,
      failures: this.failures,
      ...(this.message === undefined ? {} : { message: this.message }),
    };
  }

  subscribe(fn: (status: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async flush(): Promise<SyncStatus> {
    await this.inflight;
    return this.status();
  }

  private setPhase(phase: SyncPhase): void {
    this.phase = phase;
    const snapshot = this.status();
    for (const fn of this.listeners) fn(snapshot);
  }

  /**
   * The next automatic attempt, or none.
   *
   * `failed` is a terminal phase, not a pause: it is what a surface renders a
   * retry button from. Getting there needs every entry of the backoff table
   * to have been spent, so a candidate is only asked to act once this module
   * has stopped being able to help.
   */
  private scheduleRetry(): void {
    const wait = RETRY_BACKOFF_MS[this.failures - 1];
    if (wait === undefined) {
      this.setPhase("failed");
      return;
    }
    this.setPhase("pending");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.lastLog.length > 0) this.enqueue(this.lastLog);
    }, wait);
  }

  private post(path: ApiPath, body?: unknown, callClass: CallClass = "write"): Promise<Record<string, unknown>> {
    return postJson(this.storage, this.opts, path, body, callClass);
  }

  private async syncPass(): Promise<void> {
    const log = this.lastLog;
    if (log.length === 0) return;
    const first = log[0];
    if (first.type !== "attempt_started") return; // Validated logs always start here.
    const clientAttemptId = first.attemptId;
    const state = readSyncState(this.storage, clientAttemptId);
    if (state.finalized) return;

    if (!state.serverAttemptId) {
      const created = await this.post(apiPath("createAttempt"), {});
      state.serverAttemptId = createdAttemptId(created, apiPath("createAttempt"));
      this.write(clientAttemptId, state);
    }
    for (let i = state.syncedThrough; i < log.length; i++) {
      const entry = log[i];
      await this.post(apiPath("appendResponse", { id: state.serverAttemptId }), {
        seq: entry.seq,
        payload: entry,
        clientTs: entry.ts,
      });
      state.syncedThrough = i + 1;
      this.write(clientAttemptId, state);
    }
    if (log[log.length - 1].type === "attempt_completed") {
      // The one request that makes a sitting SCORED (TEN-66). Its own bound,
      // because the service issues every track score inside it and that is
      // real work, not a round trip.
      await this.post(apiPath("finalizeAttempt", { id: state.serverAttemptId }), undefined, "finalize");
      state.finalized = true;
      this.write(clientAttemptId, state);
    }
  }

  private write(clientAttemptId: string, state: SyncState): void {
    writeSyncState(this.storage, clientAttemptId, state);
  }
}

export function createApiPersistence(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
): AttemptPersistence {
  const local = createLocalPersistence(storage);
  const mirror = new ServerMirror(storage, opts);
  return {
    load: () => {
      const v = local.load();
      if (v && v.log.length > 0) mirror.enqueue(v.log); // Resume an interrupted sync.
      return v;
    },
    save: (log) => {
      // ORDER MATTERS, and it used to be wrong (TEN-208). The local write
      // came first and threw, so on a full localStorage the entry reached
      // NEITHER store: the mirror line below never ran. The two stores are
      // independent, and the server's is the one a score of record is
      // computed from, so a local failure may not take it down as well.
      //
      // A CONFLICT is the exception, and it is why this is not a bare
      // try/finally. `SaveConflictError` means another tab owns this attempt
      // and has written past us; mirroring our log then would push a
      // divergent branch of the same attempt at the server. That failure
      // still propagates before any mirroring, exactly as it did.
      const snapshot = [...log];
      try {
        local.save(log);
      } catch (err) {
        if (err instanceof SaveConflictError) throw err;
        mirror.enqueue(snapshot);
        throw err;
      }
      mirror.enqueue(snapshot);
    },
    clear: () => {
      // Server rows are append-only and stay; only local state is dropped.
      const v = local.load();
      const started = v?.log[0];
      if (started?.type === "attempt_started") {
        removeMigratedItem(storage, syncKey(started.attemptId));
      }
      local.clear();
    },
    flush: () => mirror.flush(),
    status: () => mirror.status(),
    resume: () => {
      // Re-read the stored log first: the surface that owes the candidate an
      // answer is often not the one that ran the sitting. /report loads a
      // fresh persistence for the same attempt, and before this it fired no
      // pass at all — which is how a failed finalize became a report with no
      // score, no reason and no action (TEN-206).
      const v = local.load();
      if (v && v.log.length > 0) return mirror.retryNow([...v.log]);
      return mirror.retryNow();
    },
    subscribe: (fn) => mirror.subscribe(fn),
  };
}

/**
 * The service answered, and what it said is not the shape this build knows.
 *
 * TYPED, because the two create paths have different readers: the start path
 * puts the message in front of the candidate, and the mirror hands it to
 * `onSyncError`. Both used to dereference the body and produce
 * `Cannot read properties of undefined` — a raw TypeError shown to a person
 * (TEN-230). An `id` that is present but not a NON-EMPTY STRING is refused
 * here too, because it would otherwise throw one route later, inside
 * `apiPath()`, on every sync pass for the rest of the sitting.
 */
export class ServiceShapeError extends Error {
  constructor(path: string, what: string) {
    super(`the exam service answered ${path} with something this build cannot read: ${what}`);
    this.name = "ServiceShapeError";
  }
}

/**
 * The server attempt id out of a create response. One reader, two call sites
 * (the mirror and the pre-created start), so they cannot disagree.
 */
function createdAttemptId(created: Record<string, unknown>, path: string): string {
  const attempt = created.attempt;
  if (typeof attempt !== "object" || attempt === null) {
    throw new ServiceShapeError(path, "no `attempt` object in the body");
  }
  const id = (attempt as { id?: unknown }).id;
  if (typeof id !== "string" || id === "") {
    throw new ServiceShapeError(path, "`attempt.id` is not a non-empty string");
  }
  return id;
}

/** One track's exposure record, as POST /attempts returns it. */
interface DeckRecord {
  trackId: string;
  bankSha256: string;
  itemIds: string[];
}

/**
 * The deck the candidate is about to be SHOWN is not the deck the exposure
 * log (attempt_decks) says was dealt. Thrown instead of presenting: a
 * divergent deck is a measurement-validity defect, and a silent one is worse
 * than a blocked start.
 *
 * The check moved when the server became the authority on item selection.
 * It used to compare the recorded deck against a deck this BUILD re-derived
 * from its own bundled bank — the only check available while the browser
 * held the bank. The browser no longer holds one: the operational bank is
 * server-only (docs/ARCHITECTURE.md §3), so the presented deck now comes
 * from GET /attempts/:id/items and is compared against the ids POST
 * /attempts recorded for the same attempt. That is a stronger check on the
 * thing that actually matters — presented === recorded — and it no longer
 * fires merely because two banks differ.
 */
export class DeckMismatchError extends Error {
  constructor(
    readonly recorded: readonly DeckRecord[],
    readonly presented: readonly DeckRecord[],
  ) {
    super(
      "the deck about to be presented is not the deck the server recorded " +
        `(recorded: ${describeDecks(recorded)}; presented: ${describeDecks(presented)})`,
    );
    this.name = "DeckMismatchError";
  }
}

const describeDecks = (decks: readonly DeckRecord[]): string =>
  decks
    .map((d) => `${d.trackId}=${d.bankSha256.slice(0, 12)}x${d.itemIds.length}`)
    .join(",") || "none";

/** Field-by-field (not JSON-shape) equality: same track, same bank, same order. */
function sameDeck(a: DeckRecord, b: DeckRecord): boolean {
  return (
    a.trackId === b.trackId &&
    a.bankSha256 === b.bankSha256 &&
    a.itemIds.length === b.itemIds.length &&
    a.itemIds.every((id, i) => id === b.itemIds[i])
  );
}

function readDecks(created: Record<string, unknown>): DeckRecord[] | undefined {
  const decks = created.decks;
  return Array.isArray(decks) ? (decks as DeckRecord[]) : undefined;
}

/**
 * Create the server attempt UP FRONT (before `attempt_started` is
 * committed) so the deck is sampled, recorded and dealt against the SERVER
 * attempt id. `decks: true` asks for that exposure row.
 *
 * The returned `decks` are the ROW the server just wrote. They are STORED,
 * not re-derived: this build has no operational bank to re-derive from, and
 * the deck it will present is the one `GET /attempts/:id/items` serves out
 * of that same row. {@link fetchPresentedDeck} checks the two against each
 * other, so a deck that arrives with different ids than the exposure log
 * holds stops the run instead of quietly becoming the sitting.
 *
 * The sync state is pre-written under the returned id, so when the session
 * adopts it as its attemptId the mirror reuses this attempt instead of
 * creating a second one.
 */
export async function createServerAttempt(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  locale: string,
): Promise<string> {
  const created = await postJson(storage, opts, apiPath("createAttempt"), { locale, decks: true });
  const id = createdAttemptId(created, apiPath("createAttempt"));
  const recorded = readDecks(created);
  writeSyncState(storage, id, {
    serverAttemptId: id,
    syncedThrough: 0,
    finalized: false,
    // No decks in the response = the host wired no sampler, so there is no
    // exposure row, and nothing to hold the presented deck to.
    ...(validDecks(recorded) ? { deck: recorded } : {}),
  });
  return id;
}

/** One item as `GET /attempts/:id/items` serves it (redacted during a sitting). */
export interface PresentedDeck {
  phase: "sitting" | "review";
  /** Content address of the bank the ids index into; null when no deck was dealt. */
  deckDigest: string | null;
  /** True when the mounted instrument is the PUBLIC released-practice tier. */
  released: boolean;
  items: ReadonlyArray<Record<string, unknown>>;
}

/**
 * The deck the server says this attempt was dealt, verified against the deck
 * the server RECORDED when the attempt was created.
 *
 * Both sides are the server's, which is the point: item selection is no
 * longer a thing two banks agree about by luck. What is checked here is that
 * the bytes about to be presented are the bytes the exposure log claims —
 * across two requests, a reload, and whatever a stale tab or a swapped
 * `attemptId` might have done in between.
 */
export async function fetchPresentedDeck(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  attemptId: string,
): Promise<PresentedDeck> {
  const body = await getJson(storage, opts, apiPath("attemptItems", { id: attemptId }));
  const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
  const deck: PresentedDeck = {
    phase: body.phase === "review" ? "review" : "sitting",
    deckDigest: typeof body.deckDigest === "string" ? body.deckDigest : null,
    released: body.released === true,
    items,
  };
  const recorded = readSyncState(storage, attemptId).deck;
  if (recorded !== undefined) {
    const presented: DeckRecord[] = [
      {
        trackId: "t2",
        bankSha256: deck.deckDigest ?? "",
        itemIds: items.map((i) => (typeof i.id === "string" ? i.id : "")),
      },
    ];
    const expect = recorded.filter((d) => d.trackId === "t2");
    if (expect.length !== 1 || !sameDeck(expect[0], presented[0])) {
      throw new DeckMismatchError(expect, presented);
    }
  }
  return deck;
}

/**
 * One track FORM as `GET /attempts/:id/track/:trackId` serves it: T1, T3 or
 * T4 (t2 is dealt a deck, not a form, and the server answers 400).
 *
 * `view` stays a bare record here on purpose. This module owns the transport;
 * which fields of a REDACTED view may be presented is a per-track question,
 * and it is answered in exactly one place — `lib/instrument/hostedDeck.ts`.
 */
export interface PresentedTrackView {
  phase: "sitting" | "review";
  released: boolean;
  view: Record<string, unknown>;
}

/** The tracks dealt a form. T2 is dealt a deck — see {@link fetchPresentedDeck}. */
export type FormTrackId = "t1" | "t3" | "t4";

/**
 * The redacted form this attempt was dealt for `trackId`.
 *
 * There is no phase parameter, and there must never be one: the server reads
 * the phase off `attempts.finalized_at`, so nothing a browser sends can turn
 * a sitting view into a review view (docs/ARCHITECTURE.md §4).
 */
export async function fetchTrackView(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  attemptId: string,
  trackId: FormTrackId,
): Promise<PresentedTrackView> {
  const path = apiPath("attemptTrackView", { id: attemptId, trackId });
  const body = await getJson(storage, opts, path);
  const view = body.view;
  if (typeof view !== "object" || view === null || Array.isArray(view)) {
    throw new Error(`GET ${path} returned no view`);
  }
  return {
    phase: body.phase === "review" ? "review" : "sitting",
    released: body.released === true,
    view: view as Record<string, unknown>,
  };
}

/**
 * Browser entry point for a hosted track FORM. Null when this run is not the
 * server's — the same rule (and the same reason) as {@link fetchServerDeck}.
 */
export async function fetchServerTrackView(
  attemptId: string,
  trackId: FormTrackId,
): Promise<PresentedTrackView | null> {
  if (!isServerAttempt(attemptId)) return null;
  return fetchTrackView(window.localStorage, browserApiOptions(), attemptId, trackId);
}

/** One assistant turn from `POST /attempts/:id/t3/assist`. */
export interface T3AssistResponse {
  text: string;
  claimRefs: string[];
  seq: number;
}

/**
 * Ask the SERVER for one T3 assistant reply. The reply names its claims by
 * opaque per-attempt ref, and the server records the turn itself — this
 * client cannot write an `assisted` row and cannot tell a plant from a piece
 * of correct advice (docs/ARCHITECTURE.md §4, CONTRACT §3).
 *
 * Retrying the same (prompt, promptSeq, regenNonce) replays the stored reply
 * instead of surfacing the next plant, so a retry is safe.
 */
export async function postT3Assist(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  attemptId: string,
  req: { prompt: string; promptSeq: number; regenNonce: number; seq: number },
): Promise<T3AssistResponse> {
  const path = apiPath("t3Assist", { id: attemptId });
  const body = await postJson(storage, opts, path, {
    ...req,
    clientTs: new Date().toISOString(),
  });
  if (typeof body.text !== "string" || !Array.isArray(body.claimRefs)) {
    throw new Error(`POST ${path} returned no reply`);
  }
  return {
    text: body.text,
    claimRefs: body.claimRefs.filter((r): r is string => typeof r === "string"),
    seq: typeof body.seq === "number" ? body.seq : req.seq,
  };
}

/**
 * Mirror ONE client-authored transcript turn (`prompted`, `challenged`,
 * `accepted`, `verified`, `revised`, `regenerated`, `submitted`).
 *
 * These rows are what the server's T3 score reads for stances and for the
 * final answer, so a hosted sitting that never posted them would be scored
 * as a candidate who challenged nothing. `assisted` is refused by the server
 * and is never sent: that row is the server's own.
 */
export async function postTranscriptTurn(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  attemptId: string,
  trackId: string,
  turn: { seq: number; verb: string; object: string; text?: string; claimRefs?: readonly string[] },
): Promise<void> {
  await postJson(storage, opts, apiPath("appendTranscript", { id: attemptId }), {
    trackId,
    seq: turn.seq,
    verb: turn.verb,
    body: {
      object: turn.object,
      ...(turn.text !== undefined ? { text: turn.text } : {}),
      ...(turn.claimRefs !== undefined ? { claimRefs: [...turn.claimRefs] } : {}),
    },
    clientTs: new Date().toISOString(),
  });
}

/**
 * THE BROWSER NO LONGER ASKS FOR A TRACK SCORE (TEN-126).
 *
 * `postTrackScore` and `scoreTrackOnServer` used to build
 * `POST /attempts/:id/score` here, and the exam page called them at TRACK
 * completion. TEN-60 closed the answer-key oracle by refusing that route on
 * an open sitting, TEN-66 moved score issuance into `/finalize`, and this
 * caller never stopped asking — so the live run of 2026-09-04 collected eight
 * 409s and printed one of them to the candidate. The request shape is gone
 * rather than deferred: with no builder for it, no code path can score an
 * open attempt. The scores of record are read back through
 * `GET /attempts/:id` (`features/report/scoresOfRecord.ts`).
 */

/**
 * True when THIS attempt is one the server knows about. A server-mode run
 * whose create failed (offline, backend down) keeps a client-local attempt
 * id and stays on the bundled released-practice deck — the same content the
 * static build runs on, and the only content this bundle has.
 */
function isServerAttempt(attemptId: string): boolean {
  return (
    isServerMode() &&
    typeof window !== "undefined" &&
    getServerAttemptId(window.localStorage, attemptId) !== undefined
  );
}

/**
 * Browser entry point for the SITTING DECK. Returns null when the deck is
 * this build's own (static mode, or a run the server never created), which
 * is the caller's signal to use the bundled released-practice tier.
 *
 * A DeckMismatchError is not caught here: presenting a deck the exposure log
 * contradicts is a measurement-validity defect, so the caller must show it
 * and leave the track unstarted.
 */
export async function fetchServerDeck(attemptId: string): Promise<PresentedDeck | null> {
  if (!isServerAttempt(attemptId)) return null;
  return fetchPresentedDeck(window.localStorage, browserApiOptions(), attemptId);
}

/**
 * Browser entry point for run start. Server mode: returns the pre-created
 * server attempt id to adopt as the session attemptId. Static mode: returns
 * null, and the caller mints a client-local id for a run on this build's
 * bundled practice deck — the only content that build has, and a tier that
 * issues no score of record.
 *
 * A HOSTED create that fails REJECTS (TEN-114). It used to return null, and
 * the run started anyway: the sitting silently became the released-practice
 * deck, whose keys are published on purpose, the browser marked its own
 * paper, and the service held no record of the sitting — with nothing on
 * screen to say so. Substituting one instrument for another is the same
 * measurement-validity defect as {@link DeckMismatchError}, so it gets the
 * same answer: the caller must SHOW the failure and not start the run.
 */
export async function startServerAttempt(locale: string): Promise<string | null> {
  if (!isServerMode() || typeof window === "undefined") {
    return null;
  }
  return createServerAttempt(window.localStorage, browserApiOptions(), locale);
}

// ---------------------------------------------------------------------------
// Env-selected browser singleton
// ---------------------------------------------------------------------------

/**
 * Keyed by the storage object (same pattern as @ailx/session’s rev
 * tracking): if localStorage is swapped out — jsdom tests do — a fresh
 * persistence (and mirror state) is built for it.
 */
const byStorage = new WeakMap<object, AttemptPersistence>();

export function browserApiOptions(): ApiPersistenceOptions {
  return {
    baseUrl: apiBase(),
    siteRoot: siteApiRoot(),
    fetchFn: (...args) => window.fetch(...args),
  };
}

/** Browser-only (call from effects/handlers, never during SSR render). */
export function getAttemptPersistence(): AttemptPersistence {
  const storage = window.localStorage;
  let p = byStorage.get(storage);
  if (!p) {
    p = isServerMode()
      ? createApiPersistence(storage, browserApiOptions())
      : createLocalPersistence(storage);
    byStorage.set(storage, p);
  }
  return p;
}
