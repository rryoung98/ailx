/**
 * Persistence of the append-only session log. Framework-agnostic: takes any
 * `StorageLike` (browser localStorage, or an in-memory map in tests).
 */

import type { SequencedEntry } from "./machine.js";

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

export function loadAttempt(storage: StorageLike): SequencedEntry[] | null {
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
  return (parsed as PersistedShape).log;
}

export function clearAttempt(storage: StorageLike): void {
  storage.removeItem(ATTEMPT_KEY);
}
