/**
 * Instrument wiring: derives track configs from the COMMITTED instrument
 * snapshot (instruments/2026.1/snapshot.json) — the authoritative content
 * package — into the config shapes each track plugin validates (F16).
 *
 * T2 items come from the snapshot's embedded bank; per-item exposure
 * seconds come from the snapshot's instrument config blocks (F3). The T3
 * demo scenario remains code-side (no content-package changes); its hash is
 * pinned and asserted at test time.
 */
import { D_PRIME_CEILING, maxAttainableDPrime, sampleT2DeckIds, t2DeckSeed } from "@ailx/track-t2";
import snapshotRaw from "../../../instruments/2026.1/snapshot.json";
import { assetUrl } from "./mode";

interface BankItem {
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

interface SnapshotTrack {
  trackId: string;
  plugin: string;
  config: Record<string, unknown>;
  rubricVersion: string;
  bank?: { items: BankItem[]; sha256?: string };
}

/**
 * Build-time content address of a track's score() source closure, emitted by
 * `@ailx/content-tools build-snapshot --scorers` (see packages/content-tools/
 * src/scorers.ts). This is the audit digest: it identifies the scoring SOURCE,
 * so it survives a bundler bump that changes nothing about how a score is
 * computed.
 */
interface SnapshotScorer {
  trackId: "t1" | "t2" | "t3" | "t4";
  packageName: string;
  packageVersion: string;
  sources: Array<{ path: string; sha256: string }>;
  externals: string[];
  digest: string;
}

interface Snapshot {
  format: string;
  instrument: { manifest: Record<string, unknown>; tracks: SnapshotTrack[] };
  scorers?: SnapshotScorer[];
}

export const SNAPSHOT = snapshotRaw as unknown as Snapshot;

const SNAPSHOT_TRACK_IDS: Record<"t1" | "t2" | "t3" | "t4", string> = {
  t1: "t1-creative-build",
  t2: "t2-discrimination",
  t3: "t3-reasoning",
  t4: "t4-generative",
};

export function snapshotTrack(trackId: "t1" | "t2" | "t3" | "t4"): SnapshotTrack {
  const t = SNAPSHOT.instrument.tracks.find(
    (x) => x.trackId === SNAPSHOT_TRACK_IDS[trackId],
  );
  if (!t) throw new Error(`snapshot missing track ${trackId}`);
  return t;
}

/** Per-track rubricVersion from the committed snapshot (F12). */
export function snapshotRubricVersion(trackId: "t1" | "t2" | "t3" | "t4"): string {
  return snapshotTrack(trackId).rubricVersion;
}

/**
 * Per-track scoring digest from the committed snapshot (F12). Fails CLOSED:
 * an attempt must never persist a score with a digest the platform cannot
 * derive from source. Regenerate with
 * `pnpm --filter @ailx/content-tools run snapshot:2026.1`.
 */
export function snapshotScoringDigest(trackId: "t1" | "t2" | "t3" | "t4"): string {
  const s = SNAPSHOT.scorers?.find((x) => x.trackId === trackId);
  if (!s) {
    throw new Error(
      `snapshot carries no scoring digest for ${trackId} — rebuild it with ` +
      `'pnpm --filter @ailx/content-tools run snapshot:2026.1'`,
    );
  }
  return s.digest;
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
 * Per-item-type exposure seconds, read from the snapshot's instrument
 * config blocks (media-image 6, media-video 12, media-audio 10,
 * message-email 25, message-page 25; provenance untimed → undefined).
 */
export function t2ExposureSeconds(): Record<string, number | undefined> {
  const blocks = (snapshotTrack("t2").config.blocks ?? []) as SnapshotBlock[];
  const map: Record<string, number | undefined> = {};
  for (const b of blocks) {
    map[b.id] =
      b.untimed === true || b.exposure_seconds == null
        ? undefined
        : b.exposure_seconds;
  }
  return map;
}

function materialToString(m: BankItem["material"]): string {
  // The committed bank uses snake_case data_uri; accept camelCase and raw
  // svg too so image items always render as images (F3).
  if (m.kind === "image" && typeof m.src === "string") {
    // Real media files under apps/web/public, served beneath the basePath.
    return assetUrl(`/${String(m.src).replace(/^\/+/, "")}`);
  }
  if (typeof m.data_uri === "string") return m.data_uri;
  if (typeof m.dataUri === "string") return m.dataUri;
  if (typeof m.svg === "string") {
    return `data:image/svg+xml;base64,${typeof btoa === "function" ? btoa(unescape(encodeURIComponent(m.svg))) : Buffer.from(m.svg, "utf8").toString("base64")}`;
  }
  if (typeof m.text === "string") return m.text;
  if (m.kind === "email") {
    const parts: string[] = [];
    if (typeof m.from_display === "string" || typeof m.from_address === "string") {
      parts.push(`From: ${[m.from_display, m.from_address && `<${String(m.from_address)}>`].filter(Boolean).join(" ")}`);
    }
    if (typeof m.subject === "string") parts.push(`Subject: ${m.subject}`);
    if (typeof m.body === "string") parts.push("", String(m.body));
    if (parts.length > 0) return parts.join("\n");
  }
  if (typeof m.body === "string") return m.body;      // chat
  if (typeof m.details === "string") return m.details; // scenario
  return JSON.stringify(m);
}

/** Full localized bank in T2Config item shape (pre-sampling). */
function t2TransformedItems(locale: string) {
  const bank = snapshotTrack("t2").bank;
  if (!bank) throw new Error("snapshot t2 bank missing");
  const exposure = t2ExposureSeconds();
  // Unknown/unpopulated locales fall back to the en deck rather than an
  // empty (unscorable) sitting.
  const wanted = bank.items.some((i) => i.locale === locale) ? locale : "en";
  const items = bank.items
    .filter((i) => i.locale === wanted)
    .map((i) => {
      const type = TYPE_MAP[i.type] ?? "provenance";
      const signal = i.options.findIndex((o) => SIGNAL_OPTION_IDS.has(o.id));
      return {
        id: i.id,
        type,
        stem: i.stem,
        material: materialToString(i.material),
        options: i.options.map((o) => o.label),
        key: Math.max(0, i.options.findIndex((o) => o.id === i.key)),
        ...(signal >= 0 ? { signal } : {}),
        difficulty: DIFF_MAP[i.difficulty] ?? 0.5,
        rationale: i.rationale,
        ...(exposure[type] !== undefined ? { exposureSeconds: exposure[type] } : {}),
      };
    });
  return items;
}

/** Snapshot bank items (content-addressed upstream) → T2Config item shape. */
export function t2Items(locale: string = "en", attemptId?: string) {
  const items = t2TransformedItems(locale);
  const byId = new Map(items.map((i) => [i.id, i]));
  return t2DeckItemIds(locale, attemptId).map((id) => byId.get(id)!);
}

/** Repo-local real-media items (served files) vs data-URI/text material. */
const isMediaMaterial = (material: string) => material.startsWith("/");

/** Content-addressed sha256 of the embedded T2 bank. */
export function t2BankSha256(): string {
  const sha = snapshotTrack("t2").bank?.sha256;
  if (!sha) throw new Error("snapshot t2 bank sha256 missing");
  return sha;
}

/**
 * PER-ATTEMPT DECK: presented item ids, sampled by the pure @ailx/track-t2
 * sampler. Seed = sha256(attemptId + bank sha) so the deck is re-derivable
 * from stored inputs alone (server records the same ids at attempt
 * creation; scoring recomputes them). Without an attemptId the fixed
 * default deck is returned (sample fixtures, /validate).
 *
 * NOTE: the OPERATIONAL instrument uses fixed, equated forms (spec §T2) —
 * per-attempt variation is the hosted-demo exposure model. Static mode
 * seeds from the LOCAL attempt id; server mode seeds from the SERVER
 * attempt id (the session adopts it at start), same derivation.
 */
export function t2DeckItemIds(locale: string = "en", attemptId?: string): string[] {
  const candidates = t2TransformedItems(locale).map((i) => ({
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
    attemptId === undefined ? undefined : t2DeckSeed(attemptId, t2BankSha256()),
  );
}

/**
 * Deck records for server-side exposure logging: what @ailx/backend persists
 * (attempt_decks) at attempt creation. MUST stay byte-identical to what the
 * client presents — both sides call t2DeckItemIds with the same attempt id.
 */
export function t2DeckRecords(
  attemptId: string,
  locale: string = "en",
): Array<{ trackId: "t2"; bankSha256: string; itemIds: string[] }> {
  return [{ trackId: "t2", bankSha256: t2BankSha256(), itemIds: t2DeckItemIds(locale, attemptId) }];
}

/**
 * Answer keys for the FULL bank (not just one deck) — report/rationale
 * rendering must resolve any rotated deck's item ids.
 */
export function t2AnswerKeys(locale: string = "en"): Record<string, number> {
  const bank = snapshotTrack("t2").bank;
  if (!bank) throw new Error("snapshot t2 bank missing");
  const keys: Record<string, number> = {};
  for (const i of bank.items) {
    if (i.locale !== locale) continue;
    keys[i.id] = Math.max(0, i.options.findIndex((o) => o.id === i.key));
  }
  return keys;
}

/**
 * T3 demo scenario (mirrors the t3 package's validated fixture). Kept
 * code-side by design — NO content-package changes — with its canonical
 * hash pinned as T3_SCENARIO_SHA256 and asserted by tests.
 */
export const T3_SCENARIO = {
  title: "Trilateral AI workforce readiness memorandum",
  brief:
    "Advise the U.S. delegation lead: should the three governments adopt the shared AI-skills certification track in 2027? Take a position a negotiator could act on.",
  sourceTitle: "US\u2013Japan\u2013Korea Trilateral AI Workforce Readiness Memorandum (2026) \u2014 Staff Review Draft",
  sourceExcerpt:
    "Prepared by the trilateral working group on AI workforce readiness (Washington \u00b7 Tokyo \u00b7 Seoul). Status: staff review draft \u2014 not yet adopted by any of the three governments.\n\nSection 2.1 \u2014 Scope. The memorandum covers public-sector AI reskilling programs in the United States, Japan, and the Republic of Korea, and a proposed shared AI-skills certification track to open in 2027.\n\nSection 3.2 \u2014 Certification backlog. The median wait for advanced AI-role certification reached 38 months in 2025 across the three countries. In the two pilot ministries that pooled their assessor panels, shared assessment cut median processing time by 41%.\n\nSection 4.1 \u2014 Withdrawal from training. A completion bond of $2 per enrolled training hour, refunded on completion, deterred speculative enrollment; program withdrawal rates fell from 62% to 29%.\n\nSection 5.3 \u2014 Small employers. Firms under 20 employees saw compliance and assessment costs rise 18% under the pooled model, a regressive effect the working group recommends offsetting with a fee cap. The fee cap is a staff recommendation; no adopted instrument mandates it.",
  plantedErrors: [
    {
      id: "pe-figure",
      topic: "certification backlog median wait",
      claim: "The memorandum puts the median certification wait at 61 months in 2025.",
      truth: "Section 3.2 states the median wait was 38 months in 2025.",
    },
    {
      id: "pe-causal",
      topic: "withdrawal completion bond speculative",
      claim:
        "Withdrawal rates fell mainly because labor markets tightened, not because of the $2 completion bond \u2014 the memorandum concludes the bond had no measurable effect.",
      truth:
        "Section 4.1 attributes the fall from 62% to 29% to the completion bond; the memorandum draws no labor-market conclusion.",
    },
    {
      id: "pe-citation",
      topic: "OECD annex 2023 compliance mandate",
      claim:
        "OECD Council Annex 2023-B, adopted March 2026, already mandates fee caps for small employers, so Section 5.3 is moot.",
      truth: "No such annex exists in the record; the fee cap is a staff recommendation, not a mandate.",
    },
  ],
  correctAdvice: [
    {
      id: "ca-cluster",
      topic: "shared assessment processing time",
      claim:
        "Pooled assessor panels cut median processing time by 41% in both pilot ministries (Section 3.2) \u2014 strong evidence for the shared track.",
    },
    {
      id: "ca-equity",
      topic: "small employers fee",
      claim:
        "Section 5.3 flags an 18% cost increase for firms under 20 employees; a fee cap offsets the regressive effect.",
    },
  ],
  minWords: 120,
};

/** Pinned sha256(canonicalJson(T3_SCENARIO)) — asserted at test time. */
export const T3_SCENARIO_SHA256 =
  "c2419a3cbf6f813f0999afece626f2c3570292d0cfb06239870993b01590c40e";

/**

 * Per-track config passed to the real Runner + score(). The SESSION's
 * locale (SessionConfig.locale, chosen via the header switcher) selects
 * the localized T2 deck; `attemptId` drives the DEMO-ONLY T2 deck rotation.
 * Presentation and scoring must pass the SAME locale + attemptId so the
 * scored deck is the presented deck. Omitted attemptId → fixed default
 * deck (fixtures, /validate). T1/T3/T4 demo briefs stay English.
 */
export function trackConfig(
  trackId: "t1" | "t2" | "t3" | "t4",
  locale: string = "en",
  attemptId?: string,
): unknown {
  switch (trackId) {
    case "t1": return undefined;             // plugin defaults carry the demo brief
    case "t2": {
      const items = t2Items(locale, attemptId);
      // Short demo deck: full sensitivity points at the deck's ATTAINABLE
      // corrected d′ — the log-linear correction caps a perfect run well
      // below the operational 3.0 ceiling on a 4-item binary block, which
      // would truncate the 0-100 scale against the unchanged demo cohort.
      const binary = items.filter((i) => i.type !== "provenance");
      const nSignal = binary.filter((i) => i.signal === i.key).length;
      const nNoise = binary.length - nSignal;
      const ceiling = Math.min(D_PRIME_CEILING, maxAttainableDPrime(nSignal, nNoise));
      return { items, ...(ceiling > 0 ? { dPrimeCeiling: ceiling } : {}) };
    }
    case "t3": return T3_SCENARIO;
    case "t4": return undefined;             // plugin defaults carry the demo brief
  }
}
