/**
 * Bank custody: snapshot bytes → presented items, decks, grades.
 *
 * This is the code that used to live in `apps/web/lib/instrument.ts`, where a
 * client module statically imported the operational snapshot and shipped 104
 * answer keys to the candidate's devtools. It is unchanged in behaviour and
 * moved wholesale, because the fix is custody, not arithmetic: one module now
 * owns "what an item is and who may see it".
 *
 * Everything here is PURE. The only I/O in this package is the snapshot read
 * in `index.ts`, so the deck a browser is dealt stays byte-identically
 * re-derivable from (attempt id, bank sha256) alone (F16).
 */
import { sampleT2DeckIds, t2DeckSeed, D_PRIME_CEILING, maxAttainableDPrime } from "@ailx/track-t2";
import type { Locale, PresentedItem, RedactedItem, Verdict } from "./types.js";

export interface BankItem {
  id: string;
  type: string;
  locale: string;
  difficulty: string;
  stem: string;
  material: {
    kind: string;
    text?: string;
    svg?: string;
    dataUri?: string;
    data_uri?: string;
    [k: string]: unknown;
  };
  options: Array<{ id: string; label: string }>;
  key: string;
  rationale: string;
  provenance?: unknown;
}

interface SnapshotBlock {
  id: string;
  exposure_seconds?: number | null;
  untimed?: boolean;
}

export interface SnapshotTrack {
  trackId: string;
  plugin: string;
  config: Record<string, unknown>;
  rubricVersion: string;
  bank?: { items: BankItem[]; sha256?: string };
}

/**
 * Build-time content address of a track's score() source closure, emitted by
 * `@ailx/content-tools build-snapshot --scorers`. This is the AUDIT digest:
 * it identifies the scoring SOURCE, so it survives a bundler bump that
 * changes nothing about how a score is computed. Moving the bank behind this
 * package does not touch it — it hashes `score()` source only.
 */
export interface SnapshotScorer {
  trackId: "t1" | "t2" | "t3" | "t4";
  packageName: string;
  packageVersion: string;
  sources: Array<{ path: string; sha256: string }>;
  externals: string[];
  digest: string;
}

export interface Snapshot {
  format: string;
  instrument: { manifest: Record<string, unknown>; tracks: SnapshotTrack[] };
  scorers?: SnapshotScorer[];
}

export type ShortTrackId = "t1" | "t2" | "t3" | "t4";

const SNAPSHOT_TRACK_IDS: Record<ShortTrackId, string> = {
  t1: "t1-creative-build",
  t2: "t2-discrimination",
  t3: "t3-reasoning",
  t4: "t4-generative",
};

export function snapshotTrack(snap: Snapshot, trackId: ShortTrackId): SnapshotTrack {
  const t = snap.instrument.tracks.find((x) => x.trackId === SNAPSHOT_TRACK_IDS[trackId]);
  if (!t) throw new Error(`snapshot missing track ${trackId}`);
  return t;
}

/** Bank item type → T2Config item type. */
const TYPE_MAP: Record<string, string> = {
  "text-authenticity": "message-page",
  "image-provenance": "media-image",
  "message-hostility": "message-email",
  "provenance-reasoning": "provenance",
};

const DIFF_MAP: Record<string, number> = { easy: 0.25, medium: 0.5, hard: 0.85 };

/** Option ids that name the SIGNAL (synthetic / hostile) call. */
const SIGNAL_OPTION_IDS = new Set(["ai", "synthetic", "hostile"]);

/**
 * Per-item-type exposure seconds, read from the snapshot's instrument config
 * blocks (media-image 6, media-video 12, media-audio 10, message-email 25,
 * message-page 25; provenance untimed → undefined).
 */
export function t2ExposureSeconds(snap: Snapshot): Record<string, number | undefined> {
  const blocks = (snapshotTrack(snap, "t2").config.blocks ?? []) as SnapshotBlock[];
  const map: Record<string, number | undefined> = {};
  for (const b of blocks) {
    map[b.id] = b.untimed === true || b.exposure_seconds == null ? undefined : b.exposure_seconds;
  }
  return map;
}

/** Resolve an asset path relative to the host's basePath. */
export type AssetUrl = (path: string) => string;

function materialToString(m: BankItem["material"], assetUrl: AssetUrl): string {
  // The committed bank uses snake_case data_uri; accept camelCase and raw svg
  // too so image items always render as images (F3).
  if (m.kind === "image" && typeof m.src === "string") {
    return assetUrl(`/${String(m.src).replace(/^\/+/, "")}`);
  }
  if (typeof m.data_uri === "string") return m.data_uri;
  if (typeof m.dataUri === "string") return m.dataUri;
  if (typeof m.svg === "string") {
    return `data:image/svg+xml;base64,${Buffer.from(m.svg, "utf8").toString("base64")}`;
  }
  if (typeof m.text === "string") return m.text;
  if (m.kind === "email") {
    const parts: string[] = [];
    if (typeof m.from_display === "string" || typeof m.from_address === "string") {
      parts.push(
        `From: ${[m.from_display, m.from_address && `<${String(m.from_address)}>`].filter(Boolean).join(" ")}`,
      );
    }
    if (typeof m.subject === "string") parts.push(`Subject: ${m.subject}`);
    if (typeof m.body === "string") parts.push("", String(m.body));
    if (parts.length > 0) return parts.join("\n");
  }
  if (typeof m.body === "string") return m.body;      // chat
  if (typeof m.details === "string") return m.details; // scenario
  return JSON.stringify(m);
}

/**
 * ONE item in full — presented fields PLUS the key and rationale. The only
 * type in this package that carries both, and it is not exported: nothing
 * outside `bank.ts` may hold an item that has not been through
 * {@link redact}.
 */
interface FullItem extends PresentedItem {
  key: number;
  rationale: string;
}

/**
 * The WHOLE bank in T2Config item shape, every locale. Item ids are unique
 * across locales, so this is the right index for "resolve a recorded deck" and
 * "grade this item id" — neither of which should have to be told a locale it
 * could get wrong.
 */
function transformedAll(snap: Snapshot, assetUrl: AssetUrl): FullItem[] {
  const bank = snapshotTrack(snap, "t2").bank;
  if (!bank) throw new Error("snapshot t2 bank missing");
  const exposure = t2ExposureSeconds(snap);
  return bank.items
    .map((i) => {
      const type = TYPE_MAP[i.type] ?? "provenance";
      const signal = i.options.findIndex((o) => SIGNAL_OPTION_IDS.has(o.id));
      return {
        id: i.id,
        type,
        stem: i.stem,
        material: materialToString(i.material, assetUrl),
        options: i.options.map((o) => o.label),
        key: Math.max(0, i.options.findIndex((o) => o.id === i.key)),
        ...(signal >= 0 ? { signal } : {}),
        difficulty: DIFF_MAP[i.difficulty] ?? 0.5,
        rationale: i.rationale,
        ...(exposure[type] !== undefined ? { exposureSeconds: exposure[type] } : {}),
      };
    });
}

/**
 * The localized bank, for SAMPLING only — a deck must be drawn from one
 * locale. Unknown/unpopulated locales fall back to `en` rather than an empty
 * (unscorable) sitting.
 */
function transformed(snap: Snapshot, locale: Locale, assetUrl: AssetUrl): FullItem[] {
  const bank = snapshotTrack(snap, "t2").bank;
  if (!bank) throw new Error("snapshot t2 bank missing");
  const wanted = bank.items.some((i) => i.locale === locale) ? locale : "en";
  const keep = new Set(bank.items.filter((i) => i.locale === wanted).map((i) => i.id));
  return transformedAll(snap, assetUrl).filter((i) => keep.has(i.id));
}

/** Content-addressed sha256 of the embedded T2 bank. */
export function t2BankSha256(snap: Snapshot): string {
  const sha = snapshotTrack(snap, "t2").bank?.sha256;
  if (!sha) throw new Error("snapshot t2 bank sha256 missing");
  return sha;
}

/** Repo-local real-media items (served files) vs data-URI/text material. */
const isMediaMaterial = (material: string) => material.startsWith("/");

/**
 * PER-ATTEMPT DECK: presented item ids from the pure @ailx/track-t2 sampler.
 * Seed = sha256(attemptId + bank sha) so the deck is re-derivable from stored
 * inputs alone. Without an attemptId the fixed default deck is returned
 * (fixtures, /validate).
 */
export function t2DeckItemIds(
  snap: Snapshot,
  locale: Locale,
  assetUrl: AssetUrl,
  attemptId?: string,
): string[] {
  const candidates = transformed(snap, locale, assetUrl).map((i) => ({
    id: i.id,
    kind:
      i.type === "provenance"
        ? ("provenance" as const)
        : isMediaMaterial(i.material)
          ? ("media" as const)
          : ("text" as const),
    signal: i.signal === i.key,
    difficulty: i.difficulty,
  }));
  return sampleT2DeckIds(
    candidates,
    attemptId === undefined ? undefined : t2DeckSeed(attemptId, t2BankSha256(snap)),
  );
}

/** The sampled deck's items, in presented order, keys still attached. */
function deckItems(snap: Snapshot, assetUrl: AssetUrl, itemIds: readonly string[]): FullItem[] {
  const byId = new Map(transformedAll(snap, assetUrl).map((i) => [i.id, i]));
  // An id the localized bank does not carry is a stale deck, not a blank item:
  // drop it rather than present a hole the Runner would render empty.
  return itemIds.map((id) => byId.get(id)).filter((i): i is FullItem => i !== undefined);
}

/**
 * THE REDACTION. One expression, one home. `key` and `rationale` are not
 * blanked, they are never copied: the sitting branch builds a fresh object
 * from the presented fields only, so a field added to the bank tomorrow is
 * withheld by default instead of leaking by default.
 */
function redact(item: FullItem, phase: "sitting" | "review", yourChoice?: number): RedactedItem {
  const presented: PresentedItem = {
    id: item.id,
    type: item.type,
    stem: item.stem,
    material: item.material,
    options: item.options,
    ...(item.signal !== undefined ? { signal: item.signal } : {}),
    difficulty: item.difficulty,
    ...(item.exposureSeconds !== undefined ? { exposureSeconds: item.exposureSeconds } : {}),
  };
  if (phase === "sitting") return { ...presented, phase: "sitting" };
  return {
    ...presented,
    phase: "review",
    key: item.key,
    rationale: item.rationale,
    // The verdict is computed HERE, from the key, and handed down. A client
    // that compares yourChoice to key would get the same answer today and a
    // different one the day an item stops being a single-key item.
    ...(yourChoice !== undefined ? { yourChoice, correct: yourChoice === item.key } : {}),
  };
}

export function itemView(
  snap: Snapshot,
  assetUrl: AssetUrl,
  itemIds: readonly string[],
  phase: "sitting" | "review",
  answers?: ReadonlyMap<string, number>,
): RedactedItem[] {
  return deckItems(snap, assetUrl, itemIds).map((i) =>
    redact(i, phase, phase === "review" ? answers?.get(i.id) : undefined),
  );
}

/**
 * Grade one response against the key. `payload` is whatever the candidate
 * POSTed, so it is parsed defensively: an option INDEX (what the T2 Runner
 * records) or an option ID (what a hand-written client might send). Anything
 * else is a miss, never a throw — a malformed answer is a wrong answer, and
 * a 500 here would be an oracle.
 */
export function gradeResponse(
  snap: Snapshot,
  assetUrl: AssetUrl,
  itemId: string,
  payload: unknown,
): Verdict {
  const item = transformedAll(snap, assetUrl).find((i) => i.id === itemId);
  if (!item) throw new Error(`item ${itemId} is not in this bank`);
  const choice = readChoice(payload, item, snap);
  return { itemId, correct: choice === item.key, key: item.key };
}

function readChoice(payload: unknown, item: FullItem, snap: Snapshot): number {
  const p = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const raw = p.choice;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string") {
    // Option IDS ("ai" / "human") live in the raw bank; item ids are unique
    // across locales, so one lookup resolves the option list.
    const source = snapshotTrack(snap, "t2").bank?.items.find((i) => i.id === item.id);
    const byId = source ? source.options.findIndex((o) => o.id === raw) : -1;
    if (byId >= 0) return byId;
    const byLabel = item.options.indexOf(raw);
    if (byLabel >= 0) return byLabel;
  }
  return -1;   // lapsed / unparseable — a miss, and never the key by accident
}

/**
 * The T2 config `score()` consumes. Carries `key` and `rationale`, which is
 * exactly why it never crosses to a browser during a sitting.
 *
 * The short demo deck's full sensitivity points are pinned to the deck's
 * ATTAINABLE corrected d′: the log-linear correction caps a perfect run well
 * below the operational 3.0 ceiling on a small binary block, which would
 * truncate the 0-100 scale against an unchanged cohort.
 */
export function t2ScoringConfig(
  snap: Snapshot,
  assetUrl: AssetUrl,
  itemIds: readonly string[],
): { items: FullItem[]; dPrimeCeiling?: number } {
  const items = deckItems(snap, assetUrl, itemIds);
  const binary = items.filter((i) => i.type !== "provenance");
  const nSignal = binary.filter((i) => i.signal === i.key).length;
  const ceiling = Math.min(D_PRIME_CEILING, maxAttainableDPrime(nSignal, binary.length - nSignal));
  return { items, ...(ceiling > 0 ? { dPrimeCeiling: ceiling } : {}) };
}

/** Answer keys for the FULL localized bank — report rendering resolves any rotated deck. */
export function t2AnswerKeys(snap: Snapshot, locale: Locale): Record<string, number> {
  const bank = snapshotTrack(snap, "t2").bank;
  if (!bank) throw new Error("snapshot t2 bank missing");
  const keys: Record<string, number> = {};
  for (const i of bank.items) {
    if (i.locale !== locale) continue;
    keys[i.id] = Math.max(0, i.options.findIndex((o) => o.id === i.key));
  }
  return keys;
}
