/**
 * Per-track runner checkpoints (F2). Kept OUT of the session log to keep
 * the log lean, under a dedicated localStorage key per attempt+track:
 *
 *   ailx:checkpoint:<attemptId>:<trackId>
 *
 * The exam page saves every onCheckpoint(state) here, rehydrates the
 * Runner from it on mount/reload, and — on timeout — scores the partial
 * artifact derived from the LAST checkpoint (see registry.checkpointToArtifact).
 *
 * Audit hardening: the stored shape (v2) embeds the attemptId and trackId it
 * was written for, and loadCheckpoint verifies BOTH against the requested
 * key. A payload copied under the wrong key (multi-tab races, manual edits,
 * restore tooling) is rejected instead of silently rehydrating another
 * attempt's work. Legacy v1 payloads (no binding) are also rejected —
 * fail closed: an absent checkpoint scores as a legitimate missing response.
 */
import type { StorageLike, TrackId } from "@ailx/session";
import { TRACK_IDS } from "@ailx/session";

export function checkpointKey(attemptId: string, trackId: TrackId): string {
  return `ailx:checkpoint:${attemptId}:${trackId}`;
}

interface CheckpointShape {
  formatVersion: 2;
  /** Attempt this checkpoint belongs to — verified on load. */
  attemptId: string;
  /** Track this checkpoint belongs to — verified on load. */
  trackId: TrackId;
  state: unknown;
}

export function saveCheckpoint(
  storage: StorageLike,
  attemptId: string,
  trackId: TrackId,
  state: unknown,
): void {
  const shape: CheckpointShape = { formatVersion: 2, attemptId, trackId, state };
  try {
    storage.setItem(checkpointKey(attemptId, trackId), JSON.stringify(shape));
  } catch {
    // Quota exceeded / private mode: the log still holds completed artifacts.
  }
}

export function loadCheckpoint(
  storage: StorageLike,
  attemptId: string,
  trackId: TrackId,
): unknown {
  const raw = storage.getItem(checkpointKey(attemptId, trackId));
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const shape = parsed as Partial<CheckpointShape>;
  if (
    shape.formatVersion !== 2 ||
    shape.attemptId !== attemptId ||
    shape.trackId !== trackId
  ) {
    return undefined;
  }
  return shape.state;
}

export function clearCheckpoint(
  storage: StorageLike,
  attemptId: string,
  trackId: TrackId,
): void {
  storage.removeItem(checkpointKey(attemptId, trackId));
}

export function clearAllCheckpoints(storage: StorageLike, attemptId: string): void {
  for (const t of TRACK_IDS) clearCheckpoint(storage, attemptId, t);
}
