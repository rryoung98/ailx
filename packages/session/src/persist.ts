/**
 * Persistence of the append-only session log. Framework-agnostic: takes any
 * `StorageLike` (browser localStorage, or an in-memory map in tests).
 *
 * Loading is VALIDATED (audit hardening): a stored log is replayed entry by
 * entry through the same `append()` the live session uses, so every machine
 * invariant (legal transitions, nondecreasing timestamps, budget accounting)
 * is re-checked, and `seq` must be exactly contiguous from 0. A corrupt tail
 * — e.g. interleaved writes from a second tab, a duplicated append, or a
 * hand-edited entry — is truncated at the first violation and reported via
 * `dropped`, instead of being silently folded into state.
 *
 * ONE THING IS NOT CORRUPTION, and used to be indistinguishable from it: a
 * `track_scored` entry written before scores had to attest their evidence.
 * That is a build-age problem, not a tamper, so it is counted separately in
 * `legacyScores` and skipped rather than truncated at. See `ValidatedLog`.
 */

import { readMigratedItem, removeMigratedItem } from "@ailx/core";
import type { SequencedEntry, SessionLogEntry } from "./machine.js";
import { append, isPreAttestationScore } from "./machine.js";
import type { TrackId } from "./scoring.js";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The in-flight sitting. Renamed from `ailx:attempt:v1` (docs/RENAME.md §5
 * step 7); every READ goes through `readMigratedItem`, so a browser holding a
 * half-finished run under the old key adopts it on the first load after the
 * deploy instead of losing it.
 */
export const ATTEMPT_KEY = "foray:attempt:v1";

interface PersistedShape {
  formatVersion: 1;
  /** Monotonic write revision — compare-and-swap token for multi-tab safety. */
  rev?: number;
  log: SequencedEntry[];
}

/**
 * Last revision this process observed per storage, keyed by the storage
 * object itself. A second tab writes through its OWN process, bumping the
 * stored rev; our next save then detects the foreign write and throws
 * instead of silently overwriting the other tab's appends (audit A2/B1).
 */
const lastSeenRev = new WeakMap<object, number>();

export class SaveConflictError extends Error {
  constructor(public readonly storedRev: number, public readonly expectedRev: number) {
    super(
      `attempt log was modified by another tab (stored rev ${storedRev}, expected ${expectedRev}) — refusing to overwrite`,
    );
    this.name = "SaveConflictError";
  }
}

function readStoredRev(storage: StorageLike): number {
  try {
    const raw = readMigratedItem(storage, ATTEMPT_KEY);
    if (!raw) return 0;
    const shape = JSON.parse(raw) as PersistedShape;
    return typeof shape.rev === "number" ? shape.rev : 0;
  } catch {
    return 0;
  }
}

export function saveAttempt(storage: StorageLike, log: readonly SequencedEntry[]): void {
  const storedRev = readStoredRev(storage);
  const expected = lastSeenRev.get(storage) ?? storedRev;
  if (storedRev !== expected) {
    throw new SaveConflictError(storedRev, expected);
  }
  const nextRev = storedRev + 1;
  const shape: PersistedShape = { formatVersion: 1, rev: nextRev, log: [...log] };
  storage.setItem(ATTEMPT_KEY, JSON.stringify(shape));
  lastSeenRev.set(storage, nextRev);
}

export interface ValidatedLog {
  /** Longest valid prefix of the stored log (machine-replayable, seq 0..n-1). */
  log: SequencedEntry[];
  /**
   * Entries discarded after the first invariant violation. 0 for a clean log.
   * THIS NUMBER MEANS TAMPER, and nothing else. A log left behind by an older
   * build is counted in {@link legacyScores} instead — see below.
   */
  dropped: number;
  /** Reason the first dropped entry was rejected (undefined when dropped=0). */
  reason?: string;
  /**
   * Pre-attestation `track_scored` entries removed while replaying (TEN-160).
   *
   * A build older than 2026-09-01 wrote scores with no `scoredBy` and no
   * `judgmentIds`, so `append()` refuses them and the whole tail after the
   * first one used to be truncated and reported as CORRUPTION. That reading
   * was wrong twice over: the log was not tampered with, and the truncation
   * threw away every completed track that came after the score.
   *
   * Such an entry is now skipped individually, and the replay continues. The
   * score itself is still refused, because it carries no evidence claim and
   * nothing can make one for it honestly. Everything else the candidate did
   * is kept.
   */
  legacyScores: number;
  /** Tracks whose stored score was pre-attestation, in log order. */
  legacyTracks: TrackId[];
}

/**
 * Replay `raw` through the session machine. Every entry must (a) carry a
 * `seq` exactly equal to its position (uniqueness + contiguity — duplicate
 * or out-of-order appends from a second tab fail here) and (b) pass the
 * machine's own `append()` validation. Returns the longest valid prefix.
 */
export function validateStoredLog(raw: readonly unknown[]): ValidatedLog {
  let log: SequencedEntry[] = [];
  const legacyTracks: TrackId[] = [];
  const stop = (i: number, reason: string): ValidatedLog => ({
    log,
    dropped: raw.length - i,
    reason,
    legacyScores: legacyTracks.length,
    legacyTracks,
  });
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (typeof e !== "object" || e === null) {
      return stop(i, `entry ${i} is not an object`);
    }
    const seq = (e as { seq?: unknown }).seq;
    if (seq !== i) {
      return stop(i, `entry ${i} has seq ${String(seq)} — duplicate or out-of-order append`);
    }
    /**
     * A score from a build older than the attestation invariant. Skipped, not
     * truncated at: the entries AFTER it are the rest of the candidate's
     * sitting, and they replay fine. `seq` is checked against the raw index
     * above, so skipping does not disturb contiguity; `append()` renumbers
     * the log it returns, so the surviving entries stay 0..n-1.
     */
    if (isPreAttestationScore(e)) {
      legacyTracks.push((e as { trackId: TrackId }).trackId);
      continue;
    }
    try {
      log = append(log, e as SessionLogEntry);
    } catch (err) {
      return stop(i, `entry ${i} rejected: ${String(err)}`);
    }
  }
  return { log, dropped: 0, legacyScores: legacyTracks.length, legacyTracks };
}

/**
 * Load + validate the stored attempt. Returns null when nothing valid is
 * stored. `dropped > 0` means the stored log had a corrupt tail that was
 * truncated (the valid prefix is still returned so no good data is lost).
 */
export function loadAttemptValidated(storage: StorageLike): ValidatedLog | null {
  const raw = readMigratedItem(storage, ATTEMPT_KEY);
  lastSeenRev.set(storage, readStoredRev(storage));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    (parsed as PersistedShape).formatVersion !== 1 ||
    !Array.isArray((parsed as PersistedShape).log)
  ) {
    return null;
  }
  const validated = validateStoredLog((parsed as PersistedShape).log);
  if (validated.log.length === 0) return validated.dropped > 0 ? null : validated;
  return validated;
}

export function loadAttempt(storage: StorageLike): SequencedEntry[] | null {
  const v = loadAttemptValidated(storage);
  if (v === null || v.log.length === 0) return null;
  return v.log;
}

export function clearAttempt(storage: StorageLike): void {
  removeMigratedItem(storage, ATTEMPT_KEY);
  lastSeenRev.set(storage, 0);
}
