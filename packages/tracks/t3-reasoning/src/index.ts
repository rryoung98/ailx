export {
  plugin, t3TimeBudgetSeconds, validateT3Config, validateT3PresentationConfig,
  type T3Score,
} from "./plugin.js";
export { Runner } from "./Runner.js";
export {
  scoreT3, revisionChainLength, rairCreditForClaim, verifiedClaimIds,
  relianceIndex, relianceBand, verificationTally,
  RUBRIC_BAND_MAX, RSR_MIN_SURFACED, RELIANCE_CALIBRATED_BAND,
  DISCRIMINATING_MIN_CHECKS,
  type T3Raw, type Reliance, type RelianceBand, type VerificationTally,
} from "./scoring.js";
export { encodeT3Checkpoint, decodeT3Checkpoint, type T3CheckpointState, type T3ChatMsg } from "./checkpoint.js";
export { assistantReply, DEMO_ASSISTANT_ID, type AssistantReply } from "./assistant.js";
export {
  revealSummary, revealSummaryFromPlants,
  type RevealRow, type RevealStance, type RevealSummary,
} from "./reveal.js";
export { DemoJudge } from "./judge.js";
export { sha256Hex, seededIndex } from "./sha256.js";
export { T3_DEFAULT_WEIGHTS, T3_TOTAL_POINTS } from "./types.js";
export type * from "./types.js";
