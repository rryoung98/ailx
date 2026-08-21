/**
 * Instrument wiring: adapts the content package (snapshot + bank fixture)
 * into the config shapes each track plugin validates.
 */
import bankRaw from "./fixtures/t2-bank.json";

interface BankItem {
  id: string;
  type: string;
  locale: string;
  difficulty: string;
  stem: string;
  material: { kind: string; text?: string; svg?: string; dataUri?: string; [k: string]: unknown };
  options: Array<{ id: string; label: string }>;
  key: string;
  rationale: string;
  provenance?: unknown;
}

const TYPE_MAP: Record<string, string> = {
  "text-authenticity": "message-page",
  "image-provenance": "media-image",
  "message-hostility": "message-email",
  "provenance-reasoning": "provenance",
};

const DIFF_MAP: Record<string, number> = { easy: 0.25, medium: 0.5, hard: 0.85 };

function materialToString(m: BankItem["material"]): string {
  if (typeof m.dataUri === "string") return m.dataUri;
  if (typeof m.svg === "string") {
    return `data:image/svg+xml;base64,${typeof btoa === "function" ? btoa(unescape(encodeURIComponent(m.svg))) : Buffer.from(m.svg, "utf8").toString("base64")}`;
  }
  if (typeof m.text === "string") return m.text;
  return JSON.stringify(m);
}

/** Bank items (content-addressed upstream) → T2Config item shape. */
export function t2Items(locale: string = "en") {
  const items = (bankRaw as BankItem[])
    .filter((i) => i.locale === locale)
    .map((i) => ({
      id: i.id,
      type: TYPE_MAP[i.type] ?? "provenance",
      stem: i.stem,
      material: materialToString(i.material),
      options: i.options.map((o) => o.label),
      key: Math.max(0, i.options.findIndex((o) => o.id === i.key)),
      difficulty: DIFF_MAP[i.difficulty] ?? 0.5,
      rationale: i.rationale,
    }));
  // Demo deck: keep the sitting short & fun — 12 items across difficulties.
  const binary = items.filter((i) => i.type !== "provenance");
  const prov = items.filter((i) => i.type === "provenance");
  return [...binary.slice(0, 9), ...prov.slice(0, 3)];
}

/** T3 demo scenario (mirrors the t3 package's validated fixture). */
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

/** Per-track config passed to the real Runner + score(). */
export function trackConfig(trackId: "t1" | "t2" | "t3" | "t4"): unknown {
  switch (trackId) {
    case "t1": return undefined;             // plugin defaults carry the demo brief
    case "t2": return { items: t2Items("en") };
    case "t3": return T3_SCENARIO;
    case "t4": return undefined;             // plugin defaults carry the demo brief
  }
}
