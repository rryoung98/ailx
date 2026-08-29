/**
 * Share payload — the EXACT, allowlisted set of fields that leaves the
 * account when a candidate creates an unlisted share link.
 *
 * This is a privacy boundary expressed as a pure function, so it can be
 * asserted byte-for-byte in a test (`packages/report/test/share.test.ts`).
 * The rule: a share carries the playful player-type card, the four-track
 * SHAPE, and the composite BAND. It carries no composite number, no
 * percentile, no item ids, no per-item responses, no confidence log, no
 * event log, no attempt id, no locale, no participant reference.
 *
 * ITEM-BANK LEAKAGE (exam integrity): nothing here is derived per item.
 * `tracks` is four aggregate 0-100 values; the T2 deck, its item ids, the
 * answer keys and the per-item correctness pattern all stay server-side.
 * An unlimited number of shared cards therefore reveals nothing about which
 * items exist or which answers they take.
 *
 * The payload is FROZEN at creation time and stored as-is. A later change to
 * this function cannot retroactively widen what an already-created link
 * exposes; `v` records which shape a stored row was written under.
 */
import { TRACK_IDS, type Band, type SessionState, type TrackRawScores } from "@ailx/session";
import { candidateComposite } from "./composite.js";
import { playerType, type Pole } from "./playerType.js";

export const SHARE_PAYLOAD_VERSION = 1;

/** Serialized pole — the same four letters the report card shows. */
export interface SharePole {
  track: Pole["track"];
  letter: string;
  label: string;
  high: boolean;
}

export interface SharePayload {
  v: typeof SHARE_PAYLOAD_VERSION;
  /** Instrument identity, so an old card cannot be read as a new one. */
  instrument: string;
  band: Band;
  playerType: {
    code: string;
    name: string;
    tagline: string;
    poles: SharePole[];
  };
  /** Track SHAPE: four aggregate 0-100 values, one decimal. Never per item. */
  tracks: Record<(typeof TRACK_IDS)[number], number>;
  /**
   * Path of the candidate's own live built site, or null. Separate opt-in:
   * it is their creative artifact, not a derived figure, so it is only ever
   * present when they asked for it explicitly.
   */
  site: string | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface SharePayloadOptions {
  /** Live-site path, ONLY when the candidate opted in separately. */
  site?: string | null;
}

/** Pure. Returns null when the run is not fully scored (nothing to share). */
export function buildSharePayload(
  state: SessionState,
  options: SharePayloadOptions = {},
): SharePayload | null {
  const summary = candidateComposite(state);
  if (summary === null) return null;
  return sharePayloadFrom(summary.trackRaw, summary.band as Band, {
    instrument: `${state.config?.instrument ?? "ailx"} ${state.config?.version ?? "2026.1"}`,
    site: options.site ?? null,
  });
}

/**
 * The serializer itself, separated so tests (and any caller that already has
 * the track shape) exercise the exact allowlist without a whole session.
 */
export function sharePayloadFrom(
  trackRaw: TrackRawScores,
  band: Band,
  meta: { instrument: string; site?: string | null },
): SharePayload {
  const p = playerType(trackRaw);
  const tracks = {} as Record<(typeof TRACK_IDS)[number], number>;
  for (const t of TRACK_IDS) tracks[t] = round1(trackRaw[t]);
  return {
    v: SHARE_PAYLOAD_VERSION,
    instrument: meta.instrument,
    band,
    playerType: {
      code: p.code,
      name: p.name,
      tagline: p.tagline,
      poles: p.poles.map((pole) => ({
        track: pole.track,
        letter: pole.letter,
        label: pole.label,
        high: pole.high,
      })),
    },
    tracks,
    site: meta.site ?? null,
  };
}

/** Keys a stored payload must have — used to reject anything malformed on read. */
const REQUIRED_KEYS = ["v", "instrument", "band", "playerType", "tracks", "site"] as const;

/**
 * Parse a payload read back out of storage. Unknown or missing shapes read as
 * null rather than throwing: a row written by a future version must not 500
 * the view, and a row with extra keys must not be re-served with them.
 */
export function parseSharePayload(value: unknown): SharePayload | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.v !== SHARE_PAYLOAD_VERSION) return null;
  for (const k of REQUIRED_KEYS) if (!(k in raw)) return null;
  const pt = raw.playerType as SharePayload["playerType"] | undefined;
  const tracks = raw.tracks as Record<string, number> | undefined;
  if (typeof pt !== "object" || pt === null || typeof tracks !== "object" || tracks === null) return null;
  if (!Array.isArray(pt.poles)) return null;
  if (TRACK_IDS.some((t) => typeof tracks[t] !== "number")) return null;
  const clean = {} as Record<(typeof TRACK_IDS)[number], number>;
  for (const t of TRACK_IDS) clean[t] = tracks[t];
  return {
    v: SHARE_PAYLOAD_VERSION,
    instrument: String(raw.instrument),
    band: raw.band as Band,
    playerType: {
      code: String(pt.code),
      name: String(pt.name),
      tagline: String(pt.tagline),
      poles: pt.poles.map((pole) => ({
        track: pole.track,
        letter: String(pole.letter),
        label: String(pole.label),
        high: pole.high === true,
      })),
    },
    tracks: clean,
    site: typeof raw.site === "string" ? raw.site : null,
  };
}

/**
 * The card's text lines, in render order. ONE definition, shared by the HTML
 * share view and the OG image route, so the social preview can never drift
 * from the page it previews (DRY).
 */
export function shareCardLines(payload: SharePayload): {
  eyebrow: string;
  code: string;
  name: string;
  tagline: string;
  band: string;
  tracks: { track: string; value: number }[];
} {
  return {
    eyebrow: `${payload.instrument.toUpperCase()} · PLAYER TYPE`,
    code: payload.playerType.code,
    name: payload.playerType.name,
    tagline: payload.playerType.tagline,
    band: payload.band,
    tracks: TRACK_IDS.map((t) => ({ track: t.toUpperCase(), value: payload.tracks[t] })),
  };
}
