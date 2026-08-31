/**
 * @ailx/report — pure scoring-adjacent and report derivation (FRONTEND.md §2.1).
 *
 * Everything here decides a score, a report figure, or an audit-export field,
 * so it lives inside the `packages/*` purity sandbox rather than in the Next
 * app. No module in this package may touch `fetch`, `Date.now`, `Math.random`,
 * `window`, `localStorage` or `process.env`; impure capability is injected.
 */
export * from "./aggregates.js";
export * from "./calibration.js";
export * from "./character.js";
export * from "./composite.js";
export * from "./credential.js";
export * from "./demo.js";
export * from "./diagnosis.js";
export * from "./exportTiers.js";
export * from "./insights.js";
export * from "./judging.js";
export * from "./playerType.js";
export * from "./practice.js";
export * from "./progress.js";
export * from "./share.js";
export * from "./shareText.js";
export * from "./tracks.js";
