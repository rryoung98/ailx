/**
 * OpenRouter BYOK vibe-coding support for the T1 assist panel.
 *
 * The repo and the deployed site are PUBLIC: there is NO key here and never
 * will be. The candidate pastes their own OpenRouter key, which lives only
 * in their browser's localStorage under OPENROUTER_KEY_STORAGE.
 *
 * Everything in this module is pure / DOM-free (fetch is injected) so the
 * request builder, fence parser and response handling are unit-testable
 * without network. Model calls happen in the RUNNER only; score() stays
 * pure and consumes the stored artifact.
 */

export const OPENROUTER_KEY_STORAGE = "ailx:openrouter-key";
export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Curated defaults; the UI also accepts a free-text override. */
export const CURATED_MODELS: ReadonlyArray<string> = [
  "openai/gpt-4o-mini",
  "anthropic/claude-3.5-haiku",
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.3-70b-instruct",
];

export interface VibeRequestInput {
  model: string;
  brief: string;
  currentHtml: string;
  userPrompt: string;
}

export interface ChatPayload {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
}

const SYSTEM_PROMPT =
  "You are a vibe-coding assistant inside a timed exam. The candidate is " +
  "building ONE self-contained HTML file (inline CSS/JS only, no external " +
  "resources, no network calls — the preview runs under a strict CSP with " +
  "default-src 'none'). Given the current document and the candidate's " +
  "request, reply with the COMPLETE UPDATED HTML DOCUMENT in exactly one " +
  "fenced code block tagged html (```html ... ```). No partial diffs, no " +
  "commentary outside the fence.";

/** Build the chat-completions payload. Pure. */
export function buildVibeRequest(input: VibeRequestInput): ChatPayload {
  return {
    model: input.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `## Brief\n${input.brief}\n\n` +
          `## Current document (index.html)\n\`\`\`html\n${input.currentHtml}\n\`\`\`\n\n` +
          `## Request\n${input.userPrompt}`,
      },
    ],
  };
}

/** Request init (headers/body) for fetch. Pure — key is passed in. */
export function buildFetchInit(apiKey: string, payload: ChatPayload): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };
}

/**
 * Extract the updated document from the model reply.
 * Prefers the first ```html fence; falls back to any fence whose content
 * looks like a full document; finally, a bare full-document reply.
 * Returns null when no usable document is found.
 */
export function extractHtmlFence(text: string): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const fences = [...text.matchAll(/```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g)];
  const tagged = fences.find((m) => m[1].toLowerCase() === "html");
  if (tagged) {
    const body = tagged[2].trim();
    return body.length > 0 ? body : null;
  }
  const looksLikeDoc = (s: string) => /<!doctype html|<html[\s>]/i.test(s);
  const fallback = fences.find((m) => looksLikeDoc(m[2]));
  if (fallback) return fallback[2].trim();
  const bare = text.trim();
  return looksLikeDoc(bare) && !bare.includes("```") ? bare : null;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Call OpenRouter chat completions and return the raw assistant text.
 * fetch is injected for testability; throws OpenRouterError with a
 * user-facing message on 401/429/network/shape failures.
 */
export async function requestVibeCompletion(
  fetchImpl: FetchLike,
  apiKey: string,
  payload: ChatPayload,
): Promise<string> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(OPENROUTER_CHAT_URL, buildFetchInit(apiKey, payload));
  } catch {
    throw new OpenRouterError("Network error reaching OpenRouter.", null);
  }
  if (!res.ok) {
    const msg =
      res.status === 401
        ? "OpenRouter rejected the key (401). Check the key."
        : res.status === 429
          ? "OpenRouter rate limit (429). Wait a moment and retry."
          : `OpenRouter error (HTTP ${res.status}).`;
    throw new OpenRouterError(msg, res.status);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new OpenRouterError("OpenRouter returned unparseable JSON.", res.status);
  }
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new OpenRouterError("OpenRouter reply had no message content.", res.status);
  }
  return content;
}

/** Parse GET /models into a sorted id list. Pure; tolerant of junk. */
export function parseModelsResponse(json: unknown): string[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((m) => (m as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .sort();
}

/** Fetch the model list (key optional per OpenRouter, but we gate on it). */
export async function fetchModelIds(
  fetchImpl: FetchLike,
  apiKey: string,
): Promise<string[]> {
  try {
    const res = await fetchImpl(OPENROUTER_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    return parseModelsResponse(await res.json());
  } catch {
    return [];
  }
}
