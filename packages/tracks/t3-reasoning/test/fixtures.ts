import type { Judgment } from "@ailx/core";
import type { T3Config, T3Turn } from "../src/types.js";

export const config: T3Config = {
  title: "Grid interconnection queue reform",
  brief:
    "Advise the state energy commissioner: should the interconnection queue move to a first-ready-first-served cluster study process in 2027? Take a position a regulator could act on.",
  sourceTitle: "Docket 26-EL-041: Interconnection Queue Reform — Staff Technical Report",
  sourceExcerpt:
    "Section 3.2: The median queue wait reached 38 months in 2025. Cluster studies reduced median study time by 41% in the two pilot regions. Section 4.1: Withdrawal penalties of $2/kW deterred speculative applications; withdrawal rates fell from 62% to 29%. Section 5.3: Small (<20 MW) community projects saw study costs rise 18% under clustering, a regressive effect staff recommend offsetting with a fee cap.",
  plantedErrors: [
    {
      id: "pe-figure",
      topic: "queue wait median",
      claim: "The staff report puts the median queue wait at 61 months in 2025.",
      truth: "Section 3.2 states the median wait was 38 months in 2025.",
    },
    {
      id: "pe-causal",
      topic: "withdrawal penalties speculative",
      claim: "Withdrawal rates fell mainly because interest rates rose, not because of the $2/kW penalty — the report concludes the penalty had no measurable effect.",
      truth: "Section 4.1 attributes the fall from 62% to 29% to the penalty; the report draws no interest-rate conclusion.",
    },
    {
      id: "pe-citation",
      topic: "FERC order 2023 compliance",
      claim: "FERC Order 2023-B, issued March 2026, already mandates fee caps for community projects, so Section 5.3 is moot.",
      truth: "No such order exists in the record; the fee cap is a staff recommendation, not a mandate.",
    },
  ],
  correctAdvice: [
    {
      id: "ca-cluster",
      topic: "cluster study time",
      claim: "Cluster studies cut median study time by 41% in both pilot regions (Section 3.2) — strong evidence for the reform.",
    },
    {
      id: "ca-equity",
      topic: "community projects fee",
      claim: "Section 5.3 flags an 18% study-cost increase for sub-20 MW community projects; a fee cap offsets the regressive effect.",
    },
  ],
  minWords: 120,
  weights: { rsr: 25, analysis: 45, process: 20, rair: 10 },
};

let n = 0;
const ts = () => `2026-02-01T09:${String(10 + n).padStart(2, "0")}:00Z`;
export const turn = (t: Omit<T3Turn, "seq" | "clientTs">): T3Turn => ({
  ...t,
  seq: n++,
  clientTs: ts(),
});

/**
 * Strong candidate: decomposes into 3 prompts, surfaces all claims,
 * challenges every planted error, accepts both correct-advice claims,
 * revises the draft through a 2-link chain, verifies the source twice.
 */
export const goodTranscript: T3Turn[] = [
  turn({ verb: "prompted", object: "prompt:1", text: "Summarise the median queue wait and cluster study time findings." }),
  turn({ verb: "assisted", object: "assist:1", text: "…", claimIds: ["ca-cluster", "pe-figure"] }),
  turn({ verb: "verified", object: "source" }),
  turn({ verb: "challenged", object: "claim:pe-figure" }),
  turn({ verb: "accepted", object: "claim:ca-cluster" }),
  turn({ verb: "prompted", object: "prompt:2", text: "What about withdrawal penalties and speculative applications?" }),
  turn({ verb: "assisted", object: "assist:2", text: "…", claimIds: ["pe-causal"] }),
  turn({ verb: "verified", object: "source" }),
  turn({ verb: "challenged", object: "claim:pe-causal" }),
  turn({ verb: "revised", object: "draft:rev-1", text: "First draft…" }),
  turn({ verb: "prompted", object: "prompt:3", text: "Any FERC compliance angle on community projects fee caps?" }),
  turn({ verb: "assisted", object: "assist:3", text: "…", claimIds: ["ca-equity", "pe-citation"] }),
  turn({ verb: "challenged", object: "claim:pe-citation" }),
  turn({ verb: "accepted", object: "claim:ca-equity" }),
  turn({ verb: "revised", object: "draft:rev-2", text: "Second draft…", revisionOf: "draft:rev-1" }),
  turn({ verb: "revised", object: "draft:rev-3", text: "Final draft…", revisionOf: "draft:rev-2" }),
  turn({ verb: "submitted", object: "t3-reasoning:final" }),
];

/**
 * Credulous candidate: one prompt, accepts everything the assistant says
 * (including planted errors), never verifies, never revises.
 */
export const credulousTranscript: T3Turn[] = [
  turn({ verb: "prompted", object: "prompt:1", text: "Write my analysis about the queue wait and withdrawal penalties and fee caps." }),
  turn({ verb: "assisted", object: "assist:1", text: "…", claimIds: ["pe-figure", "pe-causal", "ca-cluster"] }),
  turn({ verb: "accepted", object: "claim:pe-figure" }),
  turn({ verb: "accepted", object: "claim:pe-causal" }),
  turn({ verb: "accepted", object: "claim:ca-cluster" }),
  turn({ verb: "submitted", object: "t3-reasoning:final" }),
];

/** Over-rejector: challenges everything, including the correct advice. */
export const overRejectTranscript: T3Turn[] = goodTranscript.map((t) =>
  t.verb === "accepted" ? { ...t, verb: "challenged" as const } : t,
);

const para =
  "The commissioner should adopt first-ready-first-served cluster studies in 2027, paired with the staff fee cap for sub-20 MW community projects. The pilot evidence is direct: cluster studies cut median study time by 41 percent, and the 2 dollar per kilowatt withdrawal penalty drove withdrawal rates from 62 to 29 percent, clearing speculative volume that inflated the 38 month median wait. ";
export const goodAnswer = (para + para + para).trim(); // ~180 words > minWords

export const shortAnswer = "Adopt cluster studies."; // far under minWords

/** Stored heterogeneous-jury judgments (three demo models, dimension 'analysis'). */
export const juryJudgments: Judgment[] = [
  { dimension: "analysis", sample: 0, value: 4, evidence: "anchored to §3.2/§4.1", modelId: "demo-judge-1@1" },
  { dimension: "analysis", sample: 1, value: 4, evidence: "position actionable", modelId: "demo-judge-2@1" },
  { dimension: "analysis", sample: 2, value: 3, evidence: "risk treatment thin", modelId: "demo-judge-3@1" },
];
