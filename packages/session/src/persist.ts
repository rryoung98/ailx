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
 */

import type { SequencedEntry, SessionLogEntry } from "./machine.js";
import { append } from "./machine.js";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ATTEMPT_KEY = "ailx:attempt:v1";

interface PersistedShape {
  formatVersion: 1;
  log: SequencedEntry[];
}

export function saveAttempt(storage: StorageLike, log: readonly SequencedEntry[]): void {
  const shape: PersistedShape = { formatVersion: 1, log: [...log] };
  storage.setItem(ATTEMPT_KEY, JSON.stringify(shape));
}

export interface ValidatedLog {
  /** Longest valid prefix of the stored log (machine-replayable, seq 0..n-1). */
  log: SequencedEntry[];
  /** Entries discarded after the first invariant violation. 0 for a clean log. */
  dropped: number;
  /** Reason the first dropped entry was rejected (undefined when dropped=0). */
  reason?: string;
}

/**
 * Replay `raw` through the session machine. Every entry must (a) carry a
 * `seq` exactly equal to its position (uniqueness + contiguity — duplicate
 * or out-of-order appends from a second tab fail here) and (b) pass the
 * machine's own `append()` validation. Returns the longest valid prefix.
 */
export function validateStoredLog(raw: readonly unknown[]): ValidatedLog {
  let log: SequencedEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (typeof e !== "object" || e === null) {
      return { log, dropped: raw.length - i, reason: `entry ${i} is not an object` };
    }
    const seq = (e as { seq?: unknown }).seq;
    if (seq !== i) {
      return {
        log,
        dropped: raw.length - i,
        reason: `entry ${i} has seq ${String(seq)} — duplicate or out-of-order append`,
      };
    }
    try {
      log = append(log, e as SessionLogEntry);
    } catch (err) {
      return { log, dropped: raw.length - i, reason: `entry ${i} rejected: ${String(err)}` };
    }
  }
  return { log, dropped: 0 };
}

/**
 * Load + validate the stored attempt. Returns null when nothing valid is
 * stored. `dropped > 0` means the stored log had a corrupt tail that was
 * truncated (the valid prefix is still returned so no good data is lost).
 */
export function loadAttemptValidated(storage: StorageLike): ValidatedLog | null {
  const raw = storage.getItem(ATTEMPT_KEY);
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
  storage.removeItem(ATTEMPT_KEY);
}
