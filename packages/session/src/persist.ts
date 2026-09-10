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

/**
 * A foreign write this tab CANNOT absorb: the stored log holds work this tab
 * does not have, so saving over it would delete somebody's sitting.
 *
 * The message is read by a candidate, not only by a developer — the exam page
 * renders `err.message` under its persistence warning — so it says the one
 * thing that matters: this tab has stopped saving, and work done here from
 * now on is not being recorded. It does NOT promise a recovery, because at
 * this point there is not one this tab can perform. The revisions stay on the
 * error for whoever reads a log.
 */
export class SaveConflictError extends Error {
  constructor(public readonly storedRev: number, public readonly expectedRev: number) {
    super(
      "This run is open in another tab, and that tab has work this one does not have. "
      + "To avoid deleting it, this tab has STOPPED SAVING: what you do here now is not "
      + "being recorded. Carry on in the other tab, or restart this run here. "
      + `(stored rev ${storedRev}, expected ${expectedRev})`,
    );
    this.name = "SaveConflictError";
  }
}

function readStoredShape(storage: StorageLike): PersistedShape | null {
  try {
    const raw = readMigratedItem(storage, ATTEMPT_KEY);
    if (!raw) return null;
    const shape = JSON.parse(raw) as PersistedShape;
    return typeof shape === "object" && shape !== null ? shape : null;
  } catch {
    return null;
  }
}

function readStoredRev(storage: StorageLike): number {
  const shape = readStoredShape(storage);
  return shape !== null && typeof shape.rev === "number" ? shape.rev : 0;
}

/**
 * Is every entry the OTHER writer stored already in the log we are about to
 * write? Compared entry by entry from seq 0, because the log is append-only:
 * if the stored log is a prefix of ours, our write contains all of it and
 * loses nothing, whoever produced it.
 *
 * Unreadable stored bytes count as contained — there is no work in them to
 * lose, and `loadAttemptValidated` would discard them on the next read
 * anyway. A stored log LONGER than ours is not contained, even when it starts
 * the same way: those extra entries are exactly the work the compare-and-swap
 * exists to protect.
 */
function storedWorkIsContainedIn(storage: StorageLike, log: readonly SequencedEntry[]): boolean {
  const shape = readStoredShape(storage);
  const stored = shape !== null && Array.isArray(shape.log) ? shape.log : [];
  if (stored.length > log.length) return false;
  return stored.every((entry, i) => JSON.stringify(entry) === JSON.stringify(log[i]));
}

/**
 * Write the log, re-deriving the compare-and-swap token from the revision
 * that is in storage RIGHT NOW.
 *
 * A conflict is a thing to recover from, not a switch. `lastSeenRev` used to
 * be left behind after one `SaveConflictError`, so the same two numbers were
 * compared on every later save and the sitting was never saved again —
 * locally or server-side — while the candidate went on answering, and the
 * report was then built from the prefix that stopped at the conflict
 * (TEN-124). A foreign write whose work is already in our log is now absorbed
 * and the save proceeds from the current revision.
 *
 * What is NOT recovered from is a foreign write holding work we do not have.
 * That still throws, every time, and the caller is told in a sentence a
 * candidate can act on — refusing loudly is the honest end of "do not accept
 * work you are not saving", and silently adopting the other tab's revision
 * would delete their run.
 */
export function saveAttempt(storage: StorageLike, log: readonly SequencedEntry[]): void {
  const storedRev = readStoredRev(storage);
  const expected = lastSeenRev.get(storage) ?? storedRev;
  if (storedRev !== expected && !storedWorkIsContainedIn(storage, log)) {
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
 * A stored attempt that is present and unreadable — bytes that are not JSON,
 * or a shape this build does not know. It is a LOSS, not an absence, so it is
 * reported like any other drop rather than as `null` (TEN-220). `dropped` is
 * 1 because one stored attempt was discarded; how many entries were inside it
 * is exactly what could not be read.
 */
function unreadableAttempt(reason: string): ValidatedLog {
  return { log: [], dropped: 1, reason, legacyScores: 0, legacyTracks: [] };
}

/**
 * Load + validate the stored attempt. Returns null ONLY when nothing is
 * stored at all — the one case that means "there was no run".
 *
 * `dropped > 0` means work was discarded, whether that is a corrupt tail
 * (the valid prefix is still returned, so no good data is lost) or the WHOLE
 * log. The two used to be collapsed: a log whose first entry failed to replay
 * returned `null`, which the caller could not tell from a browser that had
 * never sat anything, so the candidate started over with no notice at all
 * (TEN-220). An empty result with `dropped > 0` is now a distinct return, and
 * `persistNotice` says so out loud.
 */
export function loadAttemptValidated(storage: StorageLike): ValidatedLog | null {
  const raw = readMigratedItem(storage, ATTEMPT_KEY);
  lastSeenRev.set(storage, readStoredRev(storage));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unreadableAttempt("the stored run could not be parsed");
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    (parsed as PersistedShape).formatVersion !== 1 ||
    !Array.isArray((parsed as PersistedShape).log)
  ) {
    return unreadableAttempt("the stored run is not in a format this build knows");
  }
  return validateStoredLog((parsed as PersistedShape).log);
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
