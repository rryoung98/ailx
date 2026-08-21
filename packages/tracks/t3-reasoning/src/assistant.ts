/**
 * DEMO assistant — deterministic simulator, clearly labeled.
 * No network. Every reply is a pure function of (config, prompt text,
 * prompt sequence, already-surfaced claims, regeneration nonce), seeded by
 * sha256 of those inputs. It plays the spec's role of an assistant whose
 * environment is seeded with known-incorrect outputs at predetermined
 * points (§T3 "The mechanism that makes this track work").
 */
import { seededIndex } from "./sha256.js";
import type { T3Config } from "./types.js";

export interface AssistantReply {
  text: string;
  /** Claim ids (planted-error and correct-advice) embedded in this reply. */
  claimIds: string[];
}

const OPENERS = [
  "Working from the source, here is my read.",
  "Based on the document, a few points stand out.",
  "Here is what the primary source supports.",
  "Let me summarise what the material says on that.",
];

const CONNECTORS = [
  "Also worth noting:",
  "One more point from the document:",
  "Related to that:",
  "In addition:",
];

const CLOSERS = [
  "Happy to go deeper on any of these.",
  "You may want to verify the figures against the source before relying on them.",
  "Tell me which thread to pull on next.",
  "That is the strongest framing I can support from the text.",
];

function topicMatches(topic: string, prompt: string): boolean {
  const p = prompt.toLowerCase();
  return topic
    .toLowerCase()
    .split(/\s+/)
    .some((w) => w.length > 3 && p.includes(w));
}

/**
 * Deterministic reply. `promptSeq` is the 1-based index of the user prompt;
 * `regenNonce` > 0 varies wording (never the planted schedule) on regenerate.
 */
export function assistantReply(
  cfg: T3Config,
  prompt: string,
  promptSeq: number,
  surfaced: ReadonlySet<string>,
  regenNonce = 0,
): AssistantReply {
  const seed = `${cfg.title}|${promptSeq}|${prompt}|${regenNonce}`;
  const claimIds: string[] = [];
  const parts: string[] = [OPENERS[seededIndex(seed + "|open", OPENERS.length)]];

  // Correct advice surfaces on topic match.
  for (const adv of cfg.correctAdvice) {
    if (claimIds.length >= 2) break;
    if (!surfaced.has(adv.id) && topicMatches(adv.topic, prompt)) {
      parts.push(adv.claim);
      claimIds.push(adv.id);
    }
  }

  // Planted errors surface on topic match, or on a fixed schedule (every
  // 2nd prompt) so a session always encounters them. The schedule is data,
  // not chance.
  const unsurfacedPlanted = cfg.plantedErrors.filter((e) => !surfaced.has(e.id));
  let planted = unsurfacedPlanted.find((e) => topicMatches(e.topic, prompt));
  if (!planted && promptSeq % 2 === 0 && unsurfacedPlanted.length > 0) {
    planted = unsurfacedPlanted[0];
  }
  if (planted) {
    parts.push(`${CONNECTORS[seededIndex(seed + "|conn", CONNECTORS.length)]} ${planted.claim}`);
    claimIds.push(planted.id);
  }

  if (claimIds.length === 0) {
    parts.push(
      "The document treats that area only briefly; consider narrowing the question to one of the brief's decision points.",
    );
  }
  parts.push(CLOSERS[seededIndex(seed + "|close", CLOSERS.length)]);

  return { text: parts.join(" "), claimIds };
}

export const DEMO_ASSISTANT_ID = "demo-assistant@1 (deterministic simulator)";
