/**
 * Share payload — the EXACT, allowlisted set of fields that leaves the
 * account when a candidate creates an unlisted share link.
 *
 * This is a privacy boundary expressed as a pure function, so it can be
 * asserted byte-for-byte in a test (`packages/report/test/share.test.ts`).
 * A share carries the playful player-type card, the four-track SHAPE, the
 * composite BAND, and — only for the SECTIONS the candidate switched on —
 * their strengths/watchouts text, their own process figures, the day they
 * finished, their own built site and their own one-line note.
 *
 * ITEM-BANK LEAKAGE (exam integrity): nothing here is derived per item.
 * `tracks` is four aggregate 0-100 values; the process section counts the
 * CANDIDATE's own actions (time on task, iteration ratio, verification
 * actions) and never an item, a deck size, an answer or a correctness bit.
 * The T2 deck, its item ids, the answer keys and the per-item correctness
 * pattern all stay server-side. An unlimited number of shared cards
 * therefore reveals nothing about which items exist or which answers they
 * take.
 *
 * The payload is FROZEN at creation time and stored as-is. A later change to
 * this function cannot retroactively widen what an already-created link
 * exposes; `v` records which shape a stored row was written under, and a v1
 * row reads back with every v2 section absent.
 */
import { TRACK_IDS, type Band, type SessionState, type TrackId, type TrackRawScores } from "@ailx/session";
import { candidateComposite } from "./composite.js";
import { trackInsights } from "./insights.js";
import { playerType, type Pole } from "./playerType.js";

export const SHARE_PAYLOAD_VERSION = 2;

/** Versions a stored row may legally have. v1 predates the opt-in sections. */
export const SHARE_PAYLOAD_VERSIONS = [1, SHARE_PAYLOAD_VERSION] as const;

/**
 * The opt-in units. ONE list, used by the builder, the parser, the server-side
 * enforcement in @ailx/backend and the checkbox UI — a section that is not in
 * this array cannot be requested, stored or rendered.
 *
 * `band`, `tracks` and `playerType` are not sections: they are the card, and a
 * share with none of them would not be a share.
 */
export const SHARE_SECTIONS = ["profile", "process", "completed", "site", "note"] as const;
export type ShareSection = (typeof SHARE_SECTIONS)[number];
export type ShareSections = Record<ShareSection, boolean>;

/**
 * What a candidate gets if they just press the button: the derived,
 * impersonal parts. The two sections that carry candidate-AUTHORED content
 * (their site, their note) default OFF and stay a deliberate act.
 */
export const DEFAULT_SHARE_SECTIONS: ShareSections = {
  profile: true,
  process: true,
  completed: true,
  site: false,
  note: false,
};

/** Every section on — the identity of the section gate, never a policy. */
export const ALL_SHARE_SECTIONS: ShareSections = Object.fromEntries(
  SHARE_SECTIONS.map((k) => [k, true]),
) as ShareSections;

/** Longest note we will store or render. Enough for a sentence, not a page. */
export const SHARE_NOTE_MAX = 240;

/**
 * Normalize an untrusted section selection. Unknown keys are dropped and a
 * non-boolean reads as the default, so a hostile body can only ever choose
 * among the sections that exist — the enforcement point is here and on the
 * server that calls it, never the UI.
 */
export function parseShareSections(raw: unknown): ShareSections {
  const out = { ...DEFAULT_SHARE_SECTIONS };
  if (typeof raw !== "object" || raw === null) return out;
  const obj = raw as Record<string, unknown>;
  for (const key of SHARE_SECTIONS) {
    // OWN properties only: a body with a `__proto__` payload must not be able
    // to switch a section on through the prototype chain.
    if (Object.prototype.hasOwnProperty.call(obj, key) && typeof obj[key] === "boolean") {
      out[key] = obj[key];
    }
  }
  return out;
}

/**
 * Sanitize a candidate-authored note: plain text, one line, length-capped.
 * Control characters (including newlines) collapse to spaces so the string
 * cannot smuggle layout into a card, and an empty result is null, not "".
 */
export function parseShareNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const flat = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat === "" ? null : flat.slice(0, SHARE_NOTE_MAX).trim();
}

/** Serialized pole — the same four letters the report card shows. */
export interface SharePole {
  track: Pole["track"];
  letter: string;
  label: string;
  high: boolean;
}

/**
 * Per-track PROCESS, not per-track content. Every number here describes what
 * the candidate did with their own time; none of it is derived from an item,
 * a deck, an answer key or a correctness pattern.
 */
export interface ShareProcessTrack {
  track: TrackId;
  /** Seconds of active (unpaused) work. */
  activeSeconds: number;
  /** The track's own budget, so the number reads as a proportion. */
  budgetSeconds: number;
  timedOut: boolean;
  /** revise+regenerate per prompt, or null when nothing was prompted. */
  iterationRatio: number | null;
  /** The candidate's own verification actions (verified + unique challenged). */
  verificationEvents: number;
}

export interface ShareProcess {
  totalActiveSeconds: number;
  tracks: ShareProcessTrack[];
}

export interface ShareProfile {
  strengths: string[];
  watchouts: string[];
}

export interface SharePayload {
  /** Shape the row was written under: 1 (card only) or 2 (opt-in sections). */
  v: (typeof SHARE_PAYLOAD_VERSIONS)[number];
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
  tracks: Record<TrackId, number>;
  /**
   * Path of the candidate's own live built site, or null. Separate opt-in:
   * it is their creative artifact, not a derived figure, so it is only ever
   * present when they asked for it explicitly.
   */
  site: string | null;
  /** Strengths/watchouts text derived from the four aggregates. Opt-in. */
  profile: ShareProfile | null;
  /** The candidate's own time-and-behaviour figures. Opt-in. */
  process: ShareProcess | null;
  /** The day the run's last recorded entry landed (YYYY-MM-DD). Opt-in. */
  completedOn: string | null;
  /** The candidate's own one-line "what I built" note. Opt-in, authored. */
  note: string | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface SharePayloadOptions {
  /** Live-site path, ONLY when the candidate opted in separately. */
  site?: string | null;
  /** Which sections may be serialized. Anything false becomes null. */
  sections?: ShareSections;
  /** Candidate-authored note; carried only when `sections.note` is on. */
  note?: string | null;
}

/** Day of a millisecond stamp, UTC. Pure: reads a stored stamp, never a clock. */
function dayOf(ms: number | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Pure. Returns null when the run is not fully scored (nothing to share). */
export function buildSharePayload(
  state: SessionState,
  options: SharePayloadOptions = {},
): SharePayload | null {
  const summary = candidateComposite(state);
  if (summary === null) return null;
  const sections = options.sections ?? DEFAULT_SHARE_SECTIONS;
  let process: ShareProcess | null = null;
  if (sections.process) {
    const insights = trackInsights(state);
    process = {
      totalActiveSeconds: insights.reduce((a, i) => a + i.activeSeconds, 0),
      tracks: insights.map((i) => ({
        track: i.trackId,
        activeSeconds: i.activeSeconds,
        budgetSeconds: i.budgetSeconds,
        timedOut: i.timedOut,
        iterationRatio: i.iterationRatio,
        verificationEvents: i.verificationEvents,
      })),
    };
  }
  return sharePayloadFrom(summary.trackRaw, summary.band as Band, {
    instrument: `${state.config?.instrument ?? "ailx"} ${state.config?.version ?? "2026.1"}`,
    site: options.site ?? null,
    sections,
    process,
    completedOn: sections.completed ? dayOf(state.lastTs) : null,
    note: options.note ?? null,
  });
}

export interface SharePayloadMeta {
  instrument: string;
  site?: string | null;
  sections?: ShareSections;
  process?: ShareProcess | null;
  completedOn?: string | null;
  note?: string | null;
}

/**
 * The serializer itself, separated so tests (and any caller that already has
 * the track shape) exercise the exact allowlist without a whole session.
 *
 * `meta.sections` is the LAST gate: a section switched off is null here even
 * if the caller passed data for it, so one wrong call site cannot widen a
 * share. Omitting `sections` serializes whatever the caller supplied — the
 * SELECTION is the gate, and every candidate-facing path
 * (`buildSharePayload`, `createShare`) always supplies one.
 */
export function sharePayloadFrom(
  trackRaw: TrackRawScores,
  band: Band,
  meta: SharePayloadMeta,
): SharePayload {
  const sections = meta.sections ?? ALL_SHARE_SECTIONS;
  const p = playerType(trackRaw);
  const tracks = {} as Record<TrackId, number>;
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
    site: sections.site ? (meta.site ?? null) : null,
    profile: sections.profile ? { strengths: p.strengths, watchouts: p.watchouts } : null,
    process: sections.process ? (meta.process ?? null) : null,
    completedOn: sections.completed ? (meta.completedOn ?? null) : null,
    note: sections.note ? parseShareNote(meta.note) : null,
  };
}

/** Keys a v1 row must have — the card that every version still carries. */
const REQUIRED_KEYS = ["v", "instrument", "band", "playerType", "tracks", "site"] as const;

const str = (v: unknown): string => String(v ?? "");

/** Strings only, capped in count and length — a stored array is still input. */
function parseLines(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((v) => str(v).slice(0, 200));
}

function parseProcess(value: unknown): ShareProcess | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.tracks)) return null;
  const byId = new Map<TrackId, Record<string, unknown>>();
  for (const t of raw.tracks) {
    if (typeof t !== "object" || t === null) continue;
    const row = t as Record<string, unknown>;
    if (TRACK_IDS.includes(row.track as TrackId)) byId.set(row.track as TrackId, row);
  }
  const tracks: ShareProcessTrack[] = [];
  for (const id of TRACK_IDS) {
    const row = byId.get(id);
    if (row === undefined) continue;
    tracks.push({
      track: id,
      activeSeconds: Number(row.activeSeconds) || 0,
      budgetSeconds: Number(row.budgetSeconds) || 0,
      timedOut: row.timedOut === true,
      iterationRatio: typeof row.iterationRatio === "number" ? row.iterationRatio : null,
      verificationEvents: Number(row.verificationEvents) || 0,
    });
  }
  if (tracks.length === 0) return null;
  return { totalActiveSeconds: Number(raw.totalActiveSeconds) || 0, tracks };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a payload read back out of storage. Unknown or missing shapes read as
 * null rather than throwing: a row written by a future version must not 500
 * the view, and a row with extra keys must not be re-served with them.
 */
export function parseSharePayload(value: unknown): SharePayload | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const version = (SHARE_PAYLOAD_VERSIONS as readonly unknown[]).includes(raw.v)
    ? (raw.v as SharePayload["v"])
    : null;
  if (version === null) return null;
  for (const k of REQUIRED_KEYS) if (!(k in raw)) return null;
  const pt = raw.playerType as SharePayload["playerType"] | undefined;
  const tracks = raw.tracks as Record<string, number> | undefined;
  if (typeof pt !== "object" || pt === null || typeof tracks !== "object" || tracks === null) return null;
  if (!Array.isArray(pt.poles)) return null;
  if (TRACK_IDS.some((t) => typeof tracks[t] !== "number")) return null;
  const clean = {} as Record<TrackId, number>;
  for (const t of TRACK_IDS) clean[t] = tracks[t];
  const profileRaw = raw.profile;
  const profile =
    typeof profileRaw === "object" && profileRaw !== null
      ? {
          strengths: parseLines((profileRaw as Record<string, unknown>).strengths, TRACK_IDS.length),
          watchouts: parseLines((profileRaw as Record<string, unknown>).watchouts, TRACK_IDS.length),
        }
      : null;
  return {
    v: version,
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
    profile,
    process: parseProcess(raw.process),
    completedOn:
      typeof raw.completedOn === "string" && DAY_RE.test(raw.completedOn) ? raw.completedOn : null,
    note: parseShareNote(raw.note),
  };
}

/** Minutes, rounded, for display. One definition for page, card and gallery. */
export function shareMinutes(seconds: number): number {
  return Math.max(0, Math.round(seconds / 60));
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
  /** One extra line for the preview: the strongest opted-in fact, or null. */
  highlight: string | null;
  footnotes: string[];
} {
  const footnotes: string[] = [];
  if (payload.process !== null) {
    footnotes.push(`${shareMinutes(payload.process.totalActiveSeconds)} min on task`);
  }
  if (payload.completedOn !== null) footnotes.push(payload.completedOn);
  if (payload.site !== null) footnotes.push("built a site");
  return {
    eyebrow: `${payload.instrument.toUpperCase()} · PLAYER TYPE`,
    code: payload.playerType.code,
    name: payload.playerType.name,
    tagline: payload.playerType.tagline,
    band: payload.band,
    tracks: TRACK_IDS.map((t) => ({ track: t.toUpperCase(), value: payload.tracks[t] })),
    highlight: payload.note ?? payload.profile?.strengths[0] ?? null,
    footnotes,
  };
}
