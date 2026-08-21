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
import snapshotRaw from "../../../instruments/2026.1/snapshot.json";

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

interface Snapshot {
  format: string;
  instrument: { manifest: Record<string, unknown>; tracks: SnapshotTrack[] };
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
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "/ailx";
    return `${base}/${String(m.src).replace(/^\/+/, "")}`;
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

/** Snapshot bank items (content-addressed upstream) → T2Config item shape. */
export function t2Items(locale: string = "en") {
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
  // Demo deck: keep the sitting short & fun — 12 items across difficulties.
  // Real-media photo items (repo-local files) lead the deck; balance the
  // photo block between AI and authentic keys so d' stays measurable.
  const isMedia = (i: { material: string }) => i.material.startsWith("/");
  const binary = items.filter((i) => i.type !== "provenance");
  const prov = items.filter((i) => i.type === "provenance");
  const mediaAi = binary.filter((i) => isMedia(i) && i.signal === i.key);
  const mediaReal = binary.filter((i) => isMedia(i) && i.signal !== i.key);
  const media = [...Array(Math.min(3, mediaAi.length, mediaReal.length)).keys()]
    .flatMap((k) => [mediaAi[k], mediaReal[k]]);
  const rest = binary.filter((i) => !media.includes(i));
  return [...media, ...rest.slice(0, Math.max(0, 9 - media.length)), ...prov.slice(0, 3)];
}

/**
 * T3 demo scenario (mirrors the t3 package's validated fixture). Kept
 * code-side by design — NO content-package changes — with its canonical
 * hash pinned as T3_SCENARIO_SHA256 and asserted by tests.
 */
export const T3_SCENARIO = {
  title: "Grid interconnection queue reform",
  brief:
    "Advise the state energy commissioner: should the interconnection queue move to a first-ready-first-served cluster study process in 2027? Take a position a regulator could act on.",
  sourceTitle: "Docket 26-EL-041: Interconnection Queue Reform — Staff Technical Report",
  sourceExcerpt:
    "Section 3.2: The median queue wait reached 38 months in 2025. Cluster studies reduced median study time by 41% in the two pilot regions. Section 4.1: Withdrawal penalties of $2/kW deterred speculative applications; withdrawal rates fell from 62% to 29%. Section 5.3: Small (<20 MW) community projects saw study costs rise 18% under clustering, a regressive effect staff recommend offsetting with a fee cap.",
  plantedErrors: [
    { id: "pe-figure", topic: "queue wait median", claim: "The staff report puts the median queue wait at 61 months in 2025.", truth: "Section 3.2 states the median wait was 38 months in 2025." },
    { id: "pe-causal", topic: "withdrawal penalties speculative", claim: "Withdrawal rates fell mainly because interest rates rose, not because of the $2/kW penalty — the report concludes the penalty had no measurable effect.", truth: "Section 4.1 attributes the fall from 62% to 29% to the penalty; the report draws no interest-rate conclusion." },
    { id: "pe-citation", topic: "FERC order 2023 compliance", claim: "FERC Order 2023-B, issued March 2026, already mandates fee caps for community projects, so Section 5.3 is moot.", truth: "No such order exists in the record; the fee cap is a staff recommendation, not a mandate." },
  ],
  correctAdvice: [
    { id: "ca-cluster", topic: "cluster study time", claim: "Cluster studies cut median study time by 41% in both pilot regions (Section 3.2) — strong evidence for the reform." },
    { id: "ca-equity", topic: "community projects fee", claim: "Section 5.3 flags an 18% study-cost increase for sub-20 MW community projects; a fee cap offsets the regressive effect." },
  ],
  minWords: 120,
};

/** Pinned sha256(canonicalJson(T3_SCENARIO)) — asserted at test time. */
export const T3_SCENARIO_SHA256 =
  "38d7bdb42bae91e6377cfd586242e8db1e43ba194de0534ce3cfa90f46dff3dd";

/**
 * Per-track config passed to the real Runner + score(). The SESSION's
 * locale (SessionConfig.locale, chosen via the header switcher) selects
 * the localized T2 deck; T1/T3/T4 demo briefs stay English (scope
 * control — only item content localizes in this build).
 */
export function trackConfig(
  trackId: "t1" | "t2" | "t3" | "t4",
  locale: string = "en",
): unknown {
  switch (trackId) {
    case "t1": return undefined;             // plugin defaults carry the demo brief
    case "t2": return { items: t2Items(locale) };
    case "t3": return T3_SCENARIO;
    case "t4": return undefined;             // plugin defaults carry the demo brief
  }
}
