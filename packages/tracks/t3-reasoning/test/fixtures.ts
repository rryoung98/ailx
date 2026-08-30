import type { Judgment } from "@ailx/core";
import type { T3Config, T3Turn } from "../src/types.js";

export const config: T3Config = {
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
 * revises the draft through a 2-link chain, and checks three DISTINCT
 * claims against the source (verification is attributed per claim).
 */
export const goodTranscript: T3Turn[] = [
  turn({ verb: "prompted", object: "prompt:1", text: "Summarise the median certification wait and shared assessment processing time findings." }),
  turn({ verb: "assisted", object: "assist:1", text: "…", claimIds: ["ca-cluster", "pe-figure"] }),
  turn({ verb: "verified", object: "claim:pe-figure", claimIds: ["pe-figure"] }),
  turn({ verb: "verified", object: "claim:ca-cluster", claimIds: ["ca-cluster"] }),
  turn({ verb: "challenged", object: "claim:pe-figure" }),
  turn({ verb: "accepted", object: "claim:ca-cluster" }),
  turn({ verb: "prompted", object: "prompt:2", text: "What about the completion bond and speculative enrollment withdrawal?" }),
  turn({ verb: "assisted", object: "assist:2", text: "…", claimIds: ["pe-causal"] }),
  turn({ verb: "verified", object: "claim:pe-causal", claimIds: ["pe-causal"] }),
  turn({ verb: "challenged", object: "claim:pe-causal" }),
  turn({ verb: "revised", object: "draft:rev-1", text: "First draft…" }),
  turn({ verb: "prompted", object: "prompt:3", text: "Any OECD annex compliance mandate on small employers fee caps?" }),
  turn({ verb: "assisted", object: "assist:3", text: "…", claimIds: ["ca-equity", "pe-citation"] }),
  turn({ verb: "verified", object: "claim:ca-equity", claimIds: ["ca-equity"] }),
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
  turn({ verb: "prompted", object: "prompt:1", text: "Write my analysis about the certification wait and the completion bond and fee caps." }),
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
  "The delegation should adopt the shared AI-skills certification track in 2027, paired with the staff fee cap for firms under 20 employees. The pilot evidence is direct: pooled assessor panels cut median processing time by 41 percent, and the 2 dollar per training hour completion bond drove withdrawal rates from 62 to 29 percent, clearing speculative enrollment that inflated the 38 month median wait. ";
export const goodAnswer = (para + para + para).trim(); // ~180 words > minWords

export const shortAnswer = "Adopt shared track."; // far under minWords

/**
 * Stored heterogeneous-jury judgments (three demo models, dimension
 * 'analysis'). Values are NORMALIZED [0,1] per the JudgeResponse contract
 * (bands 4/5, 4/5, 3/5).
 */
export const juryJudgments: Judgment[] = [
  { dimension: "analysis", sample: 0, value: 0.8, evidence: "anchored to §3.2/§4.1", modelId: "demo-judge-1@1" },
  { dimension: "analysis", sample: 1, value: 0.8, evidence: "position actionable", modelId: "demo-judge-2@1" },
  { dimension: "analysis", sample: 2, value: 0.6, evidence: "risk treatment thin", modelId: "demo-judge-3@1" },
];
