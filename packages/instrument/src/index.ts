/**
 * @ailx/instrument — SERVER-ONLY. Item custody, deck sampling, redaction and
 * grading for the AILX instrument.
 *
 * WHY THIS PACKAGE EXISTS: `apps/web/lib/instrument.ts` used to import
 * `instruments/2026.1/snapshot.json` from a CLIENT module, so the deployed
 * static export carried all 104 T2 items with `key`, `rationale` and
 * `provenance` — 40 occurrences of `"key":"ai"` in one chunk. An exam whose
 * answer key ships to the candidate is not an exam.
 *
 * WHY IT CANNOT BE IMPORTED BY CLIENT CODE: it reads the snapshot with
 * `node:fs` at open time rather than `import`ing the JSON, so a bundler
 * cannot inline the bank even by accident, and the repo's existing
 * server-only rule (`apps/web/test/serverOnlyPages.test.ts`, which already
 * treats `from "node:` as server capability) is extended to name this package
 * directly. `apps/web/test/bundleSecrecy.test.ts` then greps the BUILT
 * bundles of both build modes for operational key material — a policy that is
 * only enforced by review is a policy that regresses.
 *
 * The PUBLIC released-practice tier (`instruments/demo-2026.1`) is the one
 * bank a browser may hold in full: those keys are published on purpose.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrackId } from "@ailx/session";
import {
  gradeResponse,
  itemView,
  snapshotTrack,
  t2AnswerKeys,
  t2BankSha256,
  t2DeckItemIds,
  t2ExposureSeconds,
  t2ScoringConfig,
  type AssetUrl,
  type ShortTrackId,
  type Snapshot,
} from "./bank.js";
import type { DeckRecord, Instrument, Locale, Phase, RedactedItem, Verdict } from "./types.js";

export type {
  DeckRecord,
  Instrument,
  Locale,
  Phase,
  PresentedItem,
  RedactedItem,
  Verdict,
} from "./types.js";
export type { Snapshot } from "./bank.js";

/** Repo root, from this file's location in `dist/` or `src/`. */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

/** The OPERATIONAL instrument: secure bank, never bundled. */
export const OPERATIONAL_SNAPSHOT = join(REPO_ROOT, "instruments/2026.1/snapshot.json");
/** The PUBLIC released-practice tier: keys and rationales published on purpose. */
export const DEMO_SNAPSHOT = join(REPO_ROOT, "instruments/demo-2026.1/snapshot.json");

export interface OpenOptions {
  /**
   * Absolute path to an instrument snapshot. Defaults to the operational one;
   * `AILX_INSTRUMENT_SNAPSHOT` overrides it, which is how a private,
   * digest-pinned package is mounted without a code change (Phase 2 of
   * docs/ARCHITECTURE.md §10).
   */
  snapshotPath?: string;
  /**
   * Expected sha256 of the snapshot bytes. When given, a mismatch REFUSES to
   * open: an instrument that is not the instrument we pinned must not quietly
   * become the instrument we serve.
   */
  expectDigest?: string;
  /** Resolves a served asset path under the host's basePath. Identity by default. */
  assetUrl?: AssetUrl;
  /** Marks the bank as deliberately released (the demo tier). */
  released?: boolean;
}

/** Process-wide cache: one parse per snapshot path, not one per request. */
const cache = new Map<string, Instrument>();

/**
 * Open an instrument from a snapshot on disk.
 *
 * Async by signature because the digest-pinned artefact of spec §14 will be
 * FETCHED, not read: keeping the await now means the call sites do not move
 * when custody becomes an OCI pull.
 */
export async function openInstrument(
  env: Record<string, string | undefined> = process.env,
  options: OpenOptions = {},
): Promise<Instrument> {
  const path = options.snapshotPath ?? env.AILX_INSTRUMENT_SNAPSHOT ?? OPERATIONAL_SNAPSHOT;
  const key = `${path}|${options.assetUrl ? "asset" : "raw"}|${options.released === true}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expect = options.expectDigest ?? env.AILX_INSTRUMENT_DIGEST;
  if (expect !== undefined && expect !== digest) {
    throw new Error(
      `instrument digest mismatch: ${path} hashes ${digest}, pinned ${expect}`,
    );
  }
  const made = fromSnapshot(JSON.parse(bytes.toString("utf8")) as Snapshot, {
    ...options,
    released: options.released === true,
  });
  cache.set(key, made);
  return made;
}

/**
 * The PUBLIC released-practice tier — dev, tests, the static build, and a
 * clean-clone hosted build with no instrument credential. Its keys are
 * published on purpose; `released` is true so a caller can SAY so instead of
 * quietly issuing a score of record against practice content.
 */
export function openDemoInstrument(options: OpenOptions = {}): Instrument {
  const path = options.snapshotPath ?? DEMO_SNAPSHOT;
  const key = `${path}|${options.assetUrl ? "asset" : "raw"}|demo`;
  const hit = cache.get(key);
  if (hit) return hit;
  const snap = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
  const made = fromSnapshot(snap, { ...options, released: true });
  cache.set(key, made);
  return made;
}

/** Test seam: build an Instrument over an in-memory snapshot. */
export function fromSnapshot(snap: Snapshot, options: OpenOptions = {}): Instrument {
  const assetUrl: AssetUrl = options.assetUrl ?? ((p) => p);
  const manifest = snap.instrument.manifest as Record<string, unknown>;
  const short = (t: TrackId): ShortTrackId => t as ShortTrackId;

  return {
    instrumentId: typeof manifest.id === "string" ? manifest.id : "ailx",
    instrumentVer: typeof manifest.version === "string" ? manifest.version : "2026.1",
    // The bank sha256 IS the content address the deck derivation is seeded
    // with, so pinning anything else here would pin the wrong thing.
    packageDigest: t2BankSha256(snap),
    released: options.released === true,

    sampleDecks(attemptId: string, locale: Locale): readonly DeckRecord[] {
      return [
        {
          trackId: "t2",
          bankSha256: t2BankSha256(snap),
          itemIds: t2DeckItemIds(snap, locale, assetUrl, attemptId),
        },
      ];
    },

    // `locale` is accepted and ignored on purpose: the deck already fixes the
    // locale (item ids are locale-specific), so honouring a caller's locale
    // here could only ever serve the WRONG items for a recorded deck.
    itemView(
      deck: DeckRecord,
      phase: Phase,
      _locale: Locale,
      answers?: ReadonlyMap<string, number>,
    ): readonly RedactedItem[] {
      return itemView(snap, assetUrl, deck.itemIds, phase, answers);
    },

    gradeResponse(itemId: string, payload: unknown, _locale?: Locale): Verdict {
      return gradeResponse(snap, assetUrl, itemId, payload);
    },

    scoringConfig(trackId: TrackId, deck: DeckRecord | undefined, locale: Locale): unknown {
      if (trackId !== "t2") return undefined;   // plugin defaults carry T1/T4; T3 is code-side
      const ids = deck?.itemIds ?? t2DeckItemIds(snap, locale, assetUrl);
      return t2ScoringConfig(snap, assetUrl, ids);
    },

    rubricVersion(trackId: TrackId): string {
      return snapshotTrack(snap, short(trackId)).rubricVersion;
    },

    /**
     * Fails CLOSED: an attempt must never persist a score with a digest the
     * platform cannot derive from source. Regenerate with
     * `pnpm --filter @ailx/content-tools run snapshot:2026.1`.
     */
    scoringDigest(trackId: TrackId): string {
      const s = snap.scorers?.find((x) => x.trackId === short(trackId));
      if (!s) {
        throw new Error(
          `snapshot carries no scoring digest for ${trackId} — rebuild it with ` +
            `'pnpm --filter @ailx/content-tools run snapshot:2026.1'`,
        );
      }
      return s.digest;
    },
  };
}

export { t2AnswerKeys, t2ExposureSeconds, t2DeckItemIds, t2BankSha256, snapshotTrack };

/** Testing only: drop the process-wide snapshot cache. */
export function resetInstrumentCache(): void {
  cache.clear();
}
