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
import {
  clearAttempt,
  loadAttemptValidated,
  saveAttempt,
  type SequencedEntry,
  type StorageLike,
  type ValidatedLog,
} from "@ailx/session";
import { DEV_USER_COOKIE, DEV_USER_HEADER } from "@ailx/backend";
import { t2DeckRecords } from "./instrument";
import { assetUrl, isServerMode } from "./mode";

export interface AttemptPersistence {
  load(): ValidatedLog | null;
  /** Synchronous; throws SaveConflictError on multi-tab races (unchanged). */
  save(log: readonly SequencedEntry[]): void;
  clear(): void;
  /** Resolves when pending server sync (if any) has settled. */
  flush(): Promise<void>;
}

export function createLocalPersistence(storage: StorageLike): AttemptPersistence {
  return {
    load: () => loadAttemptValidated(storage),
    save: (log) => saveAttempt(storage, log),
    clear: () => clearAttempt(storage),
    flush: () => Promise.resolve(),
  };
}

// ---------------------------------------------------------------------------
// Server mirror
// ---------------------------------------------------------------------------

export const DEV_USER_KEY = "ailx:dev-user";
/** Mirror progress key for an attempt. Exported so the E2E fixtures can seed
 *  a resumed run exactly as the app would have written it. */
export const syncKey = (clientAttemptId: string) => `ailx:sync:v1:${clientAttemptId}`;

interface SyncState {
  /** Server-side attempts.id (uuid) — the client attempt id stays in payloads. */
  serverAttemptId?: string;
  /** Count of log entries already mirrored (log seq is contiguous from 0). */
  syncedThrough: number;
  finalized: boolean;
}

export interface ApiPersistenceOptions {
  baseUrl: string;
  fetchFn: typeof fetch;
  /** Called when a sync pass fails; the pass is retried on the next save. */
  onSyncError?: (err: unknown) => void;
}

function readSyncState(storage: StorageLike, clientAttemptId: string): SyncState {
  try {
    const raw = storage.getItem(syncKey(clientAttemptId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncState>;
      if (typeof parsed.syncedThrough === "number" && parsed.syncedThrough >= 0) {
        return {
          serverAttemptId: typeof parsed.serverAttemptId === "string" ? parsed.serverAttemptId : undefined,
          syncedThrough: Math.floor(parsed.syncedThrough),
          finalized: parsed.finalized === true,
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

/** Single POST path shared by the mirror and attempt pre-creation. */
async function postJson(
  storage: StorageLike,
  opts: ApiPersistenceOptions,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await opts.fetchFn(`${opts.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [DEV_USER_HEADER]: devUser(storage),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

const DEV_USER_RE = /^[A-Za-z0-9_.@-]{1,64}$/;
/** Six months: long enough that a streak survives, short enough to expire. */
const DEV_USER_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

/**
 * Mirror the identity into a cookie so SERVER-RENDERED pages can see it.
 * `x-ailx-dev-user` only exists on fetches this app makes; a navigation to
 * /progress carries cookies and nothing else, so without this the server had
 * to treat every browser as anonymous.
 *
 * Not HttpOnly, and it cannot be: the value is minted here, in the browser,
 * from localStorage — the only writer is this function. Nothing is protected
 * by hiding it from script either, because dev auth is asserted, never
 * proven; anyone can send any id already. Lax keeps it off cross-site
 * requests while still riding a top-level navigation, which is the whole
 * point. localStorage stays the single source of truth: the cookie is only
 * ever overwritten from it, never read back into it, so a cleared browser
 * cannot be silently re-identified as its previous occupant.
 */
function mirrorDevUserCookie(user: string): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${DEV_USER_COOKIE}=${encodeURIComponent(user)}; Path=/; Max-Age=${DEV_USER_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/** Stable per-browser dev identity (dev AuthProvider asserts, never proves). */
export function devUser(storage: StorageLike): string {
  let user = storage.getItem(DEV_USER_KEY);
  if (!user || !DEV_USER_RE.test(user)) {
    user = `web-${Math.random().toString(36).slice(2, 12)}`;
    storage.setItem(DEV_USER_KEY, user);
  }
  mirrorDevUserCookie(user);
  return user;
}

/**
 * Forget this browser's dev identity — BOTH stores, or the next page load
 * would hand the server an id the tab no longer thinks it has.
 */
export function clearDevUser(storage: StorageLike): void {
  storage.removeItem(DEV_USER_KEY);
  if (typeof document === "undefined") return;
  document.cookie = `${DEV_USER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Server attempt id the mirror is (or will be) writing this attempt's rows
 * under — undefined until the attempt exists server-side. Consumed by the T1
 * site upload, which posts to the same attempt as the mirrored log.
 */
export function getServerAttemptId(storage: StorageLike, clientAttemptId: string): string | undefined {
  return readSyncState(storage, clientAttemptId).serverAttemptId;
}

class ServerMirror {
  private lastLog: readonly SequencedEntry[] = [];
  private inflight: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: StorageLike,
    private readonly opts: ApiPersistenceOptions,
  ) {}

  /** Queue a sync pass for `log`. Passes are serialized; failures retry on the next call. */
  enqueue(log: readonly SequencedEntry[]): void {
    this.lastLog = log;
    this.inflight = this.inflight.then(() =>
      this.syncPass().catch((err) => {
        (this.opts.onSyncError ?? ((e) => console.warn("[ailx sync]", e)))(err);
      }),
    );
  }

  flush(): Promise<void> {
    return this.inflight;
  }

  private post(path: string, body?: unknown): Promise<Record<string, unknown>> {
    return postJson(this.storage, this.opts, path, body);
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
      const created = await this.post("/attempts", {});
      state.serverAttemptId = (created.attempt as { id: string }).id;
      this.write(clientAttemptId, state);
    }
    for (let i = state.syncedThrough; i < log.length; i++) {
      const entry = log[i];
      await this.post(`/attempts/${state.serverAttemptId}/responses`, {
        seq: entry.seq,
        payload: entry,
        clientTs: entry.ts,
      });
      state.syncedThrough = i + 1;
      this.write(clientAttemptId, state);
    }
    if (log[log.length - 1].type === "attempt_completed") {
      await this.post(`/attempts/${state.serverAttemptId}/finalize`);
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
      local.save(log); // Local write is authoritative — throws before any mirroring.
      mirror.enqueue([...log]);
    },
    clear: () => {
      // Server rows are append-only and stay; only local state is dropped.
      const v = local.load();
      const started = v?.log[0];
      if (started?.type === "attempt_started") {
        storage.removeItem(syncKey(started.attemptId));
      }
      local.clear();
    },
    flush: () => mirror.flush(),
  };
}

/** One track's exposure record, as POST /attempts returns it. */
interface DeckRecord {
  trackId: string;
  bankSha256: string;
  itemIds: string[];
}

/**
 * The server recorded a deck this build cannot present — the exposure log
 * (attempt_decks) would claim items were shown that never were. Thrown
 * instead of starting the run: a divergent deck is a measurement-validity
 * defect, and a silent one is worse than a blocked start.
 */
export class DeckMismatchError extends Error {
  constructor(
    readonly recorded: readonly DeckRecord[],
    readonly expected: readonly DeckRecord[],
  ) {
    super(
      "server-recorded deck does not match the deck this build would present " +
        `(recorded banks: ${recorded.map((d) => `${d.trackId}=${d.bankSha256.slice(0, 12)}`).join(",") || "none"}; ` +
        `this build: ${expected.map((d) => `${d.trackId}=${d.bankSha256.slice(0, 12)}`).join(",") || "none"})`,
    );
    this.name = "DeckMismatchError";
  }
}

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
 * committed) so the T2 deck can be keyed to — and its item ids recorded
 * against — the SERVER attempt id. `decks: true` commits this client to
 * presenting exactly the deck derived from the returned id.
 *
 * The returned `decks` are the ROW the server just wrote, so they are
 * verified here against what this build would actually present — the two
 * are derived by the same pure function, but from each side's OWN bundled
 * snapshot. A tab whose chunks predate a bank change would otherwise sample
 * from the old bank and present a deck the exposure log says was never
 * shown, with nothing anywhere to notice. On divergence we throw rather
 * than present: the item ids the server recorded may not even exist in this
 * build's bank, so "adopt the server deck" is not available — refusing is.
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
  const created = await postJson(storage, opts, "/attempts", { locale, decks: true });
  const id = (created.attempt as { id: string }).id;
  const recorded = readDecks(created);
  if (recorded !== undefined) {
    // No decks in the response = the host wired no sampler, so no exposure
    // row exists to diverge from; anything else must match exactly.
    const expected = t2DeckRecords(id, locale);
    if (recorded.length !== expected.length || !expected.every((d, i) => sameDeck(recorded[i], d))) {
      throw new DeckMismatchError(recorded, expected);
    }
  }
  writeSyncState(storage, id, { serverAttemptId: id, syncedThrough: 0, finalized: false });
  return id;
}

/**
 * Browser entry point for run start. Server mode: returns the pre-created
 * server attempt id to adopt as the session attemptId. Static mode — or a
 * server-mode create that fails (offline, backend down) — returns null and
 * the caller falls back to a client-local attempt id: the deck derivation
 * is identical, it is just keyed to the local id and not recorded
 * server-side (the mirror will still lazily create an attempt for the log).
 *
 * A DeckMismatchError is NOT that kind of failure and is rethrown: falling
 * back would present a deck while the server holds an exposure row claiming
 * a different one. The caller must show it and let the run stay unstarted.
 */
export async function startServerAttempt(locale: string): Promise<string | null> {
  if (!isServerMode() || typeof window === "undefined") {
    return null;
  }
  try {
    return await createServerAttempt(window.localStorage, browserApiOptions(), locale);
  } catch (err) {
    if (err instanceof DeckMismatchError) throw err;
    console.warn("[ailx sync] server attempt creation failed; using a local attempt id", err);
    return null;
  }
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
    baseUrl: assetUrl("/api"),
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
