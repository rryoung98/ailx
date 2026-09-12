/** Public consumer-demo attempts are separate from examination sittings. */
export const CONSUMER_FORM_VERSION = "consumer-demo-2026.1";
export const CONSUMER_RESPONSE_COUNT = 8;
export type ConsumerChoice = "a" | "b" | "c";
export interface ConsumerAttempt {
  id: string;
  formVersion: typeof CONSUMER_FORM_VERSION;
  startedAt: number;
  responses: readonly ConsumerChoice[];
}

export function startConsumerAttempt(id: string, startedAt: number): ConsumerAttempt {
  if (!id || !Number.isFinite(startedAt) || startedAt < 0) throw new Error("Invalid attempt identity or date");
  return { id, formVersion: CONSUMER_FORM_VERSION, startedAt, responses: [] };
}

export function appendConsumerResponse(attempt: ConsumerAttempt, index: number, choice: ConsumerChoice): ConsumerAttempt {
  if (index !== attempt.responses.length || index >= CONSUMER_RESPONSE_COUNT) {
    throw new Error("This decision has already been recorded. Reload your saved test.");
  }
  return { ...attempt, responses: [...attempt.responses, choice] };
}

export function consumerComplete(attempt: ConsumerAttempt): boolean {
  return attempt.responses.length === CONSUMER_RESPONSE_COUNT;
}

export function isConsumerChoice(value: unknown): value is ConsumerChoice {
  return value === "a" || value === "b" || value === "c";
}

function parseAttempt(value: unknown): ConsumerAttempt {
  if (typeof value !== "object" || value === null || !("id" in value) ||
      !("formVersion" in value) || !("startedAt" in value) || !("responses" in value) ||
      typeof value.id !== "string" || !value.id || value.formVersion !== CONSUMER_FORM_VERSION ||
      typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt) || value.startedAt < 0 ||
      !Array.isArray(value.responses) || value.responses.length > CONSUMER_RESPONSE_COUNT ||
      !value.responses.every(isConsumerChoice)) {
    throw new Error("Saved tests use an unsupported or unreadable format.");
  }
  return { id: value.id, formVersion: CONSUMER_FORM_VERSION, startedAt: value.startedAt, responses: [...value.responses] };
}

export function parseConsumerHistory(text: string | null): ConsumerAttempt[] {
  if (text === null) return [];
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error("Saved tests could not be read.");
  const attempts = value.map(parseAttempt);
  if (new Set(attempts.map(a => a.id)).size !== attempts.length) throw new Error("Saved tests contain duplicate identities.");
  return attempts;
}
