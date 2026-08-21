export { plugin, validateT3Config, type T3Score } from "./plugin.js";
export { Runner } from "./Runner.js";
export { scoreT3, revisionChainLength, rairCreditForClaim, RUBRIC_BAND_MAX, type T3Raw } from "./scoring.js";
export { encodeT3Checkpoint, decodeT3Checkpoint, type T3CheckpointState, type T3ChatMsg } from "./checkpoint.js";
export { assistantReply, DEMO_ASSISTANT_ID, type AssistantReply } from "./assistant.js";
export { revealSummary, type RevealRow, type RevealStance, type RevealSummary } from "./reveal.js";
export { DemoJudge } from "./judge.js";
export { sha256Hex, seededIndex } from "./sha256.js";
export type * from "./types.js";
